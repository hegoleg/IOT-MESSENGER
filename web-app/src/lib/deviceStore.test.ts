// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEVICES_STORAGE_KEY,
  loadDevices,
  normalizeLocalHost,
  prepareDevice,
  sanitizeDevices,
  saveDevices,
} from "./deviceStore";
import type { StoredDevice } from "./types";

const TOKEN_A = "Token_1234567890";
const TOKEN_B = "AbCdEfGhIjKlMnOp";

function device(token: string, name = "Dev"): StoredDevice {
  return { token, name, addedAt: Date.now() };
}

describe("normalizeLocalHost", () => {
  it("keeps a plain host", () => {
    expect(normalizeLocalHost("192.168.1.50")).toBe("192.168.1.50");
  });

  it("strips scheme, path, query and :81", () => {
    expect(normalizeLocalHost("ws://192.168.1.50:81/ws?token=x")).toBe("192.168.1.50");
    expect(normalizeLocalHost("https://device.local/path")).toBe("device.local");
  });

  it("returns undefined for empty values", () => {
    expect(normalizeLocalHost("")).toBeUndefined();
    expect(normalizeLocalHost("   ")).toBeUndefined();
    expect(normalizeLocalHost(undefined)).toBeUndefined();
  });
});

describe("sanitizeDevices", () => {
  it("ignores non-array payloads", () => {
    expect(sanitizeDevices(null)).toEqual([]);
    expect(sanitizeDevices({})).toEqual([]);
  });

  it("drops invalid tokens and duplicates", () => {
    const result = sanitizeDevices([
      { token: "short", name: "bad" },
      { token: TOKEN_A, name: "one" },
      { token: TOKEN_A, name: "duplicate" },
      { token: TOKEN_B },
    ]);

    expect(result.map((item) => item.token)).toEqual([TOKEN_A, TOKEN_B]);
    expect(result[0]?.name).toBe("one");
    expect(result[1]?.name).toBe(`Устройство ${TOKEN_B.slice(-4)}`);
  });

  it("caps the list at 50 devices", () => {
    const items = Array.from({ length: 60 }, (_, index) => ({
      token: `token_${String(index).padStart(12, "0")}`,
    }));
    expect(sanitizeDevices(items)).toHaveLength(50);
  });
});

describe("prepareDevice", () => {
  it("rejects invalid and duplicate tokens", () => {
    expect(() => prepareDevice({ token: "bad" }, [])).toThrow("Некорректный токен");
    expect(() => prepareDevice({ token: TOKEN_A }, [device(TOKEN_A)])).toThrow(
      "уже добавлено",
    );
  });

  it("normalizes the name and LAN host", () => {
    const result = prepareDevice(
      { token: TOKEN_A, name: "  Теплица  ", localHost: "ws://10.0.0.5:81/ws" },
      [],
    );
    expect(result.name).toBe("Теплица");
    expect(result.localHost).toBe("10.0.0.5");
  });
});

describe("localStorage persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips the device list", () => {
    saveDevices([device(TOKEN_A, "one"), device(TOKEN_B, "two")]);
    expect(loadDevices().map((item) => item.token)).toEqual([TOKEN_A, TOKEN_B]);
  });

  it("survives corrupted JSON", () => {
    window.localStorage.setItem(DEVICES_STORAGE_KEY, "{not json");
    expect(loadDevices()).toEqual([]);
  });
});
