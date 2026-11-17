import type { FastifyInstance } from "fastify";
import { buildErrPacket, type DeviceCreateResponse } from "@iot/shared";
import type { Config } from "../config.js";
import type { DB } from "../db.js";
import { createDeviceToken } from "../devices.js";
import { countError } from "../stats.js";

interface DeviceRouteDeps {
  db: DB;
  config: Config;
}

/** POST /api/v1/devices/create — issues a new device token (PROTOCOL.md §4.2). */
export function registerDeviceRoutes(app: FastifyInstance, deps: DeviceRouteDeps): void {
  app.post("/api/v1/devices/create", async (request, reply) => {
    if (deps.config.adminKey) {
      const authorization = request.headers.authorization;
      if (authorization !== `Bearer ${deps.config.adminKey}`) {
        countError(401);
        return reply.code(401).send(buildErrPacket(401, "Admin key required"));
      }
    }

    const token = createDeviceToken(deps.db);
    const body: DeviceCreateResponse = { token };
    return reply.code(201).send(body);
  });
}
