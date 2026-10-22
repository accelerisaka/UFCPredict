import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

export type ParsedEventStub = {
  slug: string;
  headline: string;
  startsAt: string | null;
  prelimsAt: string | null;
  earlyAt: string | null;
  venue: string | null;
};

export type OutcomeKind = "win" | "loss" | "draw" | "nc" | "none";

export type ParsedCorner = {
  slug: string;
  name: string;
  rank: string | null;
  image: string | null;
  outcome: OutcomeKind;
};

export type ParsedFight = {
  fmid: string;
  cardOrder: number;
  segment: string;
  segmentStartsAt: string | null;
  weightClass: string;
  isTitle: boolean;
  red: ParsedCorner;
  blue: ParsedCorner;
  status: "scheduled" | "final" | "draw" | "no_contest" | "cancelled";
  winner: "red" | "blue" | null;
  method: string | null;
  endedRound: string | null;
  endedTime: string | null;
};

export type ParsedEventPage = {
  name: string;
  headline: string | null;
  startsAt: string | null;
  venue: string | null;
  image: string | null;
  fights: ParsedFight[];
};

export type ParsedAthlete = {
  name: string;
  nickname: string | null;
  division: string | null;
  record: string | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  status: string | null;
  age: number | null;
  heightIn: number | null;
  weightLb: number | null;
  reachIn: number | null;
  legReachIn: number | null;
  birthplace: string | null;
  trainsAt: string | null;
  octagonDebut: string | null;
  image: string | null;
  tags: string[];
  heroStats: { label: string; value: string }[];
};

function clean(value: string | undefined | null): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function unixToIso(value: string | undefined | null): string | null {
  if (!value) return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp < 1_000_000_000) return null;
  return new Date(timestamp * 1000).toISOString();
}

function absUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, "https://www.ufc.com").href;
  } catch {
    return null;
  }
}

function athleteSlug(href: string | undefined): string {
  if (!href) return "";
  const match = href.match(/\/athlete\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]).toLowerCase() : "";
}

function eventSlug(href: string | undefined): string {
  if (!href) return "";
  const match = href.match(/\/event\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]).toLowerCase() : "";
}

function outcomeKind(text: string): OutcomeKind {
  const value = text.toLowerCase();
  if (!value) return "none";
  if (value.includes("no contest") || value === "nc") return "nc";
  if (value.includes("draw")) return "draw";
  if (value.includes("win")) return "win";
  if (value.includes("loss")) return "loss";
  return "none";
}

function firstText($: CheerioAPI, node: Cheerio<Element>, selector: string): string | null {
  const values = node
    .find(selector)
    .toArray()
    .map((element) => clean($(element).text()))
    .filter(Boolean);
  return values[0] || null;
}

function bioValue($: CheerioAPI, label: string): string | null {
  const labels = $(".c-bio__label").toArray();
  for (const element of labels) {
    if (clean($(element).text()) !== label) continue;
    const text = clean($(element).parent().find(".c-bio__text").text());
    return text || null;
  }
  return null;
}

