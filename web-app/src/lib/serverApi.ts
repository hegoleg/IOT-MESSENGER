import {
  PROTOCOL_VERSION,
  WS_PATH,
  type DeviceCreateResponse,
  type HealthResponse,
} from "@iot/shared";

const REQUEST_TIMEOUT_MS = 6_000;

/** ws(s):// origin -> http(s):// origin for REST calls (path is preserved). */
export function toHttpBase(serverUrl: string): string {
  const base = serverUrl.trim().replace(/\/+$/, "");
  if (base.startsWith("wss://")) return `https://${base.slice("wss://".length)}`;
  if (base.startsWith("ws://")) return `http://${base.slice("ws://".length)}`;
  return base;
}

/**
 * Accepts "192.168.1.10:8080", "http://host", "wss://relay.example/ws"
 * and returns a normalized ws:// or wss:// origin without the /ws path.
 */
export function normalizeServerUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `ws://${value}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
  if (!url.hostname) return null;

  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith(WS_PATH)) path = path.slice(0, -WS_PATH.length).replace(/\/+$/, "");

  return `${url.protocol}//${url.host}${path}`;
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.ok === true &&
    record.v === PROTOCOL_VERSION &&
    typeof record.uptime === "number"
  );
}

/** Probes GET /api/v1/health; throws a user-facing Error on failure. */
export async function checkServer(serverUrl: string): Promise<HealthResponse> {
  let response: Response;
  try {
    response = await request(`${toHttpBase(serverUrl)}/api/v1/health`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("Релей не отвечает. Проверьте адрес, порт и сеть.");
  }

  if (!response.ok) {
    throw new Error(`Релей ответил HTTP ${response.status}. Проверьте адрес.`);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!isHealthResponse(payload)) {
    throw new Error("По этому адресу работает несовместимый сервер.");
  }
  return payload;
}

/** Creates a device on the relay and returns its token. */
export async function createDeviceToken(serverUrl: string): Promise<string> {
  let response: Response;
  try {
    response = await request(`${toHttpBase(serverUrl)}/api/v1/devices/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    });
  } catch {
    throw new Error("Релей не отвечает. Проверьте адрес и сеть.");
  }

  if (response.status === 401) {
    throw new Error("Релей требует ADMIN_KEY для создания устройств.");
  }
  if (!response.ok) {
    throw new Error(`Не удалось создать устройство: HTTP ${response.status}`);
  }

  const payload = (await response.json().catch(() => null)) as DeviceCreateResponse | null;
  if (!payload || typeof payload.token !== "string" || payload.token.length === 0) {
    throw new Error("Релей вернул некорректный токен.");
  }
  return payload.token;
}
