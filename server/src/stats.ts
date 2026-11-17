/**
 * In-process counters for GET /api/v1/metrics (admin only).
 * Deliberately simple: the relay is a router, not a metrics store.
 */

export interface ErrorCounters {
  e400: number;
  e401: number;
  e413: number;
  e429: number;
}

export const stats = {
  messagesRouted: 0,
  messagesStored: 0,
  errors: { e400: 0, e401: 0, e413: 0, e429: 0 } as ErrorCounters,
};

export function countMessageRouted(): void {
  stats.messagesRouted += 1;
}

export function countMessageStored(): void {
  stats.messagesStored += 1;
}

export function countError(code: number): void {
  switch (code) {
    case 400:
      stats.errors.e400 += 1;
      break;
    case 401:
      stats.errors.e401 += 1;
      break;
    case 413:
      stats.errors.e413 += 1;
      break;
    case 429:
      stats.errors.e429 += 1;
      break;
    default:
      break;
  }
}

/** Test helper: clears counters between cases. */
export function resetStats(): void {
  stats.messagesRouted = 0;
  stats.messagesStored = 0;
  stats.errors = { e400: 0, e401: 0, e413: 0, e429: 0 };
}
