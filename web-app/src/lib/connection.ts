/**
 * Transport layer for a single device chat.
 *
 * Owns one WebSocket (cloud relay or direct LAN), the heartbeat, the
 * reconnect backoff and packet validation. It has no React dependency:
 * `useDeviceChat` is the only consumer.
 */

import {
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  PROTOCOL_VERSION,
  WS_PATH,
  isPacket,
} from "@iot/shared";
import type { Packet, PingPacket } from "@iot/shared";
import { LOCAL_WS_PORT } from "./env";
import type { ConnectionMode, ConnectionStatus } from "./types";

export interface DeviceConnectionOptions {
  token: string;
  mode: ConnectionMode;
  /** Relay origin ("ws://host:8080" / "wss://host"), without the /ws path. */
  serverUrl: string;
  /** LAN host of the device (IP or mDNS name), without scheme or port. */
  localHost?: string;
}

export type PacketListener = (packet: Packet) => void;
export type StatusListener = (status: ConnectionStatus) => void;

/**
 * Client-side reconnect backoff: 1 s, 2 s, 4 s, 8 s, then 10 s.
 * Faster than the firmware's RECONNECT_DELAY_MS because a browser tab can
 * retry more aggressively.
 */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;

/** Shared heartbeat request, serialized on every ping. */
const HEARTBEAT_PACKET: PingPacket = { v: PROTOCOL_VERSION, type: "ping" };

/** Drops trailing slashes so path segments can be appended safely. */
function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** "host:81" / "[::1]:81" already carry a port, so do not append another one. */
function hasExplicitPort(host: string): boolean {
  return /:\d+$/.test(host);
}

export class DeviceConnection {
  private readonly options: DeviceConnectionOptions;
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = "offline";
  /** Set by close(): suppresses reconnect and any further dialing. */
  private stopped = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingPong = false;
  private readonly packetListeners = new Set<PacketListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(options: DeviceConnectionOptions) {
    // Snapshot the options: later external mutation must not redirect the socket.
    this.options = { ...options };
  }

  /** Starts dialing. Repeated calls while a socket or retry is pending are no-ops. */
  connect(): void {
    this.stopped = false;
    if (this.socket !== null || this.reconnectTimer !== null) return;
    this.openSocket();
  }

  /** Stops reconnecting and tears the socket down. Safe to call repeatedly. */
  close(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();

    const socket = this.socket;
    this.socket = null;
    if (socket) this.disposeSocket(socket);

    this.setStatus("offline");
  }

  /** Sends one protocol packet. Returns false when the socket is not usable. */
  send(packet: Packet): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;

    try {
      socket.send(JSON.stringify(packet));
      return true;
    } catch {
      return false;
    }
  }

  isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  onPacket(listener: PacketListener): () => void {
    this.packetListeners.add(listener);
    return () => {
      this.packetListeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /* ----------------------------------------------------------------------- */
  /* URL building                                                            */
  /* ----------------------------------------------------------------------- */

  /** Builds the endpoint from PROTOCOL.md §1.1 / §1.2, or null if unusable. */
  private buildUrl(): string | null {
    const { token, mode, serverUrl, localHost } = this.options;
    const encodedToken = encodeURIComponent(token);

    if (mode === "local") {
      const host = (localHost ?? "").trim().replace(/\/+$/, "");
      if (!host) return null;

      // An explicit scheme is used as-is; otherwise the ESP LAN port is added.
      const base = host.includes("://")
        ? host
        : `ws://${hasExplicitPort(host) ? host : `${host}:${LOCAL_WS_PORT}`}`;

      return `${normalizeBase(base)}${WS_PATH}?token=${encodedToken}`;
    }

    const base = normalizeBase(serverUrl);
    if (!base) return null;

    return `${base}${WS_PATH}?role=usr&token=${encodedToken}`;
  }

  /* ----------------------------------------------------------------------- */
  /* Socket lifecycle                                                        */
  /* ----------------------------------------------------------------------- */

  private openSocket(): void {
    this.clearReconnectTimer();

    const url = this.buildUrl();
    if (!url) {
      // Nothing to dial (e.g. local mode without a host): give up for now.
      this.stopped = true;
      this.setStatus("offline");
      return;
    }

    this.setStatus("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.setStatus("offline");
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    this.attachHandlers(socket);
  }

  private attachHandlers(socket: WebSocket): void {
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.setStatus("online");
      this.startHeartbeat();
    };

    socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket) return;
      this.handleIncoming(event.data);
    };

    socket.onerror = () => {
      if (this.socket !== socket) return;
      // The browser always follows a transport error with "close"; the close
      // handler owns reconnection, here we only report the state.
      this.setStatus("offline");
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.dropSocket();
    };
  }

  /** Detaches handlers, aborts the handshake and closes the socket. */
  private disposeSocket(socket: WebSocket): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;

    try {
      socket.close();
    } catch {
      // Closing an already closed socket is fine.
    }
  }

  /** Forgets the current socket (with or without an error) and retries. */
  private dropSocket(): void {
    this.stopHeartbeat();

    const socket = this.socket;
    this.socket = null;
    if (socket) this.disposeSocket(socket);

    this.setStatus("offline");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /* ----------------------------------------------------------------------- */
  /* Heartbeat                                                               */
  /* ----------------------------------------------------------------------- */

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.pingTimer = setInterval(() => {
      if (!this.isOpen()) return;

      this.awaitingPong = true;
      this.send(HEARTBEAT_PACKET);
      this.clearPongTimer();

      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        if (!this.awaitingPong) return;
        // Dead link: force a fresh socket instead of waiting for TCP timeouts.
        this.dropSocket();
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearPongTimer();
    this.awaitingPong = false;
  }

  private clearPongTimer(): void {
    if (this.pongTimer === null) return;
    clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  /* ----------------------------------------------------------------------- */
  /* Incoming packets                                                        */
  /* ----------------------------------------------------------------------- */

  private handleIncoming(data: unknown): void {
    // The relay only sends text frames; ignore anything else.
    if (typeof data !== "string") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // Malformed JSON is dropped silently (PROTOCOL.md §2.4).
    }

    if (!isPacket(parsed)) return;

    if (parsed.type === "pong") {
      this.awaitingPong = false;
      this.clearPongTimer();
    } else if (parsed.type === "ping") {
      return; // The client never answers pings.
    }

    for (const listener of [...this.packetListeners]) listener(parsed);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of [...this.statusListeners]) listener(status);
  }
}
