import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import {
  PROTOCOL_VERSION,
  WS_PATH,
  buildErrPacket,
  buildStatusPacket,
  type MsgPacket,
  type Role,
} from "@iot/shared";
import type { Config } from "./config.js";
import type { DB } from "./db.js";
import { deviceExists, getLastSeen, nowSec, touchDevice } from "./devices.js";
import { saveMessage } from "./history.js";
import { notifyOfflineUsr } from "./push.js";
import { RateLimiter } from "./rate-limit.js";
import { Relay } from "./relay.js";
import { countError, countMessageRouted } from "./stats.js";
import { parsePacket } from "./validate.js";

/** ws-level ping interval that cleans up dead TCP connections. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Safety net above the protocol limit; anything > 1024 bytes is rejected with err 413. */
const MAX_FRAME_BYTES = 64 * 1024;

interface ConnectionMeta {
  role: Role;
  token: string;
}

type LiveSocket = WebSocket & { isAlive: boolean };

interface WebSocketDeps {
  db: DB;
  relay: Relay;
  config: Config;
  log: FastifyBaseLogger;
}

/**
 * Attaches the relay WebSocket endpoint (`/ws?role=dev|usr&token=...`).
 * Returns an async cleanup function for the Fastify onClose hook.
 */
export function attachWebSocket(
  app: FastifyInstance,
  deps: WebSocketDeps,
): () => Promise<void> {
  const server = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname !== WS_PATH) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const role = url.searchParams.get("role");
    const token = url.searchParams.get("token");

    if (role !== "dev" && role !== "usr") {
      rejectUpgrade(socket, 400, "role must be dev or usr");
      return;
    }
    if (!token) {
      rejectUpgrade(socket, 401, "token is required");
      return;
    }

    server.handleUpgrade(request, socket, head, (client) => {
      if (!deviceExists(deps.db, token)) {
        // Finish the handshake so the client receives a protocol-level error.
        sendErr(client, 401, "Invalid token");
        client.close(4401, "invalid token");
        return;
      }
      registerConnection(client as LiveSocket, { role, token }, deps);
    });
  };

  app.server.on("upgrade", onUpgrade);

  const heartbeat = setInterval(() => {
    for (const client of server.clients) {
      const socket = client as LiveSocket;
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return async () => {
    clearInterval(heartbeat);
    app.server.off("upgrade", onUpgrade);

    // Wait for "close" so close handlers finish their DB work before db.close().
    await Promise.allSettled(
      [...server.clients].map(
        (client) =>
          new Promise<void>((resolve) => {
            if (client.readyState === WebSocket.CLOSED) {
              resolve();
              return;
            }
            client.once("close", () => resolve());
            client.terminate();
          }),
      ),
    );

    server.close();
  };
}

function registerConnection(
  socket: LiveSocket,
  meta: ConnectionMeta,
  deps: WebSocketDeps,
): void {
  const { role, token } = meta;
  socket.isAlive = true;
  deps.relay.add(token, role, socket);

  if (role === "dev") {
    const lastSeen = touchDevice(deps.db, token);
    broadcastStatus(deps, token, true, lastSeen);
  } else {
    // PROTOCOL.md §1.1: on connect the server reports the peer state.
    sendJson(socket, buildStatusPacket(deps.relay.isDevOnline(token), getLastSeen(deps.db, token)));
  }

  const limiter = new RateLimiter(deps.config.rateLimitPerMin);

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", (data, isBinary) => {
    handleMessage(socket, meta, deps, limiter, data, isBinary);
  });

  socket.on("close", () => {
    deps.relay.remove(token, role, socket);
    if (role === "dev" && !deps.relay.isDevOnline(token)) {
      broadcastStatus(deps, token, false, getLastSeen(deps.db, token));
    }
  });

  socket.on("error", (error) => {
    deps.log.warn({ err: error, role, tokenSuffix: token.slice(-4) }, "websocket error");
  });
}

function handleMessage(
  socket: WebSocket,
  meta: ConnectionMeta,
  deps: WebSocketDeps,
  limiter: RateLimiter,
  data: WebSocket.RawData,
  isBinary: boolean,
): void {
  if (isBinary) {
    sendErr(socket, 400, "binary frames are not supported");
    return;
  }

  const parsed = parsePacket(rawDataToString(data));
  if (!parsed.ok) {
    sendErr(socket, parsed.code, parsed.reason);
    return;
  }

  const packet = parsed.packet;
  switch (packet.type) {
    case "ping":
      sendJson(socket, { v: PROTOCOL_VERSION, type: "pong" });
      return;
    case "pong":
    case "err":
      return;
    case "status":
      sendErr(socket, 400, "status packets are generated by the server");
      return;
    case "cb": {
      if (!limiter.allow()) {
        sendErr(socket, 429, "message rate limit exceeded");
        return;
      }
      if (meta.role !== "usr") {
        sendErr(socket, 400, "cb packets must be sent by usr");
        return;
      }
      const dev = deps.relay.getDev(meta.token);
      if (dev) dev.send(JSON.stringify(packet));
      return;
    }
    case "msg": {
      if (!limiter.allow()) {
        sendErr(socket, 429, "message rate limit exceeded");
        return;
      }
      if (packet.from !== meta.role) {
        sendErr(socket, 400, `from must be "${meta.role}" for this connection`);
        return;
      }
      routeMessage(deps, meta.token, packet);
      return;
    }
  }
}

function routeMessage(deps: WebSocketDeps, token: string, message: MsgPacket): void {
  const packet: MsgPacket = {
    ...message,
    ts: message.ts && message.ts > 0 ? message.ts : nowSec(),
  };

  saveMessage(deps.db, token, packet);
  const payload = JSON.stringify(packet);
  countMessageRouted();

  if (packet.from === "dev") {
    touchDevice(deps.db, token);
    const delivered = deps.relay.broadcastUsr(token, payload);
    if (delivered === 0) notifyOfflineUsr(deps.log, token, packet.text);
    return;
  }

  const dev = deps.relay.getDev(token);
  if (dev) dev.send(payload);
}

function broadcastStatus(
  deps: WebSocketDeps,
  token: string,
  online: boolean,
  lastSeen: number,
): void {
  deps.relay.broadcastUsr(token, JSON.stringify(buildStatusPacket(online, lastSeen)));
}

function sendJson(socket: WebSocket, packet: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(packet));
}

/** Sends an err packet and increments the matching admin counter (§4.7). */
function sendErr(socket: WebSocket, code: 400 | 401 | 413 | 429, reason: string): void {
  countError(code);
  sendJson(socket, buildErrPacket(code, reason));
}

function rawDataToString(data: WebSocket.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return Buffer.from(data).toString("utf8");
}

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  404: "Not Found",
};

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  countError(status);
  const statusText = STATUS_TEXT[status] ?? "Error";
  socket.write(
    `HTTP/1.1 ${status} ${statusText}\r\n` +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(message)}\r\n` +
      "Connection: close\r\n\r\n" +
      message,
  );
  socket.destroy();
}
