import { getDb, metaGet } from "./db";
import {
  formatInches,
  formatRank,
  formatWeight,
  polymarketEventUrl,
  safeUfcImage,
  translateWeight,
} from "./format";
import type { CornerView, EventCard, FightView, MarketView, PredictionView } from "./types";

type FighterRow = {
  id: number;
  slug: string;
  name: string;
  nickname: string | null;
  division: string | null;
  record: string | null;
  age: number | null;
  height_in: number | null;
  weight_lb: number | null;
  reach_in: number | null;
  leg_reach_in: number | null;
  birthplace: string | null;
  trains_at: string | null;
  octagon_debut: string | null;
  image_url: string | null;
  profile_url: string | null;
  stats_json: string | null;
  status: string | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
};

type EventRow = {
  id: number;
  slug: string;
  name: string;
  headline: string | null;
  starts_at: string | null;
  venue: string | null;
  image_url: string | null;
};

type FightRow = {
  id: number;
  event_id: number;
  card_order: number;
  segment: string | null;
  segment_starts_at: string | null;
  weight_class: string | null;
  is_title: number;
  red_fighter_id: number;
  blue_fighter_id: number;
  red_rank: string | null;
  blue_rank: string | null;
  status: string;
  winner_fighter_id: number | null;
  method: string | null;
  ended_round: string | null;
  ended_time: string | null;
};

type MarketRow = {
  fight_id: number;
  event_slug: string | null;
  red_price: number | null;
  blue_price: number | null;
  volume: number | null;
  updated_at: string | null;
};

type PredictionRow = {
  fight_id: number;
  fighter_id: number;
  locked_price: number;
  stake_cents: number;
  payout_cents: number | null;
  status: string;
  note: string | null;
};

export type SyncStatus = {
  syncedAt: string | null;
  error: string | null;
};

export type ProfileSummary = {
  total: number;
  openCount: number;
  wins: number;
  losses: number;
  voids: number;
  stakedCents: number;
  settledStakeCents: number;
  returnedCents: number;
  profitCents: number;
  openStakeCents: number;
};

export type HistoryItem = {
  id: number;
  eventName: string;
  eventSlug: string;
  startsAt: string | null;
  weightClass: string;
  redName: string;
  blueName: string;
  pickName: string;
  winnerName: string | null;
  fightStatus: string;
  method: string | null;
  endedRound: string | null;
  endedTime: string | null;
  lockedPrice: number;
  stakeCents: number;
  payoutCents: number | null;
  status: string;
  note: string | null;
};

export type FighterProfile = {
  slug: string;
  name: string;
  nickname: string | null;
  division: string | null;
  record: string | null;
  status: string | null;
  age: number | null;
  height: string | null;
  reach: string | null;
  legReach: string | null;
  weight: string | null;
  birthplace: string | null;
  trainsAt: string | null;
  octagonDebut: string | null;
  image: string | null;
  profileUrl: string | null;
  tags: string[];
  heroStats: { label: string; value: string }[];
  fights: Array<{
    eventSlug: string;
    eventName: string;
    startsAt: string | null;
    opponent: string;
    weightClass: string;
    status: string;
  }>;
};

export function getSyncStatus(): SyncStatus {
  return {
    syncedAt: metaGet("last_sync"),
    error: metaGet("last_error"),
  };
}

function loadFighters(ids: number[]): Map<number, FighterRow> {
  const unique = [...new Set(ids)];
  const map = new Map<number, FighterRow>();
  if (unique.length === 0) return map;
  const rows = getDb()
    .prepare(`SELECT * FROM fighters WHERE id IN (${unique.map(() => "?").join(",")})`)
    .all(...unique) as FighterRow[];
  for (const row of rows) map.set(row.id, row);
  return map;
}

function toCorner(fighter: FighterRow, rank: string | null, isWinner: boolean): CornerView {
  return {
    id: fighter.id,
    slug: fighter.slug,
    name: fighter.name,
    nickname: fighter.nickname,
    record: fighter.record,
    height: formatInches(fighter.height_in, "height"),
    reach: formatInches(fighter.reach_in, "reach"),
    weight: formatWeight(fighter.weight_lb),
    age: fighter.age,
    division: fighter.division,
    image: safeUfcImage(fighter.image_url),
    rank: formatRank(rank),
    isWinner,
  };
}

