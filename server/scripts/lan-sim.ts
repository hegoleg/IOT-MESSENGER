/**
 * IoTBotLAN simulator: an ESP8266/ESP32 that runs its own WebSocket server.
 *
 * Mirrors firmware/src/IoTBotLAN.cpp (PROTOCOL.md §1.2):
 *   - WS server on port 81, endpoint /ws?token=...
 *   - wrong token -> err 401 and close
 *   - status on connect, ping -> pong, rate limit for msg/cb
 *   - the same greenhouse logic as examples/lan (/start, /on, /off, /status,
 *     /stop, inline buttons and live sensor edits)
 *
 * Usage:
 *   npm run sim:lan -- [--port=81] [--token=demo-xxxx] [--telemetry=5]
 *                      [--rate-limit=30] [--quiet]
 *
 * Then open the PWA in "Локально" mode with the host printed by the script.
 */

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import {
  MAX_PACKET_SIZE,
  PROTOCOL_VERSION,
  WS_PATH,
  buildErrPacket,
  buildStatusPacket,
  validatePacket,
  type IBButton,
  type MsgPacket,
  type Packet,
} from "@iot/shared";

function readOption(name: string): string | undefined {
  const args = process.argv.slice(2);
  const withEquals = args.find((arg) => arg.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);

  const index = args.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  return undefined;
}

function intOption(name: string, fallback: number): number {
  const raw = readOption(name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) addresses.push(info.address);
    }
  }

  // Prefer ordinary home/office Wi-Fi over VPN and link-local interfaces:
  // the PWA on a phone needs the address that is reachable in that Wi-Fi.
  const rank = (ip: string): number => {
    if (ip.startsWith("192.168.")) return 0;
    if (ip.startsWith("10.")) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    if (ip.startsWith("169.254.")) return 9;
    return 5;
  };

  return addresses.sort((a, b) => rank(a) - rank(b));
}

const port = intOption("port", 81);
const token = readOption("token") ?? `demo-${randomBytes(12).toString("hex")}`;
const telemetrySeconds = intOption("telemetry", 5);
const rateLimit = Math.max(1, intOption("rate-limit", 30));
const quiet = process.argv.includes("--quiet");

const log = quiet
  ? () => undefined
  : (message: string) => console.log(`[lan-sim] ${message}`);

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    [
      "IoTBotLAN simulator (an ESP that runs its own WebSocket server)",
      "",
      "Options:",
      "  --port=<number>        listen port (default 81)",
      "  --token=<string>       LAN token, at least 16 chars (default: random demo-xxxx)",
      "  --telemetry=<seconds>  live sensor period after the status button (0 = off)",
      "  --rate-limit=<n>       inbound msg/cb per minute per client (default 30)",
      "  --quiet                do not log protocol traffic",
      "",
      "PWA: mode «Локально», host = this computer's IP (port 81 is added",
      "automatically). The token is printed on startup.",
    ].join("\n"),
  );
  process.exit(0);
}

/* ------------------------------------------------------------------------- */
/* Simulated device state                                                    */
/* ------------------------------------------------------------------------- */

interface ClientState {
  windowStart: number;
  count: number;
}

const MENU: IBButton[][] = [
  [
    { t: "Полив вкл", d: "on" },
    { t: "Полив выкл", d: "off" },
  ],
  [{ t: "Датчик", d: "status" }],
];

const clients = new Set<WebSocket>();
const limits = new Map<WebSocket, ClientState>();

let sequence = 0;
let relayOn = false;
let light = 64;
let liveMode = false;
let liveMessageId = "";
let liveTimer: ReturnType<typeof setInterval> | null = null;

function nextId(): string {
  sequence += 1;
  return `m_${sequence}`;
}

function sensorText(): string {
  return `Освещённость: ${light}%\nПолив: ${relayOn ? "включён" : "выключен"}`;
}

function updateSensor(): void {
  light = Math.min(100, Math.max(0, Math.round(light + (Math.random() - 0.5) * 6)));
}

