import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import {
  buildErrPacket,
  validatePacket,
  type MsgPacket,
  type MsgPostResponse,
} from "@iot/shared";
import type { DB } from "../db.js";
import { deviceExists, nowSec, touchDevice } from "../devices.js";
import { saveMessage } from "../history.js";
import { notifyOfflineUsr } from "../push.js";
import type { Relay } from "../relay.js";

interface MsgRouteDeps {
  db: DB;
  relay: Relay;
  log: FastifyBaseLogger;
}

/** POST /api/v1/msg — HTTP fallback for battery-powered boards (PROTOCOL.md §1.3, §4.3). */
export function registerMsgRoutes(app: FastifyInstance, deps: MsgRouteDeps): void {
  app.post("/api/v1/msg", async (request, reply) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      return reply.code(401).send(buildErrPacket(401, "Authorization header required"));
    }

    const token = authorization.slice("Bearer ".length).trim();
    if (!token || !deviceExists(deps.db, token)) {
      return reply.code(401).send(buildErrPacket(401, "Invalid token"));
    }

    const rawBody = typeof request.body === "string"
      ? request.body
      : JSON.stringify(request.body ?? null);
    const bytes = Buffer.byteLength(rawBody, "utf8");

    const parsed = validatePacket(request.body, bytes);
    if (!parsed.ok) {
      return reply.code(parsed.code).send(buildErrPacket(parsed.code, parsed.reason));
    }
    if (parsed.packet.type !== "msg") {
      return reply.code(400).send(buildErrPacket(400, "only msg packets are accepted here"));
    }
    if (parsed.packet.from !== "dev") {
      return reply.code(400).send(buildErrPacket(400, 'from must be "dev"'));
    }

    const packet: MsgPacket = {
      ...parsed.packet,
      ts: parsed.packet.ts && parsed.packet.ts > 0 ? parsed.packet.ts : nowSec(),
    };

    saveMessage(deps.db, token, packet);
    touchDevice(deps.db, token);

    const delivered = deps.relay.broadcastUsr(token, JSON.stringify(packet));
    if (delivered === 0) notifyOfflineUsr(deps.log, token, packet.text);

    const body: MsgPostResponse = { ok: true };
    return reply.code(202).send(body);
  });
}
