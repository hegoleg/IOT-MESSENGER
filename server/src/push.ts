import type { FastifyBaseLogger } from "fastify";

/**
 * Web Push for offline users is defined by PROTOCOL.md §3.2.
 * v1 only records the event; actual push subscriptions arrive together with
 * the PWA client (web-app/).
 */
export function notifyOfflineUsr(
  log: FastifyBaseLogger,
  token: string,
  text: string,
): void {
  log.info(
    { tokenSuffix: token.slice(-4), chars: text.length },
    "no usr online: web push is not implemented yet (stub)",
  );
}