function phaseOf(startsAt: string | null, statuses: string[]): EventCard["phase"] {
  const active = statuses.filter((status) => status !== "cancelled");
  if (active.length > 0 && active.every((status) => status !== "scheduled")) return "final";
  if (startsAt && Date.parse(startsAt) <= Date.now()) return "awaiting";
  return "upcoming";
}

export function listEvents(): EventCard[] {
  const db = getDb();
  const events = db.prepare("SELECT * FROM events ORDER BY starts_at IS NULL, starts_at ASC").all() as EventRow[];
  const fights = db.prepare("SELECT event_id, card_order, status, red_fighter_id, blue_fighter_id FROM fights WHERE status != 'cancelled' ORDER BY card_order ASC").all() as Array<{
    event_id: number;
    card_order: number;
    status: string;
    red_fighter_id: number;
    blue_fighter_id: number;
  }>;
  const priced = db.prepare(
    `SELECT f.event_id, COUNT(*) AS count
     FROM fights f JOIN markets m ON m.fight_id = f.id
     WHERE f.status != 'cancelled' AND m.red_price IS NOT NULL
     GROUP BY f.event_id`,
  ).all() as Array<{ event_id: number; count: number }>;
  const pricedMap = new Map(priced.map((row) => [row.event_id, row.count]));
  const fighterIds = fights.flatMap((fight) => [fight.red_fighter_id, fight.blue_fighter_id]);
  const fighters = loadFighters(fighterIds);
  const byEvent = new Map<number, typeof fights>();
  for (const fight of fights) {
    const list = byEvent.get(fight.event_id) || [];
    list.push(fight);
    byEvent.set(fight.event_id, list);
  }

  const cards: EventCard[] = [];
  for (const event of events) {
    const cardFights = byEvent.get(event.id) || [];
    if (cardFights.length === 0) continue;
    const phase = phaseOf(event.starts_at, cardFights.map((fight) => fight.status));
    if (phase === "final" && event.starts_at && Date.now() - Date.parse(event.starts_at) > 48 * 60 * 60 * 1000) continue;
    const main = cardFights[0];
    const red = fighters.get(main.red_fighter_id);
    const blue = fighters.get(main.blue_fighter_id);
    cards.push({
      slug: event.slug,
      name: event.name,
      headline: event.headline,
      startsAt: event.starts_at,
      venue: event.venue,
      image: safeUfcImage(event.image_url),
      fightCount: cardFights.length,
      pricedCount: pricedMap.get(event.id) || 0,
      mainEvent: red && blue ? `${red.name} vs ${blue.name}` : event.headline,
      phase,
    });
  }
  return cards;
}

