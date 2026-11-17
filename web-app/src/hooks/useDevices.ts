import { useCallback, useEffect, useRef, useState } from "react";
import type { AddDeviceInput, StoredDevice } from "../lib/types";
import { DEVICES_STORAGE_KEY, loadDevices, normalizeLocalHost, normalizeRename, prepareDevice, saveDevices } from "../lib/deviceStore";

/** Ignore repeated activity updates within one second (App.tsx effect guard). */
const TOUCH_THROTTLE_MS = 1000;

export interface UseDevicesResult {
  devices: StoredDevice[];
  /** Throws Error (Russian text) for an invalid or duplicate token. */
  add(input: AddDeviceInput): StoredDevice;
  remove(token: string): void;
  rename(token: string, name: string): void;
  /** Sets or clears the LAN host used by the direct connection mode. */
  setLocalHost(token: string, host: string): void;
  /** Sets lastActivityAt = Date.now(), throttled to one update per second. */
  touch(token: string): void;
}

export function useDevices(seed?: AddDeviceInput): UseDevicesResult {
  const [devices, setDevices] = useState<StoredDevice[]>(() => {
    const loaded = loadDevices();
    if (!seed) return loaded;

    try {
      const device = prepareDevice(seed, loaded);
      const next = [device, ...loaded];
      saveDevices(next);
      return next;
    } catch {
      // Invalid or duplicate seed: keep the stored list.
      return loaded;
    }
  });

  // Stable, synchronous source of truth for callbacks so that consecutive
  // add/remove/touch calls within one render never work on stale state.
  const devicesRef = useRef<StoredDevice[]>(devices);

  const commit = useCallback((next: StoredDevice[]) => {
    devicesRef.current = next;
    saveDevices(next);
    setDevices(next);
  }, []);

  // Cross-tab sync: another tab added/removed/renamed a device.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== DEVICES_STORAGE_KEY) return;
      const next = loadDevices();
      devicesRef.current = next;
      setDevices(next);
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const add = useCallback(
    (input: AddDeviceInput): StoredDevice => {
      const current = devicesRef.current;
      const device = prepareDevice(input, current);
      commit([device, ...current]);
      return device;
    },
    [commit],
  );

  const remove = useCallback(
    (token: string) => {
      const current = devicesRef.current;
      if (!current.some((device) => device.token === token)) return;
      commit(current.filter((device) => device.token !== token));
    },
    [commit],
  );

  const rename = useCallback(
    (token: string, name: string) => {
      const nextName = normalizeRename(name);
      if (!nextName) return;

      const current = devicesRef.current;
      const target = current.find((device) => device.token === token);
      if (!target || target.name === nextName) return;

      commit(
        current.map((device) =>
          device.token === token ? { ...device, name: nextName } : device,
        ),
      );
    },
    [commit],
  );

  const touch = useCallback(
    (token: string) => {
      const current = devicesRef.current;
      const now = Date.now();
      let changed = false;

      const next = current.map((device) => {
        if (device.token !== token) return device;
        if (device.lastActivityAt && now - device.lastActivityAt < TOUCH_THROTTLE_MS) {
          return device;
        }
        changed = true;
        return { ...device, lastActivityAt: now };
      });

      if (changed) commit(next);
    },
    [commit],
  );

  const setLocalHost = useCallback(
    (token: string, host: string) => {
      const normalized = normalizeLocalHost(host);
      const current = devicesRef.current;
      const target = current.find((device) => device.token === token);
      if (!target) return;
      if ((target.localHost ?? "") === (normalized ?? "")) return;

      commit(
        current.map((device) => {
          if (device.token !== token) return device;
          const next = { ...device };
          if (normalized) next.localHost = normalized;
          else delete next.localHost;
          return next;
        }),
      );
    },
    [commit],
  );

  return { devices, add, remove, rename, setLocalHost, touch };
}
