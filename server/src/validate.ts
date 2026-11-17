import { MAX_PACKET_SIZE, validatePacket, type Packet } from "@iot/shared";

export type ParseResult =
  | { ok: true; packet: Packet }
  | { ok: false; code: 400 | 413; reason: string };

/**
 * Parses and validates one wire packet. The 1024-byte limit is checked on the
 * raw UTF-8 bytes before JSON parsing (PROTOCOL.md §2, err 413).
 */
export function parsePacket(raw: Buffer | string): ParseResult {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  const bytes = Buffer.byteLength(text, "utf8");

  if (bytes > MAX_PACKET_SIZE) {
    return { ok: false, code: 413, reason: `packet exceeds ${MAX_PACKET_SIZE} bytes` };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, code: 400, reason: "invalid JSON" };
  }

  return validatePacket(json, bytes);
}