export function getEvent(slug: string, userId: number | null): { event: EventCard & { id: number }; fights: FightView[] } | null {
  const event = getDb().prepare("SELECT * FROM events WHERE slug = ?").get(slug) as (EventRow & { id: number }) | undefined;
  if (!event) return null;
  const fights = getDb().prepare("SELECT * FROM fights WHERE event_id = ? AND status != 'cancelled' ORDER BY card_order ASC").all(event.id) as FightRow[];
  if (fights.length === 0) return null;

  const fighters = loadFighters(fights.flatMap((fight) => [fight.red_fighter_id, fight.blue_fighter_id]));
  const markets = getDb()
    .prepare(`SELECT * FROM markets WHERE fight_id IN (${fights.map(() => "?").join(",")})`)
    .all(...fights.map((fight) => fight.id)) as MarketRow[];
  const marketMap = new Map(markets.map((market) => [market.fight_id, market]));
  const predictions = userId
    ? (getDb()
        .prepare(
          `SELECT * FROM predictions
           WHERE user_id = ? AND fight_id IN (${fights.map(() => "?").join(",")})
           ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, id DESC`,
        )
        .all(userId, ...fights.map((fight) => fight.id)) as PredictionRow[])
    : [];
  const predictionMap = new Map<number, PredictionRow>();
  for (const prediction of predictions) {
    if (!predictionMap.has(prediction.fight_id)) predictionMap.set(prediction.fight_id, prediction);
  }

  const views = fights.flatMap((fight) => {
    const red = fighters.get(fight.red_fighter_id);
    const blue = fighters.get(fight.blue_fighter_id);
    if (!red || !blue) return [];
    const market = marketMap.get(fight.id);
    const prediction = predictionMap.get(fight.id);
    const marketView: MarketView | null = market
      ? {
          redPrice: market.red_price,
          bluePrice: market.blue_price,
          volume: market.volume,
          url: polymarketEventUrl(market.event_slug),
          updatedAt: market.updated_at,
        }
      : null;
    const predictionView: PredictionView | null = prediction
      ? {
          fighterId: prediction.fighter_id,
          lockedPrice: prediction.locked_price,
          stakeCents: prediction.stake_cents,
          payoutCents: prediction.payout_cents,
          status: prediction.status,
          note: prediction.note,
        }
      : null;
    return [
      {
        id: fight.id,
        segment: fight.segment,
        segmentStartsAt: fight.segment_starts_at,
        weightClass: translateWeight(fight.weight_class),
        isTitle: fight.is_title === 1,
        status: fight.status,
        method: fight.method,
        endedRound: fight.ended_round,
        endedTime: fight.ended_time,
        red: toCorner(red, fight.red_rank, fight.winner_fighter_id === red.id),
        blue: toCorner(blue, fight.blue_rank, fight.winner_fighter_id === blue.id),
        market: marketView,
        prediction: predictionView,
      } satisfies FightView,
    ];
  });

  const card: EventCard & { id: number } = {
    id: event.id,
    slug: event.slug,
    name: event.name,
    headline: event.headline,
    startsAt: event.starts_at,
    venue: event.venue,
    image: safeUfcImage(event.image_url),
    fightCount: views.length,
    pricedCount: views.filter((fight) => fight.market?.redPrice != null).length,
    mainEvent: event.headline,
    phase: phaseOf(event.starts_at, views.map((fight) => fight.status)),
  };
  return { event: card, fights: views };
}

export function getFighter(slug: string): FighterProfile | null {
  const fighter = getDb().prepare("SELECT * FROM fighters WHERE slug = ?").get(slug) as FighterRow | undefined;
  if (!fighter) return null;
  let tags: string[] = [];
  let heroStats: { label: string; value: string }[] = [];
  if (fighter.stats_json) {
    try {
      const parsed = JSON.parse(fighter.stats_json) as { tags?: string[]; heroStats?: { label: string; value: string }[] };
      tags = parsed.tags || [];
      heroStats = parsed.heroStats || [];
    } catch {
      tags = [];
    }
  }

  const fights = getDb()
    .prepare(
      `SELECT e.slug AS event_slug, e.name AS event_name, e.starts_at, f.weight_class, f.status,
              f.red_fighter_id, f.blue_fighter_id, fr.name AS red_name, fb.name AS blue_name
       FROM fights f
       JOIN events e ON e.id = f.event_id
       JOIN fighters fr ON fr.id = f.red_fighter_id
       JOIN fighters fb ON fb.id = f.blue_fighter_id
       WHERE f.red_fighter_id = ? OR f.blue_fighter_id = ?
       ORDER BY e.starts_at ASC`,
    )
    .all(fighter.id, fighter.id) as Array<{
    event_slug: string;
    event_name: string;
    starts_at: string | null;
    weight_class: string | null;
    status: string;
    red_fighter_id: number;
    blue_name: string;
    red_name: string;
  }>;

  return {
    slug: fighter.slug,
    name: fighter.name,
    nickname: fighter.nickname,
    division: fighter.division,
    record: fighter.record,
    status: fighter.status,
    age: fighter.age,
    height: formatInches(fighter.height_in, "height"),
    reach: formatInches(fighter.reach_in, "reach"),
    legReach: formatInches(fighter.leg_reach_in, "reach"),
    weight: formatWeight(fighter.weight_lb),
    birthplace: fighter.birthplace,
    trainsAt: fighter.trains_at,
    octagonDebut: fighter.octagon_debut,
    image: safeUfcImage(fighter.image_url),
    profileUrl: fighter.profile_url,
    tags,
    heroStats,
    fights: fights.map((fight) => ({
      eventSlug: fight.event_slug,
      eventName: fight.event_name,
      startsAt: fight.starts_at,
      opponent: fight.red_fighter_id === fighter.id ? fight.blue_name : fight.red_name,
      weightClass: translateWeight(fight.weight_class),
      status: fight.status,
    })),
  };
}

