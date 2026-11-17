/**
 * Local user profiles.
 *
 * There is no account server in this project: a profile is a named bucket of
 * localStorage keys (devices, relay address, connection mode) on this device.
 * The very first profile keeps the legacy keys, so existing installs upgrade
 * without touching their data.
 */

export interface Profile {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

/** The profile that owns the original, un-prefixed storage keys. */
export const DEFAULT_PROFILE_ID = "default";
export const DEFAULT_PROFILE_NAME = "Основной";

const PROFILES_KEY = "iotbot.profiles.v1";
const ACTIVE_KEY = "iotbot.activeProfile";
const PROFILE_PREFIX = "iotbot.p.";
const MAX_PROFILES = 12;
const NAME_MAX_LENGTH = 24;

/* Same warm accents as the app theme (index.css). */
const COLORS = ["#ff5a1f", "#ff8a5c", "#e6dfd0", "#b8b4ac", "#8e8980", "#55514a"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function defaultProfile(): Profile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME,
    color: COLORS[0]!,
    createdAt: 0,
  };
}

function sanitizeColor(value: unknown, index: number): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : COLORS[index % COLORS.length]!;
}

function sanitizeName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_PROFILE_NAME;
  const trimmed = value.trim().slice(0, NAME_MAX_LENGTH);
  return trimmed || DEFAULT_PROFILE_NAME;
}

/** Always at least one profile; never writes to storage. */
export function loadProfiles(): Profile[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PROFILES_KEY);
  } catch {
    return [defaultProfile()];
  }
  if (!raw) return [defaultProfile()];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [defaultProfile()];

    const list: Profile[] = [];
    for (const entry of parsed) {
      const record = asRecord(entry);
      if (!record) continue;

      const id = typeof record.id === "string" && record.id ? record.id : null;
      if (!id || list.some((profile) => profile.id === id)) continue;

      list.push({
        id,
        name: sanitizeName(record.name),
        color: sanitizeColor(record.color, list.length),
        createdAt:
          typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
            ? record.createdAt
            : Date.now(),
      });
    }

    if (list.length === 0) return [defaultProfile()];
    if (!list.some((profile) => profile.id === DEFAULT_PROFILE_ID)) {
      list.unshift(defaultProfile());
    }
    return list.slice(0, MAX_PROFILES);
  } catch {
    return [defaultProfile()];
  }
}

export function saveProfiles(profiles: Profile[]): void {
  try {
    window.localStorage.setItem(
      PROFILES_KEY,
      JSON.stringify(profiles.slice(0, MAX_PROFILES)),
    );
  } catch {
    // Private mode: profiles stay in memory for this session.
  }
}

export function getActiveProfileId(): string {
  try {
    const stored = window.localStorage.getItem(ACTIVE_KEY);
    return stored && stored.length > 0 ? stored : DEFAULT_PROFILE_ID;
  } catch {
    return DEFAULT_PROFILE_ID;
  }
}

export function setActiveProfileId(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // Ignored: switching still works in memory.
  }
}

/** Storage key for `base` inside a profile; the default profile keeps legacy keys. */
export function scopedKey(base: string, profileId: string = getActiveProfileId()): string {
  return profileId === DEFAULT_PROFILE_ID ? base : `${PROFILE_PREFIX}${profileId}.${base}`;
}

export function createProfile(rawName: string): Profile {
  const profiles = loadProfiles();
  const trimmed = rawName.trim().slice(0, NAME_MAX_LENGTH);
  const profile: Profile = {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed || `Профиль ${profiles.length + 1}`,
    color: sanitizeColor(null, profiles.length),
    createdAt: Date.now(),
  };

  saveProfiles([...profiles, profile]);
  return profile;
}

/** Returns false when the name is empty or the profile is unknown. */
export function renameProfile(id: string, rawName: string): boolean {
  const trimmed = rawName.trim().slice(0, NAME_MAX_LENGTH);
  if (!trimmed) return false;

  const profiles = loadProfiles();
  if (!profiles.some((profile) => profile.id === id)) return false;

  saveProfiles(profiles.map((profile) => (profile.id === id ? { ...profile, name: trimmed } : profile)));
  return true;
}

/**
 * Deletes a profile and its stored data. The default profile (legacy keys)
 * and the last remaining profile are protected.
 */
export function deleteProfile(id: string): boolean {
  if (id === DEFAULT_PROFILE_ID) return false;

  const profiles = loadProfiles();
  if (profiles.length <= 1) return false;

  saveProfiles(profiles.filter((profile) => profile.id !== id));
  clearProfileStorage(id);

  if (getActiveProfileId() === id) setActiveProfileId(DEFAULT_PROFILE_ID);
  return true;
}

export function clearProfileStorage(id: string): void {
  if (id === DEFAULT_PROFILE_ID) return;

  const prefix = `${PROFILE_PREFIX}${id}.`;
  const doomed: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Storage disabled: nothing to clean.
  }
}

export function profileById(id: string): Profile {
  const profiles = loadProfiles();
  return profiles.find((profile) => profile.id === id) ?? profiles[0] ?? defaultProfile();
}

export function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${(parts[0] ?? "")[0] ?? ""}${(parts[1] ?? "")[0] ?? ""}`.toUpperCase();
}
