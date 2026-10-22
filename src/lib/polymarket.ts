import { assignOutcomes, namesMatch } from "./names";
import { fetchJson } from "./http";

type GammaMarket = {
  slug?: string;
  question?: string;
  sportsMarketType?: string;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  volumeNum?: number;
  closed?: boolean;
};

type GammaEvent = {
  slug?: string;
  title?: string;
  endDate?: string;
  closed?: boolean;
  markets?: GammaMarket[];
};

type SearchResponse = {
  events?: GammaEvent[];
};

export type MatchedMarket = {
  eventSlug: string;
  marketSlug: string | null;
  question: string | null;
  url: string;
  redToken: string;
  blueToken: string;
  redPrice: number | null;
  bluePrice: number | null;
  volume: number | null;
};

function parseStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function priceAt(prices: string[], index: number): number | null {
  const price = Number(prices[index]);
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return null;
  return price;
}

function consider(
  events: GammaEvent[],
  redName: string,
  blueName: string,
  eventStartsAt: string | null,
): MatchedMarket | null {
  const start = eventStartsAt ? Date.parse(eventStartsAt) : Number.NaN;
  let best: { score: number; market: MatchedMarket } | null = null;

  for (const event of events) {
    if (!event.slug || !/^[a-z0-9-]+$/i.test(event.slug)) continue;
    for (const market of event.markets || []) {
      if (market.sportsMarketType !== "moneyline") continue;
      const outcomes = parseStringArray(market.outcomes);
      const assigned = assignOutcomes(redName, blueName, outcomes);
      if (!assigned) continue;

      const tokens = parseStringArray(market.clobTokenIds);
      const redToken = tokens[assigned.redIndex];
      const blueToken = tokens[assigned.blueIndex];
      if (!redToken || !blueToken) continue;

      const end = event.endDate ? Date.parse(event.endDate) : Number.NaN;
      const dayDiff =
        Number.isFinite(end) && Number.isFinite(start) ? Math.abs(end - start) / 86_400_000 : 12;
      if (dayDiff > 21) continue;

      const prices = parseStringArray(market.outcomePrices);
      const closedPenalty = market.closed || event.closed ? 8 : 0;
      const score = 100 - dayDiff - closedPenalty;
      const matched: MatchedMarket = {
        eventSlug: event.slug,
        marketSlug: market.slug || null,
        question: market.question || event.title || null,
        url: `https://polymarket.com/event/${event.slug}`,
        redToken,
        blueToken,
        redPrice: priceAt(prices, assigned.redIndex),
        bluePrice: priceAt(prices, assigned.blueIndex),
        volume: typeof market.volumeNum === "number" ? market.volumeNum : null,
      };
      if (!best || score > best.score) best = { score, market: matched };
    }
  }

  return best?.market ?? null;
}

let gammaBlockedUntil = 0;

async function gammaGet<T>(url: string): Promise<T | null> {
  if (Date.now() < gammaBlockedUntil) return null;
  try {
    return await fetchJson<T>(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/404|429|5\d\d/.test(message)) {
      gammaBlockedUntil = Date.now() + 10 * 60 * 1000;
      console.log("[ufcpredict] Polymarket Gamma 暂时不可用，改用赛程页上的公布价格");
    }
    return null;
  }
}

export async function findMoneyline(
  redName: string,
  blueName: string,
  eventStartsAt: string | null,
): Promise<MatchedMarket | null> {
  const queries = [`${redName} ${blueName}`, `UFC ${redName.split(" ").at(-1)} ${blueName.split(" ").at(-1)}`];
  for (const query of queries) {
    const url = new URL("https://gamma-api.polymarket.com/public-search");
    url.searchParams.set("q", query);
    const payload = await gammaGet<SearchResponse>(url.toString());
    if (!payload) return null;
    const matched = consider(payload.events || [], redName, blueName, eventStartsAt);
    if (matched) return matched;
  }
  return null;
}

export type ListedFight = {
  slug: string;
  question: string;
  left: string;
  right: string;
  outcome: string;
  price: number;
  startsAt: string | null;
};

export function parseListedFights(html: string): ListedFight[] {
  const fights: ListedFight[] = [];
  const blocks = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block[1]);
    } catch {
      continue;
    }
    const elements = (data as { mainEntity?: { itemListElement?: unknown[] } }).mainEntity?.itemListElement;
    if (!Array.isArray(elements)) continue;
    for (const element of elements) {
      const item = (element as { item?: Record<string, unknown> }).item;
      if (!item || typeof item.name !== "string") continue;
      const title = item.name.match(/:\s*(.+?)\s+vs\.?\s+(.+?)(?:\s+\(|$)/i);
      if (!title) continue;
      const offer = item.offers as { name?: string; price?: string } | undefined;
      const outcome = offer?.name?.replace(/^Outcome:\s*/i, "").trim();
      const price = Number(offer?.price);
      const slug = typeof item.url === "string" ? item.url.split("/").filter(Boolean).at(-1) : undefined;
      if (!outcome || !slug || !/^[a-z0-9-]+$/i.test(slug) || !(price > 0 && price < 1)) continue;
      fights.push({
        slug,
        question: item.name,
        left: title[1],
        right: title[2],
        outcome,
        price,
        startsAt: typeof item.startDate === "string" ? item.startDate : null,
      });
    }
  }
  return fights;
}

export function complementPrice(price: number): number {
  return Math.round((1 - price) * 1000) / 1000;
}

export function pricesForFight(
  redName: string,
  blueName: string,
  listed: ListedFight,
): { redPrice: number; bluePrice: number } | null {
  const sameOrder = namesMatch(redName, listed.left) && namesMatch(blueName, listed.right);
  const swapped = namesMatch(redName, listed.right) && namesMatch(blueName, listed.left);
  if (!sameOrder && !swapped) return null;
  const redQuoted = namesMatch(redName, listed.outcome);
  const blueQuoted = namesMatch(blueName, listed.outcome);
  if (!redQuoted && !blueQuoted) return null;
  return {
    redPrice: redQuoted ? listed.price : complementPrice(listed.price),
    bluePrice: blueQuoted ? listed.price : complementPrice(listed.price),
  };
}

let listedCache: { at: number; rows: ListedFight[] } | null = null;

export async function fetchListedFightMarkets(): Promise<ListedFight[]> {
  if (listedCache && Date.now() - listedCache.at < 15_000) return listedCache.rows;
  const response = await fetch("https://polymarket.com/sports/ufc/games", {
    headers: {
      accept: "text/html",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return listedCache?.rows || [];
  const rows = parseListedFights(await response.text());
  listedCache = { at: Date.now(), rows };
  return rows;
}

export async function fetchBuyPrices(tokenIds: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  const unique = [...new Set(tokenIds.filter(Boolean))];

  for (let index = 0; index < unique.length; index += 40) {
    const chunk = unique.slice(index, index + 40);
    const response = await fetch("https://clob.polymarket.com/prices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "UFCPredict/1.0",
      },
      body: JSON.stringify(chunk.map((token_id) => ({ token_id, side: "BUY" }))),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) continue;
    const data = (await response.json()) as Record<string, { BUY?: string }>;
    for (const [tokenId, quote] of Object.entries(data)) {
      const price = Number(quote?.BUY);
      if (Number.isFinite(price) && price > 0 && price < 1) prices[tokenId] = price;
    }
  }

  return prices;
}
