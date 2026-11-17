import { SERVER_URL } from "./env";
import { normalizeServerUrl } from "./serverApi";

const SERVER_KEY = "iotbot.serverUrl";
const ONBOARDING_KEY = "iotbot.onboarded";

/** Relay URL saved by the setup wizard, falling back to the build-time default. */
export function loadServerUrl(): string {
  try {
    const stored = window.localStorage.getItem(SERVER_KEY);
    return normalizeServerUrl(stored ?? "") ?? SERVER_URL;
  } catch {
    return SERVER_URL;
  }
}

/** Normalizes and persists the relay URL; returns the stored value. */
export function saveServerUrl(raw: string): string {
  const normalized = normalizeServerUrl(raw) ?? SERVER_URL;
  try {
    window.localStorage.setItem(SERVER_KEY, normalized);
  } catch {
    // Private mode: keep working with the in-memory value.
  }
  return normalized;
}

export function isOnboarded(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboarded(value = true): void {
  try {
    if (value) window.localStorage.setItem(ONBOARDING_KEY, "1");
    else window.localStorage.removeItem(ONBOARDING_KEY);
  } catch {
    // Ignore storage failures.
  }
}
