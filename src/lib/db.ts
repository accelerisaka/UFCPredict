import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const globalForDb = globalThis as unknown as { __ufcDb?: DatabaseSync };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fighters (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  nickname TEXT,
  division TEXT,
  record TEXT,
  wins INTEGER,
  losses INTEGER,
  draws INTEGER,
  status TEXT,
  age INTEGER,
  height_in REAL,
  weight_lb REAL,
  reach_in REAL,
  leg_reach_in REAL,
  birthplace TEXT,
  trains_at TEXT,
  octagon_debut TEXT,
  image_url TEXT,
  profile_url TEXT,
  stats_json TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  headline TEXT,
  starts_at TEXT,
  prelims_at TEXT,
  early_at TEXT,
  venue TEXT,
  image_url TEXT,
  url TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS fights (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL,
  fmid TEXT NOT NULL,
  card_order INTEGER NOT NULL,
  segment TEXT,
  segment_starts_at TEXT,
  weight_class TEXT,
  is_title INTEGER NOT NULL DEFAULT 0,
  red_fighter_id INTEGER NOT NULL,
  blue_fighter_id INTEGER NOT NULL,
  red_rank TEXT,
  blue_rank TEXT,
  status TEXT NOT NULL,
  winner_fighter_id INTEGER,
  method TEXT,
  ended_round TEXT,
  ended_time TEXT,
  updated_at TEXT,
  UNIQUE(event_id, fmid)
);

CREATE TABLE IF NOT EXISTS markets (
  fight_id INTEGER PRIMARY KEY,
  event_slug TEXT,
  market_slug TEXT,
  question TEXT,
  url TEXT,
  red_token TEXT,
  blue_token TEXT,
  red_price REAL,
  blue_price REAL,
  volume REAL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS predictions (
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
  settled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_fights_event ON fights(event_id);
CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_id);
`;

export function relaxPredictionUniqueness(db: DatabaseSync): void {
  const indexes = db.prepare("PRAGMA index_list(predictions)").all() as Array<{ unique: number; origin: string }>;
  const hasTableUnique = indexes.some((index) => index.origin === "u" && Number(index.unique) === 1);
  if (hasTableUnique) {
    db.exec(`
      BEGIN;
      CREATE TABLE predictions_next (
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
        settled_at TEXT
      );
      INSERT INTO predictions_next (
        id, user_id, fight_id, fighter_id, stake_cents, locked_price, status, payout_cents, note, created_at, updated_at, settled_at
      )
      SELECT id, user_id, fight_id, fighter_id, stake_cents, locked_price, status, payout_cents, note, created_at, updated_at, settled_at
      FROM predictions;
      DROP TABLE predictions;
      ALTER TABLE predictions_next RENAME TO predictions;
      COMMIT;
    `);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_id)");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_one_open ON predictions(user_id, fight_id) WHERE status = 'open'",
  );
}

export function getDb(): DatabaseSync {
  if (!globalForDb.__ufcDb) {
    const directory = path.join(process.cwd(), "data");
    fs.mkdirSync(directory, { recursive: true });
    const db = new DatabaseSync(path.join(directory, "ufcpredict.db"));
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);
    relaxPredictionUniqueness(db);
    globalForDb.__ufcDb = db;
  }
  return globalForDb.__ufcDb;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function metaGet(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function metaSet(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}
