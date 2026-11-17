import { describe, expect, it } from "vitest";
import { normalizeServerUrl, toHttpBase } from "./serverApi";

describe("normalizeServerUrl", () => {
  it("keeps ws and wss origins", () => {
    expect(normalizeServerUrl("ws://localhost:8080")).toBe("ws://localhost:8080");
    expect(normalizeServerUrl("wss://relay.example")).toBe("wss://relay.example");
  });

  it("adds ws:// to a bare host", () => {
    expect(normalizeServerUrl("192.168.1.10:8080")).toBe("ws://192.168.1.10:8080");
    expect(normalizeServerUrl("iotbot.local")).toBe("ws://iotbot.local");
  });

  it("converts http(s) URLs to ws(s)", () => {
    expect(normalizeServerUrl("http://192.168.1.10:8080")).toBe("ws://192.168.1.10:8080");
    expect(normalizeServerUrl("https://relay.example")).toBe("wss://relay.example");
  });

  it("strips the /ws path and trailing slashes", () => {
    expect(normalizeServerUrl("wss://relay.example/ws/")).toBe("wss://relay.example");
    expect(normalizeServerUrl("wss://relay.example/base/ws")).toBe(
      "wss://relay.example/base",
    );
  });

  it("rejects empty and unsupported URLs", () => {
    expect(normalizeServerUrl("")).toBeNull();
    expect(normalizeServerUrl("   ")).toBeNull();
    expect(normalizeServerUrl("ftp://relay.example")).toBeNull();
  });
});

describe("toHttpBase", () => {
  it("maps ws(s) to http(s) and keeps the path", () => {
    expect(toHttpBase("ws://localhost:8080")).toBe("http://localhost:8080");
    expect(toHttpBase("wss://relay.example/base")).toBe("https://relay.example/base");
  });
});
