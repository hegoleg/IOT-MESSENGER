import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

/** better-sqlite3 database handle. */
export type DB = InstanceType<typeof Database>;

/**
 * Opens (and creates if needed) the SQLite database and applies the schema.
 * History is capped to `HISTORY_LIMIT` rows per token by the writer.
 */
export function openDatabase(dbPath: string): DB {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      token      TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      token     TEXT NOT NULL,
      id        TEXT NOT NULL,
      from_role TEXT NOT NULL,
      ts        INTEGER NOT NULL,
      text      TEXT NOT NULL,
      kb        TEXT,
      PRIMARY KEY (token, id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_token_ts
      ON messages (token, ts);
  `);

  return db;
}
