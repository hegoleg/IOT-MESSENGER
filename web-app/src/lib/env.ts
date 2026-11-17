/**
 * Default relay URL. In production the PWA is usually served next to the relay,
 * so same-origin ws(s) works. Local Vite ports fall back to the relay on :8080.
 */
function defaultServerUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:8080";

  const { protocol, hostname, port } = window.location;
  const secure = protocol === "https:";
  const devPort = port === "5173" || port === "4173" ? "8080" : port;
  return `${secure ? "wss" : "ws"}://${hostname}${devPort ? `:${devPort}` : ""}`;
}

export const SERVER_URL: string = (
  import.meta.env.VITE_SERVER_URL || defaultServerUrl()
).replace(/\/+$/, "");

/** Port of the direct WebSocket server that the ESP exposes in LAN mode (PROTOCOL.md §1.2). */
export const LOCAL_WS_PORT = 81;
