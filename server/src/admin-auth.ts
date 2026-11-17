import type { FastifyReply, FastifyRequest } from "fastify";
import { buildErrPacket } from "@iot/shared";
import type { Config } from "./config.js";
import { countError } from "./stats.js";

/**
 * Guards admin endpoints with ADMIN_KEY (PROTOCOL.md §4.5–4.7).
 * When ADMIN_KEY is not set on the server, admin API is disabled (401).
 * Returns true when the request is authorized.
 */
export function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  config: Config,
): boolean {
  if (!config.adminKey) {
    countError(401);
    reply.code(401).send(buildErrPacket(401, "Admin API disabled: ADMIN_KEY is not set"));
    return false;
  }

  const authorization = request.headers.authorization;
  if (authorization !== `Bearer ${config.adminKey}`) {
    countError(401);
    reply.code(401).send(buildErrPacket(401, "Admin key required"));
    return false;
  }

  return true;
}
