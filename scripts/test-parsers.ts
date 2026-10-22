import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { parseAthlete, parseEventPage, parseUpcomingEvents } from "../src/lib/ufc-parse";
import { namesMatch } from "../src/lib/names";
import { parseListedFights, pricesForFight } from "../src/lib/polymarket";

const probe = path.join(import.meta.dirname, "../_probe");
const eventsHtml = fs.readFileSync(path.join(probe, "ufc_events_html.bin"), "utf8");
const cardHtml = fs.readFileSync(path.join(probe, "event_ufc333.html"), "utf8");
const pastHtml = fs.readFileSync(path.join(probe, "event_past.html"), "utf8");
const athleteHtml = fs.readFileSync(path.join(probe, "ufc_athlete.bin"), "utf8");

const events = parseUpcomingEvents(eventsHtml);
assert.ok(events.some((event) => event.slug === "ufc-333"));
assert.equal(events.some((event) => event.slug.includes("august-29")), false);
const ufc333 = events.find((event) => event.slug === "ufc-333");
assert.ok(ufc333?.startsAt);
assert.ok(ufc333?.prelimsAt);
assert.match(ufc333?.venue || "", /Etihad/i);

const card = parseEventPage(cardHtml);
assert.equal(card.name, "UFC 333");
assert.equal(card.headline, "Volkanovski vs Evloev");
assert.ok(card.fights.length >= 10);
assert.ok(card.fights.every((fight) => fight.red.name && fight.blue.name));
const main = card.fights[0];
assert.equal(main.red.slug, "alexander-volkanovski");
assert.equal(main.blue.slug, "movsar-evloev");
assert.equal(main.red.rank, "C");
assert.equal(main.isTitle, true);
assert.equal(main.status, "scheduled");
assert.ok(card.fights.some((fight) => fight.segment === "Prelims" && fight.blue.name === "Abdul Rakhman Yakhyaev"));
assert.ok(card.fights.some((fight) => fight.segment === "Early Prelims" && fight.blue.name === "Cam Rowston") || card.fights.some((fight) => fight.blue.name === "Cam Rowston"));

const past = parseEventPage(pastHtml);
const first = past.fights[0];
assert.equal(first.red.name, "Joaquin Buckley");
assert.equal(first.blue.name, "Mike Malott");
assert.equal(first.status, "final");
assert.equal(first.winner, "blue");
assert.equal(first.method, "KO/TKO");
assert.equal(first.endedRound, "2");
assert.equal(first.endedTime, "2:32");

const athlete = parseAthlete(athleteHtml);
assert.ok(athlete);
assert.equal(athlete?.name, "Alexander Volkanovski");
assert.equal(athlete?.nickname, "The Great");
assert.equal(athlete?.heightIn, 66);
assert.equal(athlete?.reachIn, 71.5);
assert.equal(athlete?.wins, 28);
assert.equal(athlete?.losses, 4);
assert.equal(athlete?.age, 38);

assert.equal(namesMatch("Alexander Volkanovski", "Alexander Volkanovski"), true);
assert.equal(namesMatch("Song Yadong", "Yadong Song"), true);
assert.equal(namesMatch("Alex Pereira", "Alex Sandro"), false);

const listedHtml = fs.readFileSync(path.join(probe, "poly_ufc.html"), "utf8");
const listed = parseListedFights(listedHtml);
const volk = listed.find((fight) => fight.question.includes("Volkanovski"));
assert.ok(volk);
const volkPrices = pricesForFight("Alexander Volkanovski", "Movsar Evloev", volk);
assert.equal(volkPrices?.bluePrice, 0.51);
assert.equal(volkPrices?.redPrice, 0.49);

console.log(`parsers ok: ${events.length} upcoming, ${card.fights.length} on UFC 333, ${past.fights.length} on the completed card, ${listed.length} polymarket listings`);
console.log(card.fights.map((fight) => `${fight.segment} | ${fight.weightClass} | ${fight.red.name} vs ${fight.blue.name}`).join("\n"));
