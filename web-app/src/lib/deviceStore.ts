import type { AddDeviceInput, StoredDevice } from "./types";

/** localStorage key that holds the device list (schema v1). */
export const DEVICES_STORAGE_KEY = "iotbot.devices.v1";

/** The UI is intentionally limited to a small, scrollable list. */
export const MAX_DEVICES = 50;

/** Minimum length of a relay token (PROTOCOL.md §1.1, §4.2). */
export const TOKEN_MIN_LENGTH = 16;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const NAME_MAX_LENGTH = 40;

/** base64url token: letters, digits, "-" and "_" only. */
export function isValidToken(value: string): boolean {
  return value.length >= TOKEN_MIN_LENGTH && TOKEN_PATTERN.test(value);
}

/** "Устройство aB12" — fallback name for a token without a user name. */
export function defaultDeviceName(token: string): string {
  return `Устройство ${token.slice(-4)}`;
}

/** Trims, caps at 40 characters and falls back to a name derived from the token. */
export function normalizeDeviceName(raw: string | undefined, token: string): string {
  const trimmed = raw?.trim();
  return (trimmed ? trimmed : defaultDeviceName(token)).slice(0, NAME_MAX_LENGTH);
}

/**
 * Accepts "192.168.1.50", "iotbot.local:81", "ws://192.168.1.50:81/ws?token=..."
 * and keeps only the host (drop scheme, path, query, trailing slashes, :81).
 */
export function normalizeLocalHost(raw?: string): string | undefined {
  if (!raw) return undefined;
  let value = raw.trim();
  if (!value) return undefined;

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  value = value.split(/[/?#]/, 1)[0] ?? "";
  value = value.replace(/\/+$/, "");
  value = value.replace(/:81$/i, "");
  value = value.trim();

  return value ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function toTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Defensive parser: anything that is not a well-formed device array becomes
 * an empty list, broken entries are dropped (PROTOCOL.md §4.2 token format).
 */
export function sanitizeDevices(raw: unknown): StoredDevice[] {
  if (!Array.isArray(raw)) return [];

  const devices: StoredDevice[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (devices.length >= MAX_DEVICES) break;

    const record = asRecord(entry);
    if (!record) continue;

    const token = typeof record.token === "string" ? record.token.trim() : "";
    if (!isValidToken(token) || seen.has(token)) continue;
    seen.add(token);

    const device: StoredDevice = {
      token,
      name:
        typeof record.name === "string"
          ? normalizeDeviceName(record.name, token)
          : defaultDeviceName(token),
      addedAt: toTimestamp(record.addedAt) ?? Date.now(),
    };

    const lastActivityAt = toTimestamp(record.lastActivityAt);
    if (lastActivityAt !== undefined) device.lastActivityAt = lastActivityAt;

    const localHost =
      typeof record.localHost === "string" ? normalizeLocalHost(record.localHost) : undefined;
    if (localHost !== undefined) device.localHost = localHost;

    devices.push(device);
  }

  return devices;
}

/** Reads the list from localStorage; never throws (private mode, bad JSON). */
export function loadDevices(): StoredDevice[] {
  try {
    const stored = window.localStorage.getItem(DEVICES_STORAGE_KEY);
    if (!stored) return [];
    return sanitizeDevices(JSON.parse(stored) as unknown);
  } catch {
    return [];
  }
}

/** Persists the list; quota / disabled storage must not break the UI. */
export function saveDevices(devices: StoredDevice[]): void {
  try {
    window.localStorage.setItem(
      DEVICES_STORAGE_KEY,
      JSON.stringify(devices.slice(0, MAX_DEVICES)),
    );
  } catch {
    // Ignore: keep working from in-memory state.
  }
}

/**
 * Validates and normalizes a new device. Throws errors with user-facing
 * Russian messages for the add-device form.
 */
export function prepareDevice(
  input: AddDeviceInput,
  existing: readonly StoredDevice[],
): StoredDevice {
  const token = input.token.trim();

  if (!isValidToken(token)) {
    throw new Error("Некорректный токен устройства");
  }
  if (existing.some((device) => device.token === token)) {
    throw new Error("Это устройство уже добавлено");
  }
  if (existing.length >= MAX_DEVICES) {
    throw new Error(`Достигнут лимит: не больше ${MAX_DEVICES} устройств`);
  }

  const device: StoredDevice = {
    token,
    name: normalizeDeviceName(input.name, token),
    addedAt: Date.now(),
  };

  const localHost = normalizeLocalHost(input.localHost);
  if (localHost !== undefined) device.localHost = localHost;

  return device;
}

/** Renames without adding new fields; empty names are rejected by the hook. */
export function normalizeRename(raw: string): string {
  return raw.trim().slice(0, NAME_MAX_LENGTH);
}
