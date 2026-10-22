import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { relaxPredictionUniqueness } from "../src/lib/db";
import { payoutCents } from "../src/lib/format";
import { cancelledPredictionNote, matchupChanged, opponentChangeNote, settlementOf } from "../src/lib/settlement";

assert.equal(payoutCents(10000, 0.4), 25000);
assert.equal(payoutCents(10000, 0.495), 20202);

const won = settlementOf({
  status: "final",
  winnerFighterId: 1,
  predictedFighterId: 1,
  stakeCents: 10000,
  lockedPrice: 0.4,
});
assert.equal(won.status, "won");
assert.equal(won.payoutCents, 25000);

const lost = settlementOf({
  status: "final",
  winnerFighterId: 2,
  predictedFighterId: 1,
  stakeCents: 10000,
  lockedPrice: 0.4,
});
assert.equal(lost.status, "lost");
assert.equal(lost.payoutCents, 0);

const draw = settlementOf({
  status: "draw",
  winnerFighterId: null,
  predictedFighterId: 1,
  stakeCents: 10000,
  lockedPrice: 0.4,
});
assert.equal(draw.status, "void");
assert.equal(draw.payoutCents, 10000);

const cancelled = settlementOf({
  status: "cancelled",
  winnerFighterId: null,
  predictedFighterId: 1,
  stakeCents: 10000,
  lockedPrice: 0.4,
});
assert.equal(cancelled.status, "void");
assert.equal(cancelled.payoutCents, 10000);
assert.equal(cancelled.note, cancelledPredictionNote());
assert.equal(opponentChangeNote("甲", "乙"), "对手更换，原对阵 甲 vs 乙，预测已取消，本金退回");
assert.equal(matchupChanged(1, 2, 1, 2), false);
assert.equal(matchupChanged(1, 2, 2, 1), false);
assert.equal(matchupChanged(1, 2, 1, 3), true);
assert.equal(matchupChanged(1, 2, 3, 4), true);

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE predictions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    fight_id INTEGER NOT NULL,
    fighter_id INTEGER NOT NULL,
    stake_cents INTEGER NOT NULL,
    locked_price REAL NOT NULL,
    status TEXT NOT NULL,
    payout_cents INTEGER,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    settled_at TEXT,
    UNIQUE(user_id, fight_id)
  );
`);
db.prepare(
  `INSERT INTO predictions (user_id, fight_id, fighter_id, stake_cents, locked_price, status, created_at, updated_at)
   VALUES (1, 10, 2, 10000, 0.4, 'open', 't', 't')`,
).run();
relaxPredictionUniqueness(db);
const note = opponentChangeNote("甲", "乙");
const voided = db
  .prepare(
    `UPDATE predictions
     SET status = 'void', payout_cents = stake_cents, note = ?, settled_at = 't2', updated_at = 't2'
     WHERE fight_id = ? AND status = 'open'`,
  )
  .run(note, 10);
assert.equal(Number(voided.changes), 1);
db.prepare(
  `INSERT INTO predictions (user_id, fight_id, fighter_id, stake_cents, locked_price, status, created_at, updated_at)
   VALUES (1, 10, 3, 10000, 0.55, 'open', 't3', 't3')`,
).run();
const rows = db.prepare("SELECT status, payout_cents, note, fighter_id FROM predictions ORDER BY id").all() as Array<{
  status: string;
  payout_cents: number;
  note: string | null;
  fighter_id: number;
}>;
assert.equal(rows.length, 2);
assert.equal(rows[0].status, "void");
assert.equal(rows[0].payout_cents, 10000);
assert.equal(rows[0].note, note);
assert.equal(rows[0].fighter_id, 2);
assert.equal(rows[1].status, "open");
assert.throws(() => {
  db.prepare(
    `INSERT INTO predictions (user_id, fight_id, fighter_id, stake_cents, locked_price, status, created_at, updated_at)
     VALUES (1, 10, 4, 10000, 0.6, 'open', 't4', 't4')`,
  ).run();
});
db.close();

console.log("settlement ok");
