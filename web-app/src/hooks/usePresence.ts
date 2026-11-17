/**
 * Background presence probes for the device list.
 *
 * The relay only reports the peer state to connected clients, so the list
 * opens a short-lived usr socket per device, reads the first "status" packet
 * and disconnects. Probes are staggered, serialized per token and repeat
 * every ~30 s; the active chat socket is skipped because it already reports
 * presence through useDeviceChat.
 */

import { useEffect, useState } from "react";
import { DeviceConnection } from "../lib/connection";
import type { ConnectionMode, PresenceState, StoredDevice } from "../lib/types";

export type PresenceMap = Record<string, PresenceState>;

export interface UsePresenceOptions {
  devices: StoredDevice[];
  mode: ConnectionMode;
  serverUrl: string;
  /** Token handled by the live chat connection. */
  skipToken?: string | null;
}

const PROBE_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 6_000;
const PROBE_STAGGER_MS = 300;
const PROBE_JITTER_MS = 5_000;

export function usePresence({
  devices,
  mode,
  serverUrl,
  skipToken,
}: UsePresenceOptions): PresenceMap {
  const [presence, setPresence] = useState<PresenceMap>({});

  // Only the identity + LAN address matter: renames and activity updates must
  // not restart the probes.
  const targetsKey = devices
    .filter(
      (device) =>
        device.token !== skipToken && (mode === "cloud" || Boolean(device.localHost)),
    )
    .map((device) => `${device.token}@${device.localHost ?? ""}`)
    .join("|");

  useEffect(() => {
    const targets = devices.filter(
      (device) =>
        device.token !== skipToken && (mode === "cloud" || Boolean(device.localHost)),
    );

    // Drop entries for devices that are no longer probed.
    setPresence((current) => {
      const next: PresenceMap = {};
      for (const device of targets) {
        const known = current[device.token];
        if (known) next[device.token] = known;
      }
      return next;
    });

    if (targets.length === 0) return;

    let cancelled = false;
    const connections = new Map<string, DeviceConnection>();
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const schedule = (callback: () => void, delay: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!cancelled) callback();
      }, delay);
      timers.add(timer);
    };

    const probe = (device: StoredDevice) => {
      const token = device.token;
      if (cancelled || document.hidden || connections.has(token)) return;

      setPresence((current) =>
        current[token] ? current : { ...current, [token]: "connecting" },
      );

      const connection = new DeviceConnection({
        token,
        mode,
        serverUrl,
        localHost: device.localHost,
      });
      connections.set(token, connection);

      let settled = false;
      const finish = (state: PresenceState) => {
        if (settled) return;
        settled = true;
        connections.delete(token);
        connection.close();

        if (cancelled) return;
        setPresence((current) => ({ ...current, [token]: state }));
        schedule(
          () => probe(device),
          PROBE_INTERVAL_MS + Math.random() * PROBE_JITTER_MS,
        );
      };

      connection.onStatus((state) => {
        // In LAN mode an open direct socket is the device itself.
        if (mode === "local" && state === "online") finish("online");
      });
      connection.onPacket((packet) => {
        if (packet.type === "status") {
          finish(packet.dev_online ? "online" : "offline");
        }
      });

      connection.connect();
      // The relay answers with "status" right after connect; 6 s covers slow dials.
      schedule(() => finish("offline"), PROBE_TIMEOUT_MS);
    };

    targets.forEach((device, index) => {
      schedule(() => probe(device), index * PROBE_STAGGER_MS);
    });

    const handleVisibility = () => {
      if (document.hidden) return;
      for (const device of targets) {
        if (!connections.has(device.token)) probe(device);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const connection of connections.values()) connection.close();
      connections.clear();
    };
    // `devices` is represented by targetsKey: renames/activity must not restart probes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey, mode, serverUrl, skipToken]);

  return presence;
}
