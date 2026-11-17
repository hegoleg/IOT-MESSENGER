/**
 * Integration tests for the admin API (PROTOCOL.md §4.5–4.7), metrics
 * counters, device deletion, history pruning and protocol errors.
 *
 * Run with: npm test
 */

import { after, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type {
  DeviceCreateResponse,
  DeviceDeleteResponse,
  DeviceListResponse,
  ErrPacket,
  HistoryResponse,
  MetricsResponse,
  MsgPacket,
} from "@iot/shared";
import { buildApp } from "../src/app.ts";
import type { Config } from "../src/config.ts";
import { resetStats } from "../src/stats.ts";

const ADMIN_KEY = "test-admin-key";
const servers: Array<{ app: Awaited<ReturnType<typeof buildApp>>; dir: string }> = [];

class SocketInbox {
  private readonly queue: unknown[] = [];
  private readonly waiters: Array<(value: unknown) => void> = [];

  constructor(socket: WebSocket) {
    socket.on("message", (data) => {
      const value: unknown = JSON.parse(data.toString());
      const waiter = this.waiters.shift();
      if (waiter) waiter(value);
      else this.queue.push(value);
    });
  }

  next<T>(timeoutMs = 3_000): Promise<T> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift() as T);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timeout waiting for a relay packet")),
        timeoutMs,
      );
      this.waiters.push((value) => {
        clearTimeout(timer);
        resolve(value as T);
      });
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(overrides: Partial<Config> = {}): Promise<{ app: Awaited<ReturnType<typeof buildApp>>; port: number }> {
  const dir = mkdtempSync(join(tmpdir(), "iotbot-admin-"));
  const config: Config = {
    port: 0,
    host: "127.0.0.1",
    dbPath: join(dir, "test.db"),
    rateLimitPerMin: 200,
    logLevel: "silent",
    adminKey: ADMIN_KEY,
    ...overrides,
  };

  const app = await buildApp(config);
  await app.listen({ port: 0, host: "127.0.0.1" });
  servers.push({ app, dir });

  const { port } = app.server.address() as AddressInfo;
  return { app, port };
}

