import { cancelledPredictionNote, matchupChanged, opponentChangeNote, settlementOf, type FightResultStatus } from "./settlement";
import { getDb, metaGet, metaSet, nowIso } from "./db";
import { fetchText } from "./http";
import { fetchBuyPrices, fetchListedFightMarkets, findMoneyline, pricesForFight } from "./polymarket";
import { parseAthlete, parseEventPage, parseUpcomingEvents, type ParsedCorner, type ParsedEventStub, type ParsedFight } from "./ufc-parse";

export type SyncReport = {
  events: number;
  fights: number;
  athletes: number;
  markets: number;
  settled: number;
};

type FightRow = {
  id: number;
  status: string;
  winner_fighter_id: number | null;
  red_fighter_id: number;
  blue_fighter_id: number;
};

type PredictionRow = {
  id: number;
  fighter_id: number;
  stake_cents: number;
  locked_price: number;
};

type MarketTokenRow = {
  fight_id: number;
  red_token: string | null;
  blue_token: string | null;
};

let scheduleFlight: Promise<{ ok: boolean; message: string }> | null = null;
let priceFlight: Promise<void> | null = null;

function log(message: string): void {
  console.log(`[ufcpredict] ${message}`);
}

function ensureFighter(corner: ParsedCorner): number {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM fighters WHERE slug = ?").get(corner.slug) as { id: number } | undefined;
  if (!existing) {
    const result = db
      .prepare("INSERT INTO fighters (slug, name, image_url, profile_url) VALUES (?, ?, ?, ?)")
      .run(corner.slug, corner.name, corner.image, `https://www.ufc.com/athlete/${corner.slug}`);
    return Number(result.lastInsertRowid);
  }
  db.prepare("UPDATE fighters SET name = ?, image_url = COALESCE(image_url, ?) WHERE id = ?").run(
    corner.name,
    corner.image,
    existing.id,
  );
  return existing.id;
}

function fighterName(id: number): string {
  const row = getDb().prepare("SELECT name FROM fighters WHERE id = ?").get(id) as { name: string } | undefined;
  return row?.name || "未知选手";
}

function voidOpenPredictions(fightId: number, note: string): number {
  const stamp = nowIso();
  const result = getDb()
    .prepare(
      `UPDATE predictions
       SET status = 'void', payout_cents = stake_cents, note = ?, settled_at = ?, updated_at = ?
       WHERE fight_id = ? AND status = 'open'`,
    )
    .run(note, stamp, stamp, fightId);
  return Number(result.changes);
}

function settleFight(fightId: number, status: string, winnerId: number | null): number {
  if (status === "scheduled") return 0;
  const terminal = status === "final" || status === "draw" || status === "no_contest" || status === "cancelled";
  if (!terminal) return 0;

  const db = getDb();
  const predictions = db
    .prepare("SELECT id, fighter_id, stake_cents, locked_price FROM predictions WHERE fight_id = ? AND status = 'open'")
    .all(fightId) as PredictionRow[];
  const update = db.prepare(
    "UPDATE predictions SET status = ?, payout_cents = ?, note = ?, settled_at = ?, updated_at = ? WHERE id = ?",
  );
  const stamp = nowIso();
  let settled = 0;

  for (const prediction of predictions) {
    const result = settlementOf({
      status: status as FightResultStatus,
      winnerFighterId: winnerId,
      predictedFighterId: prediction.fighter_id,
      stakeCents: prediction.stake_cents,
      lockedPrice: prediction.locked_price,
    });
    update.run(result.status, result.payoutCents, result.note, stamp, stamp, prediction.id);
    settled += 1;
  }
  return settled;
}

