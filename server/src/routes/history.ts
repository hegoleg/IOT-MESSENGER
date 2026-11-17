import type { FastifyInstance } from "fastify";
import { HISTORY_LIMIT, buildErrPacket, type HistoryResponse } from "@iot/shared";
import type { DB } from "../db.js";
import { deviceExists } from "../devices.js";
import { getHistory } from "../history.js";
import { countError } from "../stats.js";

interface HistoryQuery {
  token?: string;
  limit?: string;
}

/** GET /api/v1/history?token=...&limit=50 — last messages for a token (PROTOCOL.md §4.1). */
export function registerHistoryRoutes(app: FastifyInstance, deps: { db: DB }): void {
  app.get<{ Querystring: HistoryQuery }>("/api/v1/history", async (request, reply) => {
    const token = request.query.token;
    if (!token) {
      countError(400);
      return reply.code(400).send(buildErrPacket(400, "token is required"));
    }
    if (!deviceExists(deps.db, token)) {
      countError(401);
      return reply.code(401).send(buildErrPacket(401, "Invalid token"));
    }

    const requested = Number.parseInt(request.query.limit ?? "", 10);
    const limit = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, HISTORY_LIMIT)
      : HISTORY_LIMIT;

    const body: HistoryResponse = { messages: getHistory(deps.db, token, limit) };
    return reply.send(body);
  });
}
