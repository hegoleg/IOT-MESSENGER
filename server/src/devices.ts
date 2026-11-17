import { randomBytes } from "node:crypto";
import type { DB } from "./db.js";

/** Current Unix time in seconds (the protocol uses seconds, not millis). */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Creates a new device token: 18 random bytes encoded as base64url
 * (24 URL-safe characters, ~144 bits of entropy).
 */
export function createDeviceToken(db: DB): string {
  const exists = db.prepare("SELECT 1 FROM devices WHERE token = ?");
  const insert = db.prepare(
    "INSERT INTO devices (token, created_at, last_seen) VALUES (?, ?, ?)",
  );

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = randomBytes(18).toString("base64url");
    if (exists.get(token) !== undefined) continue;
    const now = nowSec();
    insert.run(token, now, now);
    return token;
  }

  throw new Error("could not generate a unique device token");
}

/** True when the token belongs to a known device. */
export function deviceExists(db: DB, token: string): boolean {
  return db.prepare("SELECT 1 FROM devices WHERE token = ?").get(token) !== undefined;
}

/** Last time the device was seen, Unix seconds (0 when unknown). */
export function getLastSeen(db: DB, token: string): number {
  const row = db
    .prepare("SELECT last_seen FROM devices WHERE token = ?")
    .get(token) as { last_seen: number } | undefined;
  return row?.last_seen ?? 0;
}

/** Marks the device as seen now and returns the stored timestamp. */
export function touchDevice(db: DB, token: string): number {
  const now = nowSec();
  db.prepare("UPDATE devices SET last_seen = ? WHERE token = ?").run(now, token);
  return now;
}
