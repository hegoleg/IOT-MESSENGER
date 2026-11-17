import type { FastifyInstance } from "fastify";
import type { MetricsResponse } from "@iot/shared";
import { requireAdmin } from "../admin-auth.js";
import type { Config } from "../config.js";
import type { Relay } from "../relay.js";
import { stats } from "../stats.js";

interface MetricsRouteDeps {
  relay: Relay;
  config: Config;
}

/** GET /api/v1/metrics — admin counters and live connection stats (PROTOCOL.md §4.7). */
export function registerMetricsRoutes(app: FastifyInstance, deps: MetricsRouteDeps): void {
  app.get("/api/v1/metrics", async (request, reply) => {
    if (!requireAdmin(request, reply, deps.config)) return reply;

    const connections = deps.relay.counts();
    const body: MetricsResponse = {
      uptime: Math.floor(process.uptime()),
      connections_dev: connections.dev,
      connections_usr: connections.usr,
      messages_routed: stats.messagesRouted,
      messages_stored: stats.messagesStored,
      errors_400: stats.errors.e400,
      errors_401: stats.errors.e401,
      errors_413: stats.errors.e413,
      errors_429: stats.errors.e429,
    };
    return reply.code(200).send(body);
  });
}
