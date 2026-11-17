import "dotenv/config";
import { resolve } from "node:path";

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  rateLimitPerMin: number;
  logLevel: string;
  adminKey?: string;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Reads the relay configuration from environment variables / .env. */
export function loadConfig(): Config {
  return {
    port: intFromEnv("PORT", 8080),
    host: process.env.HOST ?? "0.0.0.0",
    dbPath: resolve(process.env.DB_PATH ?? "data/iot.db"),
    rateLimitPerMin: intFromEnv("RATE_LIMIT_PER_MIN", 20),
    logLevel: process.env.LOG_LEVEL ?? "info",
    adminKey: process.env.ADMIN_KEY || undefined,
  };
}