function broadcast(packet: Packet): void {
  const payload = JSON.stringify(packet);
  for (const socket of clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

function publish(text: string, editId?: string, withMenu = false): string {
  const id = editId ?? nextId();
  const packet: MsgPacket = {
    v: PROTOCOL_VERSION,
    type: "msg",
    id,
    from: "dev",
    ts: 0, // same as the firmware: the client shows no timestamp
    text,
  };
  if (withMenu) packet.kb = MENU;
  if (editId) packet.edit = true;

  log(`-> ${editId ? "edit" : "msg"} ${id}: ${text.split("\n")[0]}`);
  broadcast(packet);
  return id;
}

function stopLive(): void {
  liveMode = false;
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
}

function startLive(messageId: string): void {
  stopLive();
  liveMode = true;
  liveMessageId = messageId;

  if (telemetrySeconds <= 0) return;

  liveTimer = setInterval(() => {
    if (!liveMode || clients.size === 0) return;
    updateSensor();
    publish(sensorText(), liveMessageId, true);
  }, telemetrySeconds * 1000);
  liveTimer.unref?.();
}

function handleText(text: string): void {
  const command = text.trim().toLowerCase();
  log(`<- msg "${command}"`);

  if (command === "/start") {
    publish("Теплица онлайн (LAN). Выберите действие:", undefined, true);
    return;
  }
  if (command === "/on") {
    relayOn = true;
    updateSensor();
    publish(sensorText());
    return;
  }
  if (command === "/off") {
    relayOn = false;
    updateSensor();
    publish(sensorText());
    return;
  }
  if (command === "/status") {
    updateSensor();
    publish(sensorText());
    return;
  }
  if (command === "/stop") {
    stopLive();
    publish("Живые обновления остановлены.");
    return;
  }

  publish("Неизвестная команда. Доступно: /start, /on, /off, /status, /stop");
}

function handleCallback(id: string, data: string): void {
  log(`<- cb "${data}" (message ${id})`);

  switch (data) {
    case "on":
      relayOn = true;
      updateSensor();
      publish(sensorText(), id, true);
      break;
    case "off":
      relayOn = false;
      updateSensor();
      publish(sensorText(), id, true);
      break;
    case "status":
      updateSensor();
      publish(sensorText(), id, true);
      startLive(id);
      break;
    default:
      publish(`Неизвестный callback: ${data}`);
      break;
  }
}

/* ------------------------------------------------------------------------- */
/* WebSocket server                                                          */
/* ------------------------------------------------------------------------- */

const httpServer = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, v: PROTOCOL_VERSION, clients: clients.size }));
    return;
  }

  if (url.pathname === "/") {
    const addresses = lanAddresses();
    const hosts = addresses.length > 0 ? addresses : ["127.0.0.1"];
    const rows = hosts
      .map((host) => `<li><code>ws://${host}:${port}/ws?token=${token}</code></li>`)
      .join("");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IoTBotLAN simulator</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6;background:#0b0b0a;color:#f2f0eb}code{background:#222;padding:2px 6px;border-radius:4px;word-break:break-all}a{color:#ff5a1f}h1{letter-spacing:-.04em}</style>
</head><body>
<h1>IoTBotLAN simulator</h1>
<p>Виртуальная ESP с локальным WebSocket-сервером. Подключённых клиентов: <b>${clients.size}</b>.</p>
<ol>
  <li>Откройте PWA в режиме <b>«Локально»</b>.</li>
  <li>Хост устройства: <code>${hosts[0]}</code> (порт 81 подставится сам).</li>
  <li>Токен: <code>${token}</code>.</li>
</ol>
<p>Endpoint:</p><ul>${rows}</ul>
<p>Команды: <code>/start</code>, <code>/on</code>, <code>/off</code>, <code>/status</code>, <code>/stop</code>.</p>
<p><a href="/health">/health</a></p>
</body></html>`);
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not Found");
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

httpServer.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname !== WS_PATH) {
    rejectUpgrade(socket, 404, "Not Found");
    return;
  }

  wss.handleUpgrade(request, socket, head, (client) => {
    const provided = url.searchParams.get("token");
    if (!provided || provided !== token) {
      client.send(JSON.stringify(buildErrPacket(401, "invalid token")));
      client.close(4001, "invalid token");
      return;
    }

    clients.add(client);
    limits.set(client, { windowStart: Date.now(), count: 0 });
    client.send(JSON.stringify(buildStatusPacket(true, 0)));
    log(`client connected (${clients.size} total)`);

    client.on("message", (data, isBinary) => {
      handleMessage(client, data.toString(), isBinary);
    });
    client.on("close", () => {
      clients.delete(client);
      limits.delete(client);
      log(`client disconnected (${clients.size} left)`);
    });
    client.on("error", (error) => {
      log(`client error: ${error.message}`);
    });
  });
});

function allowPacket(socket: WebSocket): boolean {
  const state = limits.get(socket);
  if (!state) return false;

  const now = Date.now();
  if (now - state.windowStart >= 60_000) {
    state.windowStart = now;
    state.count = 0;
  }
  if (state.count >= rateLimit) return false;

  state.count += 1;
  return true;
}

function sendErr(socket: WebSocket, code: 400 | 413 | 429, message: string): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(buildErrPacket(code, message)));
  }
}

function handleMessage(socket: WebSocket, raw: string, isBinary: boolean): void {
  if (isBinary) {
    sendErr(socket, 400, "binary frames are not supported");
    return;
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_PACKET_SIZE) {
    sendErr(socket, 413, `packet exceeds ${MAX_PACKET_SIZE} bytes`);
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    sendErr(socket, 400, "invalid JSON");
    return;
  }

  const parsed = validatePacket(json, Buffer.byteLength(raw, "utf8"));
  if (!parsed.ok) {
    sendErr(socket, parsed.code, parsed.reason);
    return;
  }

  const packet = parsed.packet;
  switch (packet.type) {
    case "ping":
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "pong" }));
      }
      return;
    case "pong":
    case "err":
      return;
    case "status":
      sendErr(socket, 400, "status packets are generated by the device");
      return;
    case "msg":
      if (!allowPacket(socket)) {
        sendErr(socket, 429, "message rate limit exceeded");
        return;
      }
      if (packet.from !== "usr") {
        sendErr(socket, 400, 'from must be "usr"');
        return;
      }
      handleText(packet.text);
      return;
    case "cb":
      if (!allowPacket(socket)) {
        sendErr(socket, 429, "message rate limit exceeded");
        return;
      }
      handleCallback(packet.id, packet.d);
      return;
  }
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const statusText = status === 404 ? "Not Found" : "Error";
  socket.write(
    `HTTP/1.1 ${status} ${statusText}\r\n` +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(message)}\r\n` +
      "Connection: close\r\n\r\n" +
      message,
  );
  socket.destroy();
}

