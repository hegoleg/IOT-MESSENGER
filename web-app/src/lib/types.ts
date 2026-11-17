/** UI-level types shared by the PWA components. */

/** Cloud relay (WebSocket) or direct LAN connection to the device. */
export type ConnectionMode = "cloud" | "local";

/** Transport state of the active chat connection. */
export type ConnectionStatus = "offline" | "connecting" | "online";

/** Device presence as shown in the device list (probed in the background). */
export type PresenceState = "online" | "offline" | "connecting" | "unknown";

/** A device saved in localStorage (the token is the device identity). */
export interface StoredDevice {
  /** Device token issued by the relay (also used for direct LAN auth). */
  token: string;
  /** User-visible name. */
  name: string;
  /** Creation timestamp, ms since epoch. */
  addedAt: number;
  /** Last message activity, ms since epoch. */
  lastActivityAt?: number;
  /** Optional LAN host (IP or mDNS name) for direct mode. */
  localHost?: string;
}

/** Payload accepted by the "add device" form. */
export interface AddDeviceInput {
  token: string;
  name?: string;
  localHost?: string;
}