function saveFight(eventId: number, fight: ParsedFight, segmentStartsAt: string | null): number {
  const db = getDb();
  const redId = ensureFighter(fight.red);
  const blueId = ensureFighter(fight.blue);
  const existing = db.prepare("SELECT * FROM fights WHERE event_id = ? AND fmid = ?").get(eventId, fight.fmid) as FightRow | undefined;
  const parsedWinnerId = fight.winner === "red" ? redId : fight.winner === "blue" ? blueId : null;
  const keepExistingResult = existing != null && existing.status !== "scheduled" && fight.status === "scheduled";
  const status = keepExistingResult ? existing.status : fight.status;
  const winnerId = keepExistingResult ? existing.winner_fighter_id : parsedWinnerId;
  const stamp = nowIso();

  if (!existing) {
    const result = db
      .prepare(
        `INSERT INTO fights (
          event_id, fmid, card_order, segment, segment_starts_at, weight_class, is_title,
          red_fighter_id, blue_fighter_id, red_rank, blue_rank, status, winner_fighter_id,
          method, ended_round, ended_time, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        fight.fmid,
        fight.cardOrder,
        fight.segment,
        segmentStartsAt,
        fight.weightClass,
        fight.isTitle ? 1 : 0,
        redId,
        blueId,
        fight.red.rank,
        fight.blue.rank,
        status,
        winnerId,
        fight.method,
        fight.endedRound,
        fight.endedTime,
        stamp,
      );
    const fightId = Number(result.lastInsertRowid);
    settleFight(fightId, status, winnerId);
    return fightId;
  }

  db.prepare(
    `UPDATE fights SET
      card_order = ?, segment = ?, segment_starts_at = ?, weight_class = ?, is_title = ?,
      red_fighter_id = ?, blue_fighter_id = ?, red_rank = ?, blue_rank = ?, status = ?,
      winner_fighter_id = ?, method = ?, ended_round = ?, ended_time = ?, updated_at = ?
    WHERE id = ?`,
  ).run(
    fight.cardOrder,
    fight.segment,
    segmentStartsAt,
    fight.weightClass,
    fight.isTitle ? 1 : 0,
    redId,
    blueId,
    fight.red.rank,
    fight.blue.rank,
    status,
    winnerId,
    fight.method,
    fight.endedRound,
    fight.endedTime,
    stamp,
    existing.id,
  );
  if (existing.status === "scheduled" && matchupChanged(existing.red_fighter_id, existing.blue_fighter_id, redId, blueId)) {
    const note =
      status === "cancelled"
        ? cancelledPredictionNote()
        : opponentChangeNote(fighterName(existing.red_fighter_id), fighterName(existing.blue_fighter_id));
    voidOpenPredictions(existing.id, note);
    getDb().prepare("DELETE FROM markets WHERE fight_id = ?").run(existing.id);
  }
  settleFight(existing.id, status, winnerId);
  return existing.id;
}

function segmentStart(segment: string, fromCard: string | null, stub: ParsedEventStub | undefined, pageStart: string | null): string | null {
  const label = segment.toLowerCase();
  if (label.includes("early")) return stub?.earlyAt || fromCard || stub?.prelimsAt || pageStart || stub?.startsAt || null;
  if (label.includes("prelim")) return stub?.prelimsAt || fromCard || pageStart || stub?.startsAt || null;
  return pageStart || fromCard || stub?.startsAt || null;
}

async function syncEvent(slug: string, stub?: ParsedEventStub): Promise<{ fights: number; settled: number }> {
  const html = await fetchText(`https://www.ufc.com/event/${slug}`);
  const page = parseEventPage(html);
  if (!page.name && page.fights.length === 0) {
    throw new Error(`没有解析到赛事：${slug}`);
  }

  const db = getDb();
  const existing = db.prepare("SELECT id, prelims_at, early_at, starts_at FROM events WHERE slug = ?").get(slug) as
    | { id: number; prelims_at: string | null; early_at: string | null; starts_at: string | null }
    | undefined;
  const name = page.name || stub?.headline || slug;
  const headline = page.headline || stub?.headline || null;
  const startsAt = page.startsAt || stub?.startsAt || existing?.starts_at || null;
  const prelimsAt = stub?.prelimsAt || existing?.prelims_at || null;
  const earlyAt = stub?.earlyAt || existing?.early_at || null;
  const venue = page.venue || stub?.venue || null;
  const url = `https://www.ufc.com/event/${slug}`;
  const stamp = nowIso();
  const fallbackStub: ParsedEventStub = {
    slug,
    headline: headline || name,
    startsAt,
    prelimsAt,
    earlyAt,
    venue,
  };

  let eventId: number;
  if (!existing) {
    if (page.fights.length === 0) return { fights: 0, settled: 0 };
    const inserted = db
      .prepare(
        `INSERT INTO events (slug, name, headline, starts_at, prelims_at, early_at, venue, image_url, url, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(slug, name, headline, startsAt, prelimsAt, earlyAt, venue, page.image, url, stamp);
    eventId = Number(inserted.lastInsertRowid);
  } else {
    db.prepare(
      `UPDATE events SET name = ?, headline = ?, starts_at = ?, prelims_at = ?, early_at = ?, venue = ?,
        image_url = COALESCE(?, image_url), url = ?, updated_at = ? WHERE id = ?`,
    ).run(name, headline, startsAt, prelimsAt, earlyAt, venue, page.image, url, stamp, existing.id);
    eventId = existing.id;
  }

  const seen: string[] = [];
  let settled = 0;
  for (const fight of page.fights) {
    seen.push(fight.fmid);
    const before = db.prepare("SELECT COUNT(*) AS count FROM predictions WHERE fight_id = (SELECT id FROM fights WHERE event_id = ? AND fmid = ?) AND status = 'open'").get(eventId, fight.fmid) as { count: number };
    saveFight(eventId, fight, segmentStart(fight.segment, fight.segmentStartsAt, stub || fallbackStub, startsAt));
    const after = db.prepare("SELECT COUNT(*) AS count FROM predictions WHERE fight_id = (SELECT id FROM fights WHERE event_id = ? AND fmid = ?) AND status = 'open'").get(eventId, fight.fmid) as { count: number };
    settled += Math.max(0, before.count - after.count);
  }

  if (page.fights.length > 0 && startsAt && Date.parse(startsAt) > Date.now()) {
    const stored = db.prepare("SELECT id, fmid, status FROM fights WHERE event_id = ?").all(eventId) as Array<{
      id: number;
      fmid: string;
      status: string;
    }>;
    for (const fight of stored) {
      if (seen.includes(fight.fmid) || fight.status !== "scheduled") continue;
      db.prepare("UPDATE fights SET status = 'cancelled', updated_at = ? WHERE id = ?").run(stamp, fight.id);
      settled += settleFight(fight.id, "cancelled", null);
    }
  }

  return { fights: page.fights.length, settled };
}

async function syncAthletes(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fighters = getDb()
    .prepare(
      `SELECT DISTINCT fighters.id, fighters.slug
       FROM fighters
       JOIN fights ON fights.red_fighter_id = fighters.id OR fights.blue_fighter_id = fighters.id
       WHERE fighters.updated_at IS NULL OR fighters.updated_at < ?`,
    )
    .all(cutoff) as Array<{ id: number; slug: string }>;

  let updated = 0;
  for (const fighter of fighters) {
    try {
      const html = await fetchText(`https://www.ufc.com/athlete/${fighter.slug}`);
      const athlete = parseAthlete(html);
      if (!athlete) continue;
      getDb()
        .prepare(
          `UPDATE fighters SET
            name = ?, nickname = ?, division = ?, record = ?, wins = ?, losses = ?, draws = ?, status = ?,
            age = ?, height_in = ?, weight_lb = ?, reach_in = ?, leg_reach_in = ?, birthplace = ?, trains_at = ?,
            octagon_debut = ?, image_url = COALESCE(?, image_url), stats_json = ?, updated_at = ?
          WHERE id = ?`,
        )
        .run(
          athlete.name,
          athlete.nickname,
          athlete.division,
          athlete.record,
          athlete.wins,
          athlete.losses,
          athlete.draws,
          athlete.status,
          athlete.age,
          athlete.heightIn,
          athlete.weightLb,
          athlete.reachIn,
          athlete.legReachIn,
          athlete.birthplace,
          athlete.trainsAt,
          athlete.octagonDebut,
          athlete.image,
          JSON.stringify({ tags: athlete.tags, heroStats: athlete.heroStats }),
          nowIso(),
          fighter.id,
        );
      updated += 1;
    } catch (error) {
      log(`选手资料暂未更新 ${fighter.slug}：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }
  return updated;
}

function saveMarket(input: {
  fightId: number;
  eventSlug: string;
  marketSlug: string | null;
  question: string | null;
  url: string;
  redToken: string | null;
  blueToken: string | null;
  redPrice: number | null;
  bluePrice: number | null;
  volume: number | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO markets (
        fight_id, event_slug, market_slug, question, url, red_token, blue_token, red_price, blue_price, volume, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fight_id) DO UPDATE SET
        event_slug = excluded.event_slug,
        market_slug = excluded.market_slug,
        question = excluded.question,
        url = excluded.url,
        red_token = COALESCE(excluded.red_token, markets.red_token),
        blue_token = COALESCE(excluded.blue_token, markets.blue_token),
        red_price = COALESCE(excluded.red_price, markets.red_price),
        blue_price = COALESCE(excluded.blue_price, markets.blue_price),
        volume = COALESCE(excluded.volume, markets.volume),
        updated_at = excluded.updated_at`,
    )
    .run(
      input.fightId,
      input.eventSlug,
      input.marketSlug,
      input.question,
      input.url,
      input.redToken,
      input.blueToken,
      input.redPrice,
      input.bluePrice,
      input.volume,
      nowIso(),
    );
}

async function syncMarkets(): Promise<number> {
  const fights = getDb()
    .prepare(
      `SELECT f.id, COALESCE(f.segment_starts_at, e.starts_at) AS starts_at, fr.name AS red_name, fb.name AS blue_name
       FROM fights f
       JOIN events e ON e.id = f.event_id
       JOIN fighters fr ON fr.id = f.red_fighter_id
       JOIN fighters fb ON fb.id = f.blue_fighter_id
       LEFT JOIN markets m ON m.fight_id = f.id
       WHERE f.status = 'scheduled' AND (m.fight_id IS NULL OR m.red_token IS NULL)`,
    )
    .all() as Array<{ id: number; starts_at: string | null; red_name: string; blue_name: string }>;

  let listed: Awaited<ReturnType<typeof fetchListedFightMarkets>> = [];
  try {
    listed = await fetchListedFightMarkets();
  } catch (error) {
    log(`Polymarket 赛程页暂不可用：${error instanceof Error ? error.message : "未知错误"}`);
  }

  let matched = 0;
  for (const fight of fights) {
    try {
      const market = await findMoneyline(fight.red_name, fight.blue_name, fight.starts_at);
      if (market) {
        saveMarket({
          fightId: fight.id,
          eventSlug: market.eventSlug,
          marketSlug: market.marketSlug,
          question: market.question,
          url: market.url,
          redToken: market.redToken,
          blueToken: market.blueToken,
          redPrice: market.redPrice,
          bluePrice: market.bluePrice,
          volume: market.volume,
        });
        matched += 1;
        continue;
      }
      const page = listed.find((item) => pricesForFight(fight.red_name, fight.blue_name, item));
      const prices = page ? pricesForFight(fight.red_name, fight.blue_name, page) : null;
      if (!page || !prices) continue;
      saveMarket({
        fightId: fight.id,
        eventSlug: page.slug,
        marketSlug: page.slug,
        question: page.question,
        url: `https://polymarket.com/event/${page.slug}`,
        redToken: null,
        blueToken: null,
        redPrice: prices.redPrice,
        bluePrice: prices.bluePrice,
        volume: null,
      });
      matched += 1;
    } catch (error) {
      log(`赔率匹配失败 #${fight.id}：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }
  return matched;
}

async function applyLivePrices(rows: MarketTokenRow[]): Promise<void> {
  const tokens = rows.flatMap((row) => [row.red_token, row.blue_token].filter((token): token is string => Boolean(token)));
  if (tokens.length === 0) return;
  const prices = await fetchBuyPrices(tokens);
  const update = getDb().prepare(
    "UPDATE markets SET red_price = COALESCE(?, red_price), blue_price = COALESCE(?, blue_price), updated_at = ? WHERE fight_id = ?",
  );
  const stamp = nowIso();
  for (const row of rows) {
    const red = row.red_token ? prices[row.red_token] : undefined;
    const blue = row.blue_token ? prices[row.blue_token] : undefined;
    if (red == null && blue == null) continue;
    update.run(red ?? null, blue ?? null, stamp, row.fight_id);
  }
}

async function applyListedPrices(): Promise<void> {
  const fights = getDb()
    .prepare(
      `SELECT f.id, fr.name AS red_name, fb.name AS blue_name, m.red_token
       FROM fights f
       JOIN fighters fr ON fr.id = f.red_fighter_id
       JOIN fighters fb ON fb.id = f.blue_fighter_id
       LEFT JOIN markets m ON m.fight_id = f.id
       WHERE f.status = 'scheduled' AND m.red_token IS NULL`,
    )
    .all() as Array<{ id: number; red_name: string; blue_name: string; red_token: string | null }>;
  if (fights.length === 0) return;
  const listed = await fetchListedFightMarkets();
  for (const fight of fights) {
    const page = listed.find((item) => pricesForFight(fight.red_name, fight.blue_name, item));
    const prices = page ? pricesForFight(fight.red_name, fight.blue_name, page) : null;
    if (!page || !prices) continue;
    saveMarket({
      fightId: fight.id,
      eventSlug: page.slug,
      marketSlug: page.slug,
      question: page.question,
      url: `https://polymarket.com/event/${page.slug}`,
      redToken: null,
      blueToken: null,
      redPrice: prices.redPrice,
      bluePrice: prices.bluePrice,
      volume: null,
    });
  }
}

export async function refreshEventPrices(eventId: number): Promise<void> {
  const rows = getDb()
    .prepare(
      `SELECT m.fight_id, m.red_token, m.blue_token
       FROM markets m
       JOIN fights f ON f.id = m.fight_id
       WHERE f.event_id = ?`,
    )
    .all(eventId) as MarketTokenRow[];
  await applyLivePrices(rows);
  await applyListedPrices();
}

export async function refreshAllOpenPrices(): Promise<void> {
  const rows = getDb()
    .prepare(
      `SELECT m.fight_id, m.red_token, m.blue_token
       FROM markets m
       JOIN fights f ON f.id = m.fight_id
       WHERE f.status = 'scheduled' AND m.red_token IS NOT NULL`,
    )
    .all() as MarketTokenRow[];
  await applyLivePrices(rows);
  await applyListedPrices();
  metaSet("last_price_sync", nowIso());
}

export function ensurePrices(): Promise<void> {
  const last = metaGet("last_price_sync");
  if (last && Date.now() - Date.parse(last) < 20_000) return Promise.resolve();
  if (!priceFlight) {
    priceFlight = refreshAllOpenPrices()
      .catch((error: unknown) => {
        log(`赔率刷新失败：${error instanceof Error ? error.message : "未知错误"}`);
      })
      .finally(() => {
        priceFlight = null;
      });
  }
  return priceFlight;
}

export async function runSync(): Promise<SyncReport> {
  log("开始同步 UFC 赛程");
  const listing = await fetchText("https://www.ufc.com/events");
  const stubs = parseUpcomingEvents(listing).filter((event) => !/^tbd vs tbd$/i.test(event.headline));
  log(`未来赛事 ${stubs.length} 场`);

  let fights = 0;
  let settled = 0;
  for (const stub of stubs) {
    try {
      const result = await syncEvent(stub.slug, stub);
      fights += result.fights;
      settled += result.settled;
      log(`${stub.slug}：${result.fights} 场已确定对阵`);
    } catch (error) {
      log(`赛事同步失败 ${stub.slug}：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  const upcoming = new Set(stubs.map((stub) => stub.slug));
  const leftover = getDb()
    .prepare(
      `SELECT events.slug FROM events
       WHERE EXISTS (SELECT 1 FROM fights WHERE fights.event_id = events.id AND fights.status = 'scheduled')`,
    )
    .all() as Array<{ slug: string }>;
  for (const event of leftover) {
    if (upcoming.has(event.slug)) continue;
    try {
      const result = await syncEvent(event.slug);
      fights += result.fights;
      settled += result.settled;
      log(`回看已开赛赛事 ${event.slug}`);
    } catch (error) {
      log(`赛果同步失败 ${event.slug}：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  const athletes = await syncAthletes();
  const markets = await syncMarkets();
  try {
    await refreshAllOpenPrices();
  } catch (error) {
    log(`实时价格暂未刷新：${error instanceof Error ? error.message : "未知错误"}`);
  }

  const report = { events: stubs.length, fights, athletes, markets, settled };
  log(`同步完成 ${JSON.stringify(report)}`);
  return report;
}

export function ensureSchedule(force = false): Promise<{ ok: boolean; message: string }> {
  const last = metaGet("last_sync");
  const age = last ? Date.now() - Date.parse(last) : Number.POSITIVE_INFINITY;
  if (!force && age < 15 * 60 * 1000) {
    return Promise.resolve({ ok: !metaGet("last_error"), message: metaGet("last_error") || "" });
  }
  if (!scheduleFlight) {
    scheduleFlight = runSync()
      .then((report) => {
        metaSet("last_sync", nowIso());
        metaSet("last_error", "");
        metaSet("last_report", JSON.stringify(report));
        return { ok: true, message: "" };
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "同步失败";
        metaSet("last_error", message);
        log(message);
        return { ok: false, message };
      })
      .finally(() => {
        scheduleFlight = null;
      });
  }
  return scheduleFlight;
}
