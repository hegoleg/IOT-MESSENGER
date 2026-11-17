import { describe, expect, it } from "vitest";
import { MAX_PACKET_SIZE, isCbPacket, validatePacket } from "@iot/shared";

function validMessage() {
  return {
    v: 1,
    type: "msg",
    id: "m_1",
    from: "dev",
    ts: 1_794_905_120,
    text: "hello",
    kb: [[{ t: "Ok", d: "ok" }]],
  };
}

describe("validatePacket", () => {
  it("accepts a valid msg packet with a keyboard", () => {
    const result = validatePacket(validMessage());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.packet.type).toBe("msg");
    }
  });

  it("rejects unknown types and protocol versions", () => {
    expect(validatePacket({ ...validMessage(), type: "nope" }).ok).toBe(false);
    expect(validatePacket({ ...validMessage(), v: 2 }).ok).toBe(false);
  });

  it("enforces the text and packet size limits", () => {
    expect(validatePacket({ ...validMessage(), text: "x".repeat(513) }).ok).toBe(false);

    const tooLarge = validatePacket(validMessage(), MAX_PACKET_SIZE + 1);
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(tooLarge.code).toBe(413);
  });

  it("enforces the keyboard 3x3 limit", () => {
    const fourRows = { ...validMessage(), kb: Array.from({ length: 4 }, () => [{ t: "x", d: "x" }]) };
    expect(validatePacket(fourRows).ok).toBe(false);

    const fourButtons = {
      ...validMessage(),
      kb: [[{ t: "a", d: "a" }, { t: "b", d: "b" }, { t: "c", d: "c" }, { t: "d", d: "d" }]],
    };
    expect(validatePacket(fourButtons).ok).toBe(false);
  });

  it("validates callback packets", () => {
    const callback = { v: 1, type: "cb", id: "m_1", from: "usr", d: "ok" };
    expect(validatePacket(callback).ok).toBe(true);
    expect(isCbPacket(callback)).toBe(true);
    expect(validatePacket({ ...callback, from: "dev" }).ok).toBe(false);
    expect(isCbPacket({ ...callback, d: "" })).toBe(false);
  });
});
