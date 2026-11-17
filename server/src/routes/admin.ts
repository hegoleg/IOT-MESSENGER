import type { FastifyInstance } from "fastify";
import type { DeviceListResponse } from "@iot/shared";
import { requireAdmin } from "../admin-auth.js";
import type { Config } from "../config.js";
import type { DB } from "../db.js";
import { deleteDevice, listDevices } from "../devices.js";
import type { Relay } from "../relay.js";

interface AdminRouteDeps {
  db: DB;
  relay: Relay;
  config: Config;
}

interface DeleteDeviceParams {
  token: string;
}

/**
 * Admin device management (PROTOCOL.md §4.5–4.6):
 * GET /api/v1/devices and DELETE /api/v1/devices/:token.
 * Both require ADMIN_KEY; 401 when it is not configured.
 */
export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  app.get("/api/v1/devices", async (request, reply) => {
    if (!requireAdmin(request, reply, deps.config)) return reply;

    const body: DeviceListResponse = {
      devices: listDevices(deps.db).map((row) => ({
        token: row.token,
        created_at: row.created_at,
        last_seen: row.last_seen,
        online: deps.relay.isDevOnline(row.token),
      })),
    };
    return reply.code(200).send(body);
  });

  app.delete<{ Params: DeleteDeviceParams }>(
    "/api/v1/devices/:token",
    async (request, reply) => {
      if (!requireAdmin(request, reply, deps.config)) return reply;

      const { token } = request.params;
      // Delete the device and its history; then drop live sockets so they
      // cannot re-create rows. SQLite calls are synchronous, so no message
      // can be stored between these two steps.
      const deleted = deleteDevice(deps.db, token);
      if (!deleted) {
        // err-packet codes are limited to 400/401/413/429, so 404 uses a plain body.
        return reply.code(404).send({ ok: false, error: "device not found" });
      }

      deps.relay.dropToken(token);
      return reply.code(200).send({ ok: true });
    },
  );
}