/* ------------------------------------------------------------------------- */
/* Startup and shutdown                                                      */
/* ------------------------------------------------------------------------- */

const hosts = lanAddresses();
const shownHost = hosts[0] ?? "127.0.0.1";

if (token.length < 16) {
  console.warn(
    "[lan-sim] warning: token is shorter than 16 chars; the PWA requires at least 16",
  );
}

httpServer.listen(port, "0.0.0.0", () => {
  console.log("[lan-sim] IoT-Messenger LAN simulator (IoTBotLAN)");
  console.log(`[lan-sim] token: ${token}`);
  console.log(`[lan-sim] listening on 0.0.0.0:${port}`);
  console.log(`[lan-sim] PWA → «Локально» → хост: ${shownHost} (порт 81 подставится)`);
  console.log(`[lan-sim] ws://${shownHost}:${port}/ws?token=${token}`);
  console.log(`[lan-sim] подсказка для телефона: http://${shownHost}:${port}/`);
  console.log("[lan-sim] commands: /start /on /off /status /stop");
  if (hosts.length > 1) {
    console.log(`[lan-sim] other addresses: ${hosts.slice(1).join(", ")}`);
  }
});

const shutdown = (): void => {
  console.log("[lan-sim] stopping");
  stopLive();
  for (const socket of clients) socket.close(1001, "simulator stopped");
  wss.close();
  httpServer.close();
  void delay(100).then(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
