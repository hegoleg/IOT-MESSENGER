/**
 * Interactive ESP8266/ESP32 simulator.
 *
 * Usage:
 *   npm run sim:esp -- [--server=ws://127.0.0.1:8080] [--token=...]
 *                      [--telemetry=5] [--quiet]
 *
 * Without --token the script creates a device via POST /api/v1/devices/create.
 * Then open the PWA, add the printed token and talk to the simulated board:
 * /start, /on, /off, /status, /stop and the inline buttons.
 */

import { EspSimulator } from "./esp-sim/simulator.js";

function readOption(name: string): string | undefined {
  const args = process.argv.slice(2);
  const withEquals = args.find((arg) => arg.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);

  const index = args.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  return undefined;
}

function toHttpBase(serverUrl: string): string {
  const base = serverUrl.replace(/\/+$/, "");
  if (base.startsWith("wss://")) return `https://${base.slice("wss://".length)}`;
  if (base.startsWith("ws://")) return `http://${base.slice("ws://".length)}`;
  return base;
}

async function createDeviceToken(serverUrl: string): Promise<string> {
  const response = await fetch(`${toHttpBase(serverUrl)}/api/v1/devices/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`device creation failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { token?: unknown };
  if (typeof payload.token !== "string" || payload.token.length === 0) {
    throw new Error("device creation returned an invalid token");
  }
  return payload.token;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const serverUrl = readOption("server") ?? process.env.IOTBOT_SERVER ?? "ws://127.0.0.1:8080";
const providedToken = readOption("token") ?? process.env.IOTBOT_TOKEN;
const telemetrySeconds = Number.parseInt(readOption("telemetry") ?? "5", 10);
const quiet = process.argv.includes("--quiet");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    [
      "ESP simulator for the IoT-Messenger relay",
      "",
      "Options:",
      "  --server=<ws://host:port>  relay origin (default ws://127.0.0.1:8080)",
      "  --token=<device-token>     use an existing device token",
      "  --telemetry=<seconds>      live sensor period after /start (0 = off, default 5)",
      "  --quiet                    do not log protocol traffic",
      "",
      "Commands from the PWA: /start /on /off /status /stop",
    ].join("\n"),
  );
  process.exit(0);
}

let token: string;
if (providedToken) {
  token = providedToken;
} else {
  try {
    token = await createDeviceToken(serverUrl);
    console.log(`[esp-sim] new device token: ${token}`);
  } catch (error) {
    console.error(`[esp-sim] could not create a device: ${(error as Error).message}`);
    process.exit(1);
  }
}

const simulator = new EspSimulator({
  serverUrl,
  token,
  telemetryIntervalMs:
    Number.isFinite(telemetrySeconds) && telemetrySeconds > 0 ? telemetrySeconds * 1000 : 0,
  log: quiet ? () => undefined : (message) => console.log(`[esp-sim] ${message}`),
});

console.log(`[esp-sim] simulating an ESP8266/ESP32 at ${serverUrl}`);
console.log(`[esp-sim] token: ${token}`);
console.log("[esp-sim] commands: /start /on /off /status /stop");
if (telemetrySeconds > 0) {
  console.log(`[esp-sim] telemetry every ${telemetrySeconds}s (stop with /stop)`);
}

simulator.start();

const shutdown = () => {
  console.log("[esp-sim] stopping");
  simulator.stop();
  void delay(50).then(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
