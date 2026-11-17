// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE_ID,
  createProfile,
  deleteProfile,
  getActiveProfileId,
  loadProfiles,
  profileById,
  profileInitials,
  renameProfile,
  saveProfiles,
  scopedKey,
  setActiveProfileId,
} from "./profiles";
import { DEVICES_STORAGE_KEY, countDevicesFor, loadDevices, saveDevices } from "./deviceStore";

const LEGACY_DEVICES_KEY = "iotbot.devices.v1";
const TOKEN_A = "Token_1234567890";
const TOKEN_B = "AbCdEfGhIjKlMnOp";

beforeEach(() => {
  window.localStorage.clear();
});

describe("loadProfiles", () => {
  it("always returns at least the default profile", () => {
    const profiles = loadProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.id).toBe(DEFAULT_PROFILE_ID);
    expect(profiles[0]?.name).toBe("Основной");
  });

  it("drops malformed entries and keeps the default profile", () => {
    window.localStorage.setItem(
      "iotbot.profiles.v1",
      JSON.stringify([
        { id: "p1", name: "  Дача  ", color: "#ff5a1f", createdAt: 5 },
        { id: "p1", name: "duplicate" },
        { name: "no id" },
        "junk",
      ]),
    );

    const profiles = loadProfiles();
    expect(profiles.map((profile) => profile.id)).toEqual([DEFAULT_PROFILE_ID, "p1"]);
    expect(profiles[1]?.name).toBe("Дача");
  });

  it("survives broken JSON", () => {
    window.localStorage.setItem("iotbot.profiles.v1", "{not json");
    expect(loadProfiles()[0]?.id).toBe(DEFAULT_PROFILE_ID);
  });
});

describe("scopedKey", () => {
  it("keeps legacy keys for the default profile", () => {
    expect(scopedKey(DEVICES_STORAGE_KEY, DEFAULT_PROFILE_ID)).toBe(LEGACY_DEVICES_KEY);
  });

  it("namespaces keys for other profiles", () => {
    expect(scopedKey(DEVICES_STORAGE_KEY, "p1")).toBe("iotbot.p.p1.iotbot.devices.v1");
  });

  it("follows the active profile", () => {
    setActiveProfileId("p1");
    expect(scopedKey(DEVICES_STORAGE_KEY)).toBe("iotbot.p.p1.iotbot.devices.v1");

    setActiveProfileId(DEFAULT_PROFILE_ID);
    expect(scopedKey(DEVICES_STORAGE_KEY)).toBe(LEGACY_DEVICES_KEY);
  });
});

describe("device storage per profile", () => {
  it("keeps device lists of two profiles apart", () => {
    const second = createProfile("Дача");

    setActiveProfileId(DEFAULT_PROFILE_ID);
    saveDevices([{ token: TOKEN_A, name: "Городская", addedAt: 1 }]);

    setActiveProfileId(second.id);
    saveDevices([{ token: TOKEN_B, name: "Дачная", addedAt: 1 }]);

    setActiveProfileId(DEFAULT_PROFILE_ID);
    expect(loadDevices().map((device) => device.name)).toEqual(["Городская"]);

    setActiveProfileId(second.id);
    expect(loadDevices().map((device) => device.name)).toEqual(["Дачная"]);

    expect(window.localStorage.getItem(LEGACY_DEVICES_KEY)).toContain("Городская");
    expect(countDevicesFor(DEFAULT_PROFILE_ID)).toBe(1);
    expect(countDevicesFor(second.id)).toBe(1);
  });

  it("adopts existing legacy data into the default profile", () => {
    window.localStorage.setItem(
      LEGACY_DEVICES_KEY,
      JSON.stringify([{ token: TOKEN_A, name: "Из прошлого", addedAt: 1 }]),
    );

    expect(loadDevices().map((device) => device.name)).toEqual(["Из прошлого"]);
    expect(getActiveProfileId()).toBe(DEFAULT_PROFILE_ID);
  });
});

describe("createProfile and renameProfile", () => {
  it("creates profiles with unique ids and fallback names", () => {
    const first = createProfile("Дача");
    const second = createProfile("   ");

    expect(first.name).toBe("Дача");
    expect(second.id).not.toBe(first.id);
    expect(second.name).toMatch(/^Профиль \d+$/);
    expect(loadProfiles()).toHaveLength(3);
  });

  it("caps the name length", () => {
    const created = createProfile("Очень длинное название профиля для теста");
    expect(created.name.length).toBeLessThanOrEqual(24);
  });

  it("renames only existing profiles with a non-empty name", () => {
    expect(renameProfile(DEFAULT_PROFILE_ID, "  Теплица  ")).toBe(true);
    expect(profileById(DEFAULT_PROFILE_ID).name).toBe("Теплица");

    expect(renameProfile(DEFAULT_PROFILE_ID, "   ")).toBe(false);
    expect(renameProfile("missing", "X")).toBe(false);
  });
});

describe("deleteProfile", () => {
  it("never deletes the default profile", () => {
    expect(deleteProfile(DEFAULT_PROFILE_ID)).toBe(false);
    expect(loadProfiles()).toHaveLength(1);
  });

  it("removes the profile, its data and falls back to the default", () => {
    const extra = createProfile("Мастерская");
    setActiveProfileId(extra.id);
    saveDevices([{ token: TOKEN_A, name: "Станок", addedAt: 1 }]);

    expect(deleteProfile(extra.id)).toBe(true);

    expect(getActiveProfileId()).toBe(DEFAULT_PROFILE_ID);
    expect(loadDevices()).toEqual([]);
    expect(countDevicesFor(extra.id)).toBe(0);
    expect(window.localStorage.getItem(`iotbot.p.${extra.id}.${DEVICES_STORAGE_KEY}`)).toBeNull();
    expect(loadProfiles()).toHaveLength(1);
  });
});

describe("profileInitials", () => {
  it("builds one or two letter badges", () => {
    expect(profileInitials("Дача")).toBe("ДА");
    expect(profileInitials("Иван Петров")).toBe("ИП");
    expect(profileInitials("   ")).toBe("?");
  });
});

describe("saveProfiles", () => {
  it("round-trips the list through storage", () => {
    const extra = createProfile("Гараж");
    saveProfiles(loadProfiles());

    expect(loadProfiles().map((profile) => profile.id)).toEqual([DEFAULT_PROFILE_ID, extra.id]);
  });
});
