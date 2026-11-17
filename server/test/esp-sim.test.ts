/**
 * Integration test: a simulated ESP talks to the real relay server while a
 * "usr" client (the PWA role) drives commands and callbacks.
 *
 * Run with: npm test --workspace @iot/server
 */

import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type {
  HistoryResponse,
  MsgPacket,
  StatusPacket,
} from "@iot/shared";
import { buildApp } from "../src/app.ts";
import type { Config } from "../src/config.js";
import { EspSimulator } from "../scripts/esp-sim/simulator.ts";

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

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const tempDir = mkdtempSync(join(tmpdir(), "iotbot-esp-sim-"));
let app: Awaited<ReturnType<typeof buildApp>> | null = null;
let port = 0;
let token = "";

before(async () => {
  const config: Config = {
    port: 0,
    host: "127.0.0.1",
    dbPath: join(tempDir, "sim.db"),
    rateLimitPerMin: 100,
    logLevel: "silent",
  };

  app = await buildApp(config);
  await app.listen({ port: 0, host: "127.0.0.1" });

  const address = app.server.address() as AddressInfo;
  port = address.port;

  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
  assert.equal(response.status, 200, "health endpoint must respond");
  const health = (await response.json()) as { ok?: unknown; v?: unknown };
  assert.equal(health.ok, true);
  assert.equal(health.v, 1);

  const createResponse = await fetch(`http://127.0.0.1:${port}/api/v1/devices/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(createResponse.status, 201, "device creation must succeed");

  const payload = (await createResponse.json()) as { token: string };
  token = payload.token;
  assert.ok(token.length >= 16);
});

after(async () => {
  if (app) await app.close();
  rmSync(tempDir, { recursive: true, force: true });
});

it("simulated ESP completes the protocol flow through the relay", { timeout: 15_000 }, async () => {
  const usr = await connect(`ws://127.0.0.1:${port}/ws?role=usr&token=${token}`);
  const inbox = new SocketInbox(usr);
  const logs: string[] = [];

  const simulator = new EspSimulator({
    serverUrl: `ws://127.0.0.1:${port}`,
    token,
    log: (line) => logs.push(line),
    pingIntervalMs: 80,
    pongTimeoutMs: 400,
    reconnectDelayMs: 100,
    telemetryIntervalMs: 0,
  });

  simulator.start();

  try {
    // 1. The device comes online.
    const online = await inbox.next<StatusPacket>();
    assert.equal(online.type, "status");
    assert.equal(online.dev_online, true);

    // 2. /start returns an inline menu built by the simulated board.
    usr.send(JSON.stringify({ v: 1, type: "msg", id: "u_start", from: "usr", text: "/start" }));
    const menu = await inbox.next<MsgPacket>();
    assert.equal(menu.type, "msg");
    assert.equal(menu.from, "dev");
    assert.ok(menu.kb && menu.kb.length >= 2, "menu must contain an inline keyboard");

    // 3. A button press edits the message that owns the button.
    usr.send(JSON.stringify({ v: 1, type: "cb", id: menu.id, from: "usr", d: "pump_on" }));
    const edited = await inbox.next<MsgPacket>();
    assert.equal(edited.type, "msg");
    assert.equal(edited.id, menu.id, "callback must edit the source message");
    assert.match(edited.text, /Полив включён/);
    assert.ok(edited.kb && edited.kb.length > 0, "edited message keeps a keyboard");

    // 4. /status returns fresh sensor data.
    usr.send(JSON.stringify({ v: 1, type: "msg", id: "u_status", from: "usr", text: "/status" }));
    const sensor = await inbox.next<MsgPacket>();
    assert.equal(sensor.from, "dev");
    assert.match(sensor.text, /Температура:/);
    assert.match(sensor.text, /Влажность:/);

    // 5. Heartbeat keeps the simulated board online (fast test timings).
    await delay(400);
    assert.equal(simulator.isOnline(), true, "device must survive several heartbeat cycles");
    assert.ok(
      logs.some((line) => line.includes("connected as role=dev")),
      "simulator logs the connection",
    );

    // 6. The relay stores the conversation for the history endpoint.
    const historyResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/history?token=${encodeURIComponent(token)}`,
    );
    assert.equal(historyResponse.status, 200);
    const history = (await historyResponse.json()) as HistoryResponse;
    assert.ok(history.messages.length >= 3, "history must contain the conversation");

    // 7. Stopping the device makes the relay report it offline.
    simulator.stop();
    const offline = await inbox.next<StatusPacket>(3_000);
    assert.equal(offline.type, "status");
    assert.equal(offline.dev_online, false);
  } finally {
    simulator.stop();
    await closeSocket(usr);
  }
});