function positive(value: string | null): number | null {
  if (!value) return null;
  const number = Number(value.replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function parseUpcomingEvents(html: string): ParsedEventStub[] {
  const start = html.indexOf('id="events-list-upcoming"');
  const end = html.indexOf('id="events-list-past"');
  const slice = start >= 0 ? html.slice(start, end > start ? end : undefined) : html;
  const $ = cheerio.load(slice);
  const events: ParsedEventStub[] = [];

  $(".c-card-event--result").each((_, element) => {
    const card = $(element);
    const link = card.find(".c-card-event--result__headline a").first();
    const slug = eventSlug(link.attr("href"));
    const headline = clean(link.text());
    if (!slug || !headline) return;

    const date = card.find(".c-card-event--result__date").first();
    events.push({
      slug,
      headline,
      startsAt: unixToIso(date.attr("data-main-card-timestamp")),
      prelimsAt: unixToIso(date.attr("data-prelims-card-timestamp")),
      earlyAt: unixToIso(date.attr("data-early-card-timestamp")),
      venue: clean(card.find(".c-card-event--result__location").text()) || null,
    });
  });

  return events;
}

function parseCorner($: CheerioAPI, fight: Cheerio<Element>, color: "red" | "blue"): ParsedCorner {
  const nameNode = fight.find(`.c-listing-fight__corner-name--${color}`).first();
  const given = clean(nameNode.find(".c-listing-fight__corner-given-name").text());
  const family = clean(nameNode.find(".c-listing-fight__corner-family-name").text());
  const anchorName = clean(nameNode.find("a").first().text());
  const ranks = fight
    .find(".c-listing-fight__ranks-row .c-listing-fight__corner-rank")
    .toArray()
    .map((element) => clean($(element).text()));
  const outcomeText = clean(
    fight.find(`.c-listing-fight__corner-body--${color} [class*="c-listing-fight__outcome"]`).last().text(),
  );

  return {
    slug: athleteSlug(nameNode.find("a").attr("href")),
    name: anchorName || clean(`${given} ${family}`),
    rank: ranks[color === "red" ? 0 : 1] || null,
    image: absUrl(fight.find(`.c-listing-fight__corner-image--${color} img`).attr("src")),
    outcome: outcomeKind(outcomeText),
  };
}

export function parseEventPage(html: string): ParsedEventPage {
  const $ = cheerio.load(html);
  const top = clean($(".c-hero__headline .e-divider__top").first().text());
  const bottom = clean($(".c-hero__headline .e-divider__bottom").first().text());
  const fights: ParsedFight[] = [];

  $(".c-listing-fight").each((index, element) => {
    const fight = $(element);
    const red = parseCorner($, fight, "red");
    const blue = parseCorner($, fight, "blue");
    if (!red.slug || !blue.slug) return;
    if (/^tbd$/i.test(red.name) || /^tbd$/i.test(blue.name)) return;

    const card = fight.closest(".fight-card, .fight-card-prelims, .fight-card-prelims-early");
    const segment =
      clean(card.find(".c-event-fight-card-broadcaster__card-title strong").first().text()) ||
      clean(card.find("h3").first().text()) ||
      "Main Card";
    const weightClass = clean(fight.find(".c-listing-fight__class-text").first().text()) || "Bout";
    const method = firstText($, fight, ".c-listing-fight__result-text.method");
    let status: ParsedFight["status"] = "scheduled";
    let winner: ParsedFight["winner"] = null;

    if (red.outcome === "draw" || blue.outcome === "draw") status = "draw";
    else if (red.outcome === "nc" || blue.outcome === "nc") status = "no_contest";
    else if (red.outcome === "win") {
      status = "final";
      winner = "red";
    } else if (blue.outcome === "win") {
      status = "final";
      winner = "blue";
    } else if (/cancel/i.test(fight.text())) status = "cancelled";

    if (method && /overturn/i.test(method)) {
      status = "no_contest";
      winner = null;
    }

    fights.push({
      fmid: fight.attr("data-fmid") || `${red.slug}-vs-${blue.slug}`,
      cardOrder: index,
      segment,
      segmentStartsAt: unixToIso(card.find("[data-timestamp]").first().attr("data-timestamp")),
      weightClass,
      isTitle: /title/i.test(weightClass),
      red,
      blue,
      status,
      winner,
      method,
      endedRound: firstText($, fight, ".c-listing-fight__result-text.round"),
      endedTime: firstText($, fight, ".c-listing-fight__result-text.time"),
    });
  });

  return {
    name: clean($(".c-hero__headline-prefix h1").first().text()) || clean($("h1").first().text()),
    headline: top && bottom ? `${top} vs ${bottom}` : null,
    startsAt: unixToIso($(".c-hero__headline-suffix").first().attr("data-timestamp")),
    venue: clean($(".c-hero__text .field--name-venue").first().text()) || null,
    image: absUrl($(".hero-fixed-bar__image img").first().attr("src")),
    fights,
  };
}

export function parseAthlete(html: string): ParsedAthlete | null {
  const $ = cheerio.load(html);
  const name = clean($(".hero-profile__name").first().text());
  if (!name) return null;

  const record = clean($(".hero-profile__division-body").first().text()) || null;
  const recordMatch = record?.match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/);
  const nickname = clean($(".hero-profile__nickname").first().text()).replace(/^["“”']+|["“”']+$/g, "");
  const division = clean($(".hero-profile__division-title").first().text()).replace(/\s+division$/i, "");
  const heroStats: { label: string; value: string }[] = [];

  $(".hero-profile__stat").each((_, element) => {
    const stat = $(element);
    const value = clean(stat.find(".hero-profile__stat-numb").text());
    const label = clean(stat.find(".hero-profile__stat-text").text());
    if (value && label) heroStats.push({ label, value });
  });

  const tags = $(".hero-profile__tag")
    .toArray()
    .map((element) => clean($(element).text()))
    .filter(Boolean);

  return {
    name,
    nickname: nickname || null,
    division: division || null,
    record,
    wins: recordMatch ? Number(recordMatch[1]) : null,
    losses: recordMatch ? Number(recordMatch[2]) : null,
    draws: recordMatch ? Number(recordMatch[3]) : null,
    status: bioValue($, "Status"),
    age: positive(bioValue($, "Age")),
    heightIn: positive(bioValue($, "Height")),
    weightLb: positive(bioValue($, "Weight")),
    reachIn: positive(bioValue($, "Reach")),
    legReachIn: positive(bioValue($, "Leg reach")),
    birthplace: bioValue($, "Place of Birth"),
    trainsAt: bioValue($, "Trains at"),
    octagonDebut: bioValue($, "Octagon Debut"),
    image: absUrl($(".hero-profile__image").first().attr("src")),
    tags,
    heroStats,
  };
}