export function getProfile(userId: number): { summary: ProfileSummary; history: HistoryItem[] } {
  const summaryRow = getDb()
    .prepare(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open_count,
        COALESCE(SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END), 0) AS wins,
        COALESCE(SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END), 0) AS losses,
        COALESCE(SUM(CASE WHEN status = 'void' THEN 1 ELSE 0 END), 0) AS voids,
        COALESCE(SUM(stake_cents), 0) AS staked,
        COALESCE(SUM(CASE WHEN status != 'open' THEN stake_cents ELSE 0 END), 0) AS settled_stake,
        COALESCE(SUM(CASE WHEN status != 'open' THEN COALESCE(payout_cents, 0) ELSE 0 END), 0) AS returned,
        COALESCE(SUM(CASE WHEN status = 'open' THEN stake_cents ELSE 0 END), 0) AS open_stake
      FROM predictions WHERE user_id = ?`,
    )
    .get(userId) as {
    total: number;
    open_count: number;
    wins: number;
    losses: number;
    voids: number;
    staked: number;
    settled_stake: number;
    returned: number;
    open_stake: number;
  };

  const history = getDb()
    .prepare(
      `SELECT p.id, p.locked_price, p.stake_cents, p.payout_cents, p.status, p.note,
              e.name AS event_name, e.slug AS event_slug, e.starts_at,
              f.weight_class, f.status AS fight_status, f.method, f.ended_round, f.ended_time,
              fr.name AS red_name, fb.name AS blue_name, pick.name AS pick_name, winner.name AS winner_name
       FROM predictions p
       JOIN fights f ON f.id = p.fight_id
       JOIN events e ON e.id = f.event_id
       JOIN fighters fr ON fr.id = f.red_fighter_id
       JOIN fighters fb ON fb.id = f.blue_fighter_id
       JOIN fighters pick ON pick.id = p.fighter_id
       LEFT JOIN fighters winner ON winner.id = f.winner_fighter_id
       WHERE p.user_id = ?
       ORDER BY CASE WHEN p.status = 'open' THEN 0 ELSE 1 END, e.starts_at DESC, p.id DESC`,
    )
    .all(userId) as Array<{
    id: number;
    locked_price: number;
    stake_cents: number;
    payout_cents: number | null;
    status: string;
    note: string | null;
    event_name: string;
    event_slug: string;
    starts_at: string | null;
    weight_class: string | null;
    fight_status: string;
    method: string | null;
    ended_round: string | null;
    ended_time: string | null;
    red_name: string;
    blue_name: string;
    pick_name: string;
    winner_name: string | null;
  }>;

  return {
    summary: {
      total: summaryRow.total,
      openCount: summaryRow.open_count,
      wins: summaryRow.wins,
      losses: summaryRow.losses,
      voids: summaryRow.voids,
      stakedCents: summaryRow.staked,
      settledStakeCents: summaryRow.settled_stake,
      returnedCents: summaryRow.returned,
      profitCents: summaryRow.returned - summaryRow.settled_stake,
      openStakeCents: summaryRow.open_stake,
    },
    history: history.map((item) => ({
      id: item.id,
      eventName: item.event_name,
      eventSlug: item.event_slug,
      startsAt: item.starts_at,
      weightClass: translateWeight(item.weight_class),
      redName: item.red_name,
      blueName: item.blue_name,
      pickName: item.pick_name,
      winnerName: item.winner_name,
      fightStatus: item.fight_status,
      method: item.method,
      endedRound: item.ended_round,
      endedTime: item.ended_time,
      lockedPrice: item.locked_price,
      stakeCents: item.stake_cents,
      payoutCents: item.payout_cents,
      status: item.status,
      note: item.note,
    })),
  };
}
