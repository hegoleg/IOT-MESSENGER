import type { FastifyInstance } from "fastify";
import { PROTOCOL_VERSION, type HealthResponse } from "@iot/shared";

/** GET /api/v1/health — reachability probe used by the PWA setup wizard. */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/api/v1/health", async () => {
    const body: HealthResponse = {
      ok: true,
      v: PROTOCOL_VERSION,
      uptime: Math.floor(process.uptime()),
    };
    return body;
  });
}