function httpUrl(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function wsUrl(port: number, role: "dev" | "usr", token: string): string {
  return `ws://127.0.0.1:${port}/ws?role=${role}&token=${encodeURIComponent(token)}`;
}

function adminHeaders(key = ADMIN_KEY): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

/** Headers for requests without a body (GET/DELETE): no Content-Type, else Fastify answers 400. */
function authHeaders(key = ADMIN_KEY): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

async function createDevice(port: number): Promise<string> {
  const response = await fetch(httpUrl(port, "/api/v1/devices/create"), {
    method: "POST",
    headers: adminHeaders(),
    body: "{}",
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as DeviceCreateResponse;
  return body.token;
}

async function getDevices(port: number, key = ADMIN_KEY): Promise<DeviceListResponse> {
  const response = await fetch(httpUrl(port, "/api/v1/devices"), {
    headers: authHeaders(key),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as DeviceListResponse;
}

async function getMetrics(port: number, key = ADMIN_KEY): Promise<MetricsResponse> {
  const response = await fetch(httpUrl(port, "/api/v1/metrics"), {
    headers: authHeaders(key),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as MetricsResponse;
}

async function getHistory(port: number, token: string): Promise<HistoryResponse> {
  const response = await fetch(
    httpUrl(port, `/api/v1/history?token=${encodeURIComponent(token)}`),
  );
  assert.equal(response.status, 200);
  return (await response.json()) as HistoryResponse;
}

async function postMsg(
  port: number,
  token: string,
  packet: Partial<MsgPacket> & { id: string },
): Promise<Response> {
  return fetch(httpUrl(port, "/api/v1/msg"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, type: "msg", from: "dev", ts: 1_000, ...packet }),
  });
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

/**
 * Connects and subscribes to packets before the socket opens, so the initial
 * status packet cannot be missed.
 */
function connectWithInbox(url: string): Promise<{ socket: WebSocket; inbox: SocketInbox }> {
  const socket = new WebSocket(url);
  const inbox = new SocketInbox(socket);
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve({ socket, inbox }));
    socket.once("error", reject);
  });
}

function closeSocket(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    socket.once("close", () => resolve());
    socket.close();
  });
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket was not closed")), 3_000);
    socket.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

after(async () => {
  for (const { app, dir } of servers) {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("admin API is disabled with 401 when ADMIN_KEY is not configured", async () => {
  const { port } = await startServer({ adminKey: undefined });

  const list = await fetch(httpUrl(port, "/api/v1/devices"));
  assert.equal(list.status, 401);
  assert.equal(((await list.json()) as ErrPacket).code, 401);

  const metrics = await fetch(httpUrl(port, "/api/v1/metrics"));
  assert.equal(metrics.status, 401);

  const remove = await fetch(httpUrl(port, "/api/v1/devices/whatever"), { method: "DELETE" });
  assert.equal(remove.status, 401);
});

it("admin API rejects a wrong ADMIN_KEY", async () => {
  const { port } = await startServer();

  const list = await fetch(httpUrl(port, "/api/v1/devices"), {
    headers: authHeaders("wrong-key"),
  });
  assert.equal(list.status, 401);

  const metrics = await fetch(httpUrl(port, "/api/v1/metrics"), {
    headers: { Authorization: "Bearer wrong-key" },
  });
  assert.equal(metrics.status, 401);

  const create = await fetch(httpUrl(port, "/api/v1/devices/create"), {
    method: "POST",
    headers: adminHeaders("wrong-key"),
    body: "{}",
  });
  assert.equal(create.status, 401);
});

it("device list reports tokens and the live online flag", async () => {
  const { port } = await startServer();
  const first = await createDevice(port);
  const second = await createDevice(port);

  let list = await getDevices(port);
  assert.deepEqual(
    list.devices.map((device) => device.token),
    [first, second],
    "devices are ordered by creation time",
  );
  assert.equal(list.devices[0]?.online, false);

  const dev = await connect(wsUrl(port, "dev", first));
  try {
    await delay(50);
    list = await getDevices(port);
    assert.equal(list.devices[0]?.online, true, "connected dev socket is online");
    assert.equal(list.devices[1]?.online, false);
    assert.ok((list.devices[0]?.last_seen ?? 0) > 0);
  } finally {
    await closeSocket(dev);
  }
});

it("DELETE removes the device with its history and returns 404 for unknown tokens", async () => {
  const { port } = await startServer();
  const token = await createDevice(port);

  const posted = await postMsg(port, token, { id: "d1", text: "hello" });
  assert.equal(posted.status, 202);
  assert.equal((await getHistory(port, token)).messages.length, 1);

  const remove = await fetch(httpUrl(port, `/api/v1/devices/${token}`), {
    method: "DELETE",
    headers: authHeaders(),
  });
  assert.equal(remove.status, 200);
  assert.deepEqual((await remove.json()) as DeviceDeleteResponse, { ok: true });

  const history = await fetch(httpUrl(port, `/api/v1/history?token=${encodeURIComponent(token)}`));
  assert.equal(history.status, 401, "history of a deleted device is gone");

  const again = await fetch(httpUrl(port, `/api/v1/devices/${token}`), {
    method: "DELETE",
    headers: authHeaders(),
  });
  assert.equal(again.status, 404);
  assert.deepEqual(await again.json(), { ok: false, error: "device not found" });

  const list = await getDevices(port);
  assert.equal(list.devices.some((device) => device.token === token), false);
});

it("DELETE closes live sockets of the device", async () => {
  const { port } = await startServer();
  const token = await createDevice(port);

  const dev = await connect(wsUrl(port, "dev", token));
  const usr = await connect(wsUrl(port, "usr", token));
  const devClosed = waitForClose(dev);
  const usrClosed = waitForClose(usr);

  const remove = await fetch(httpUrl(port, `/api/v1/devices/${token}`), {
    method: "DELETE",
    headers: authHeaders(),
  });
  assert.equal(remove.status, 200);

  assert.equal(await devClosed, 4000);
  assert.equal(await usrClosed, 4000);
});

it("metrics count live connections, routed/stored messages and protocol errors", async () => {
  resetStats();
  const { port } = await startServer();
  const token = await createDevice(port);

  const dev = await connect(wsUrl(port, "dev", token));
  const { socket: usr, inbox } = await connectWithInbox(wsUrl(port, "usr", token));

  try {
    await inbox.next(); // initial status packet for the usr connection
    await delay(50);

    // One valid message from usr -> dev.
    usr.send(JSON.stringify({ v: 1, type: "msg", id: "m1", from: "usr", text: "hi" }));

    // Oversized packet (> 1024 bytes) -> err 413.
    usr.send(JSON.stringify({ v: 1, type: "msg", id: "m2", from: "usr", text: "x".repeat(1_500) }));
    const tooBig = await inbox.next<ErrPacket>();
    assert.equal(tooBig.type, "err");
    assert.equal(tooBig.code, 413);

    // Broken JSON -> err 400.
    usr.send("not json");
    const bad = await inbox.next<ErrPacket>();
    assert.equal(bad.code, 400);

    const metrics = await getMetrics(port);
    assert.equal(metrics.connections_dev, 1);
    assert.equal(metrics.connections_usr, 1);
    assert.equal(metrics.messages_routed, 1, "rejected packets are not routed");
    assert.equal(metrics.messages_stored, 1);
    assert.equal(metrics.errors_400, 1);
    assert.equal(metrics.errors_413, 1);
    assert.equal(metrics.errors_429, 0);
    assert.ok(metrics.uptime >= 0);
  } finally {
    await closeSocket(usr);
    await closeSocket(dev);
  }
});

it("rate limit answers err 429 and the metrics counter grows", async () => {
  resetStats();
  const { port } = await startServer({ rateLimitPerMin: 2 });
  const token = await createDevice(port);

  const { socket: usr, inbox } = await connectWithInbox(wsUrl(port, "usr", token));

  try {
    await inbox.next(); // initial status packet

    usr.send(JSON.stringify({ v: 1, type: "msg", id: "r1", from: "usr", text: "one" }));
    usr.send(JSON.stringify({ v: 1, type: "msg", id: "r2", from: "usr", text: "two" }));
    usr.send(JSON.stringify({ v: 1, type: "msg", id: "r3", from: "usr", text: "three" }));

    const limited = await inbox.next<ErrPacket>();
    assert.equal(limited.type, "err");
    assert.equal(limited.code, 429);

    const metrics = await getMetrics(port);
    assert.equal(metrics.errors_429, 1);
    assert.equal(metrics.messages_routed, 2);
  } finally {
    await closeSocket(usr);
  }
});

it("history keeps the last 50 messages and an edit preserves the original ts", async () => {
  const { port } = await startServer();
  const token = await createDevice(port);

  for (let index = 0; index < 55; index += 1) {
    const response = await postMsg(port, token, {
      id: `p${index}`,
      ts: 1_000 + index,
      text: `message ${index}`,
    });
    assert.equal(response.status, 202);
  }

  const history = await getHistory(port, token);
  assert.equal(history.messages.length, 50, "history is pruned to 50 rows");
  assert.equal(history.messages[0]?.id, "p5", "the five oldest messages are dropped");
  assert.equal(history.messages[49]?.id, "p54");

  const edited = await postMsg(port, token, { id: "p10", ts: 9_999, text: "edited" });
  assert.equal(edited.status, 202);

  const afterEdit = await getHistory(port, token);
  const target = afterEdit.messages.find((message) => message.id === "p10");
  assert.ok(target, "edited message is still in history");
  assert.equal(target.text, "edited");
  assert.equal(target.ts, 1_010, "edit keeps the original ts");
  assert.equal(afterEdit.messages.length, 50, "edit does not add a row");
});

it("HTTP /api/v1/msg rejects an oversized body with 413", async () => {
  resetStats();
  const { port } = await startServer();
  const token = await createDevice(port);

  const response = await fetch(httpUrl(port, "/api/v1/msg"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, type: "msg", from: "dev", id: "big", text: "y".repeat(2_000) }),
  });
  assert.equal(response.status, 413);
  assert.equal(((await response.json()) as ErrPacket).code, 413);

  const metrics = await getMetrics(port);
  assert.equal(metrics.errors_413, 1);
});
