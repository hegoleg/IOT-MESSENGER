/**
 * Simple fixed-window rate limiter, one per WebSocket connection.
 * The protocol reports overruns with err code 429 (PROTOCOL.md §2.4).
 */
export class RateLimiter {
  private windowStart = Date.now();
  private count = 0;

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs = 60_000,
  ) {}

  allow(): boolean {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.count = 0;
    }
    if (this.count >= this.maxPerWindow) return false;
    this.count += 1;
    return true;
  }
}
