import {
  HISTORY_LIMIT,
  PROTOCOL_VERSION,
  type IBKeyboard,
  type MsgPacket,
  type Role,
} from "@iot/shared";
import type { DB } from "./db.js";

interface MessageRow {
  id: string;
  from_role: string;
  ts: number;
  text: string;
  kb: string | null;
}

/**
 * Stores a message for the token and prunes the history to HISTORY_LIMIT rows.
 * When a packet with an existing (token, id) arrives (an edit), only text and
 * keyboard are replaced; the original `ts` is kept so live-updating messages
 * do not jump to the end of the history.
 */
export function saveMessage(db: DB, token: string, packet: MsgPacket): void {
  const kb = packet.kb ? JSON.stringify(packet.kb) : null;
  const ts = packet.ts && packet.ts > 0 ? packet.ts : Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO messages (token, id, from_role, ts, text, kb)
    VALUES (@token, @id, @from, @ts, @text, @kb)
    ON CONFLICT(token, id) DO UPDATE SET
      from_role = excluded.from_role,
      text      = excluded.text,
      kb        = excluded.kb
  `).run({ token, id: packet.id, from: packet.from, ts, text: packet.text, kb });

  db.prepare(`
    DELETE FROM messages
    WHERE token = ?
      AND rowid NOT IN (
        SELECT rowid FROM messages
        WHERE token = ?
        ORDER BY ts DESC, rowid DESC
        LIMIT ?
      )
  `).run(token, token, HISTORY_LIMIT);
}

/**
 * Returns the last `limit` messages for the token ordered by `ts` ascending,
 * shaped as standard "msg" packets so clients can reuse one parser.
 */
export function getHistory(db: DB, token: string, limit = HISTORY_LIMIT): MsgPacket[] {
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), HISTORY_LIMIT);

  const rows = db.prepare(`
    SELECT id, from_role, ts, text, kb
    FROM (
      SELECT rowid AS r, id, from_role, ts, text, kb
      FROM messages
      WHERE token = @token
      ORDER BY ts DESC, rowid DESC
      LIMIT @limit
    )
    ORDER BY ts ASC, r ASC
  `).all({ token, limit: safeLimit }) as MessageRow[];

  return rows.map((row) => {
    const packet: MsgPacket = {
      v: PROTOCOL_VERSION,
      type: "msg",
      id: row.id,
      from: (row.from_role === "dev" ? "dev" : "usr") as Role,
      ts: row.ts,
      text: row.text,
    };
    if (row.kb) {
      try {
        packet.kb = JSON.parse(row.kb) as IBKeyboard;
      } catch {
        // A corrupted keyboard must not break the whole history response.
      }
    }
    return packet;
  });
}
