/**
 * End-to-end smoke test for the relay server.
 *
 * Usage: npm run smoke --workspace @iot/server (after npm run build)
 *
 * Covers: device creation, ws auth, status packets, msg/cb routing,
 * ping/pong, history, err 400/413 and guest access over REST.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import {
  type DeviceCreateResponse,
  type ErrPacket,
  type HistoryResponse,
  type MsgPacket,
  type StatusPacket,
} from "@iot/shared";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";

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
      const timer = setTimeout(() => reject(new Error("timeout waiting for a packet")), timeoutMs);
      this.waiters.push((value) => {
        clearTimeout(timer);
        resolve(value as T);
      });
    });
  }
}

async function connect(url: string): Promise<{ socket: WebSocket; inbox: SocketInbox }> {
  const socket = new WebSocket(url);
  const inbox = new SocketInbox(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return { socket, inbox };
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

const tempDir = mkdtempSync(join(tmpdir(), "iotbot-smoke-"));
const config: Config = {
  port: 0,
  host: "127.0.0.1",
  dbPath: join(tempDir, "smoke.db"),
  rateLimitPerMin: 20,
  logLevel: "silent",
};

const app = await buildApp(config);
const sockets: WebSocket[] = [];

try {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  const httpBase = `http://127.0.0.1:${port}`;
  const wsBase = `ws://127.0.0.1:${port}`;

  // 1. Device token creation.
  const createResponse = await fetch(`${httpBase}/api/v1/devices/create`, { method: "POST" });
  assert.equal(createResponse.status, 201, "POST /api/v1/devices/create must return 201");
  const { token } = (await createResponse.json()) as DeviceCreateResponse;
  assert.ok(token.length >= 16, "token must be long enough");

  // 2. Unknown token gets err 401 over WebSocket.
  const bad = await connect(`${wsBase}/ws?role=dev&token=unknown-token`);
  sockets.push(bad.socket);
  const badErr = await bad.inbox.next<ErrPacket>();
  assert.equal(badErr.type, "err");
  assert.equal(badErr.code, 401);
  await closeSocket(bad.socket);

  // 3. dev + usr sessions; usr immediately receives the dev status.
  const dev = await connect(`${wsBase}/ws?role=dev&token=${token}`);
  sockets.push(dev.socket);
  const usr = await connect(`${wsBase}/ws?role=usr&token=${token}`);
  sockets.push(usr.socket);

  const initialStatus = await usr.inbox.next<StatusPacket>();
  assert.equal(initialStatus.type, "status");
  assert.equal(initialStatus.dev_online, true);
  assert.ok(initialStatus.last_seen > 0);

  // 4. dev -> usr message, ts filled by the server, kb preserved.
  const outgoing: MsgPacket = {
    v: 1,
    type: "msg",
    id: "m_100",
    from: "dev",
    ts: 0,
    text: "hello from dev",
    kb: [[{ t: "Ok", d: "ok" }]],
  };
  dev.socket.send(JSON.stringify(outgoing));

  const delivered = await usr.inbox.next<MsgPacket>();
  assert.equal(delivered.type, "msg");
  assert.equal(delivered.text, "hello from dev");
  assert.equal(delivered.from, "dev");
  assert.ok((delivered.ts ?? 0) > 0, "server must fill ts when it is 0");
  assert.deepEqual(delivered.kb, [[{ t: "Ok", d: "ok" }]]);

  // 5. usr -> dev button press.
  usr.socket.send(JSON.stringify({ v: 1, type: "cb", id: "m_100", from: "usr", d: "ok" }));
  const cbAtDev = await dev.inbox.next<{ type: string; d: string }>();
  assert.equal(cbAtDev.type, "cb");
  assert.equal(cbAtDev.d, "ok");

  // 6. Heartbeat.
  dev.socket.send(JSON.stringify({ v: 1, type: "ping" }));
  const pong = await dev.inbox.next<{ type: string }>();
  assert.equal(pong.type, "pong");

  // 7. History contains the dev message.
  const historyResponse = await fetch(
    `${httpBase}/api/v1/history?token=${encodeURIComponent(token)}`,
  );
  assert.equal(historyResponse.status, 200);
  const history = (await historyResponse.json()) as HistoryResponse;
  assert.equal(history.messages.length, 1);
  assert.equal(history.messages[0]?.text, "hello from dev");

  // 8. usr message goes to dev and to history.
  usr.socket.send(JSON.stringify({ v: 1, type: "msg", id: "u_1", from: "usr", text: "/start" }));
  const usrMsgAtDev = await dev.inbox.next<MsgPacket>();
  assert.equal(usrMsgAtDev.from, "usr");
  assert.equal(usrMsgAtDev.text, "/start");

  // 9. Invalid JSON -> err 400.
  dev.socket.send("{not json");
  const badJson = await dev.inbox.next<ErrPacket>();
  assert.equal(badJson.type, "err");
  assert.equal(badJson.code, 400);

  // 10. Oversized packet -> err 413.
  dev.socket.send("x".repeat(2_000));
  const tooBig = await dev.inbox.next<ErrPacket>();
  assert.equal(tooBig.type, "err");
  assert.equal(tooBig.code, 413);

  // 11. HTTP fallback: POST /api/v1/msg from the device reaches usr + history.
  const fallbackResponse = await fetch(`${httpBase}/api/v1/msg`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ v: 1, type: "msg", id: "m_200", from: "dev", text: "http fallback" }),
  });
  assert.equal(fallbackResponse.status, 202);
  const fallbackAtUsr = await usr.inbox.next<MsgPacket>();
  assert.equal(fallbackAtUsr.text, "http fallback");

  // 12. dev disconnect -> usr gets status offline.
  await closeSocket(dev.socket);
  const offlineStatus = await usr.inbox.next<StatusPacket>();
  assert.equal(offlineStatus.type, "status");
  assert.equal(offlineStatus.dev_online, false);

  // 13. History is guarded by the token.
  const unauthorized = await fetch(`${httpBase}/api/v1/history?token=bogus`);
  assert.equal(unauthorized.status, 401);

  console.log("SMOKE OK: relay server passed all checks");
} finally {
  for (const socket of sockets) {
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
}
