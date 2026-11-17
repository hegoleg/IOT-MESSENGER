import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { MAX_PACKET_SIZE, buildErrPacket } from "@iot/shared";
import type { Config } from "./config.js";
import { openDatabase } from "./db.js";
import { Relay } from "./relay.js";
import { attachWebSocket } from "./ws.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { registerMsgRoutes } from "./routes/msg.js";

/**
 * Builds the relay server: Fastify HTTP API + WebSocket router + SQLite.
 * Configuration is injected so tests (scripts/smoke.ts) can use a temp DB.
 */
export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: MAX_PACKET_SIZE,
  });

  const db = openDatabase(config.dbPath);
  const relay = new Relay();

  // The PWA client is served from another origin (dev server or static host).
  await app.register(cors, { origin: true });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status === 413) {
      return reply.code(413).send(buildErrPacket(413, `packet exceeds ${MAX_PACKET_SIZE} bytes`));
    }
    if (status === 400) {
      return reply.code(400).send(buildErrPacket(400, error.message || "bad request"));
    }
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send({ error: "internal server error" });
  });

  registerDeviceRoutes(app, { db, config });
  registerHealthRoutes(app);
  registerHistoryRoutes(app, { db });
  registerMsgRoutes(app, { db, relay, log: app.log });

  const stopWebSocket = attachWebSocket(app, { db, relay, config, log: app.log });

  app.addHook("onClose", async () => {
    await stopWebSocket();
    db.close();
  });

  return app;
}
