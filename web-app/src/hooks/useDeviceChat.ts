/**
 * React binding for a device chat: history, live packets, optimistic sends
 * and connection state. All transport work lives in `DeviceConnection`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HISTORY_LIMIT, PROTOCOL_VERSION, isMsgPacket } from "@iot/shared";
import type { CbPacket, MsgPacket, Packet } from "@iot/shared";
import { DeviceConnection } from "../lib/connection";
import { toHttpBase } from "../lib/serverApi";
import type { ConnectionMode, ConnectionStatus } from "../lib/types";

export interface UseDeviceChatOptions {
  token: string | null;
  mode: ConnectionMode;
  serverUrl: string;
  localHost?: string;
}

export interface UseDeviceChatResult {
  messages: MsgPacket[];
  status: ConnectionStatus;
  deviceOnline: boolean;
  error: string | null;
  sendText(text: string): boolean;
  sendCallback(messageId: string, data: string): boolean;
  clearHistory(): void;
}

/** Hard cap for the in-memory feed; the relay keeps only the last 50. */
const MAX_MESSAGES = 200;

const LOCAL_HOST_ERROR = "Укажите IP-адрес устройства для локального режима";
const CONNECTION_LOST_ERROR = "Соединение потеряно. Переподключаемся…";

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** ws(s):// relay origin -> http(s):// origin for the REST endpoint. */
function historyUrl(serverUrl: string, token: string): string {
  const query = `token=${encodeURIComponent(token)}&limit=${HISTORY_LIMIT}`;
  return `${toHttpBase(serverUrl)}/api/v1/history?${query}`;
}

function extractMessages(payload: unknown): MsgPacket[] {
  if (!isRecord(payload) || !Array.isArray(payload.messages)) return [];
  return payload.messages.filter(isMsgPacket);
}

/** History is a nice-to-have: any failure simply leaves the feed empty. */
async function fetchHistory(
  serverUrl: string,
  token: string,
  signal: AbortSignal,
): Promise<MsgPacket[]> {
  try {
    const response = await fetch(historyUrl(serverUrl, token), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];

    const payload: unknown = await response.json();
    return extractMessages(payload);
  } catch {
    // Network error or abort (stale request): keep the feed as it is.
    return [];
  }
}

function trimFeed(messages: MsgPacket[]): MsgPacket[] {
  if (messages.length <= MAX_MESSAGES) return messages;
  return messages.slice(messages.length - MAX_MESSAGES);
}

/** Edits replace the matching message in place, new ids are appended. */
function upsertMessage(messages: MsgPacket[], packet: MsgPacket): MsgPacket[] {
  const index = messages.findIndex((item) => item.id === packet.id);
  if (index === -1) return trimFeed([...messages, packet]);

  const next = messages.slice();
  next[index] = packet;
  return next;
}

/**
 * The LAN firmware sends ts=0 (the cloud relay normally fills it in). Stamp
 * such packets with the receive time so day separators and clocks stay sane.
 * For edits, keep the timestamp of the message being edited.
 */
function withTimestamp(messages: MsgPacket[], packet: MsgPacket): MsgPacket {
  if (packet.ts && packet.ts > 0) return packet;

  const existing = messages.find((item) => item.id === packet.id);
  return { ...packet, ts: existing?.ts ?? Math.floor(Date.now() / 1000) };
}

/**
 * Older history goes before live messages. Messages that arrived over the
 * socket while the request was in flight win over their stored copy.
 */
function mergeHistory(messages: MsgPacket[], history: MsgPacket[]): MsgPacket[] {
  const known = new Set(messages.map((item) => item.id));
  const missing = history.filter((item) => !known.has(item.id));
  if (missing.length === 0) return messages;
  return trimFeed([...missing, ...messages]);
}

/* ------------------------------------------------------------------------- */
/* Hook                                                                      */
/* ------------------------------------------------------------------------- */

export function useDeviceChat(options: UseDeviceChatOptions): UseDeviceChatResult {
  const { token, mode, serverUrl, localHost } = options;

  const [messages, setMessages] = useState<MsgPacket[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("offline");
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectionRef = useRef<DeviceConnection | null>(null);
  const messageSeq = useRef(0);

  useEffect(() => {
    // Another device or transport mode starts from a clean slate.
    setMessages([]);
    setDeviceOnline(false);
    setError(null);
    setStatus("offline");
    connectionRef.current = null;

    if (!token) return;

    const host = localHost?.trim();
    if (mode === "local" && !host) {
      setError(LOCAL_HOST_ERROR);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    // The ESP does not expose REST history yet, so LAN mode starts empty.
    if (mode === "cloud") {
      void fetchHistory(serverUrl, token, controller.signal).then((history) => {
        if (cancelled || history.length === 0) return;
        setMessages((current) => mergeHistory(current, history));
      });
    }

    const connection = new DeviceConnection({
      token,
      mode,
      serverUrl,
      localHost: host || undefined,
    });
    connectionRef.current = connection;

    const unsubscribePacket = connection.onPacket((packet: Packet) => {
      switch (packet.type) {
        case "msg":
          setMessages((current) => upsertMessage(current, withTimestamp(current, packet)));
          break;
        case "status":
          setDeviceOnline(packet.dev_online);
          break;
        case "err":
          setError(packet.msg);
          break;
        default:
          // "cb", "ping" and "pong" never belong to the feed.
          break;
      }
    });

    const unsubscribeStatus = connection.onStatus((next: ConnectionStatus) => {
      setStatus(next);
      if (next === "online") {
        setError(null);
      } else if (next === "offline") {
        // One stable message: retries overwrite it with the same string.
        setError(CONNECTION_LOST_ERROR);
      }
    });

    connection.connect();

    return () => {
      cancelled = true;
      controller.abort();
      unsubscribePacket();
      unsubscribeStatus();
      connection.close();
      if (connectionRef.current === connection) connectionRef.current = null;
    };
  }, [token, mode, serverUrl, localHost]);

  const sendText = useCallback((text: string): boolean => {
    const trimmed = text.trim();
    const connection = connectionRef.current;
    if (!connection || trimmed.length === 0) return false;

    messageSeq.current += 1;
    const packet: MsgPacket = {
      v: PROTOCOL_VERSION,
      type: "msg",
      id: `w_${Date.now().toString(36)}_${messageSeq.current}`,
      from: "usr",
      ts: Math.floor(Date.now() / 1000),
      text: trimmed,
    };

    // The relay does not echo "usr" messages back, so show it optimistically
    // but only once it actually went out.
    if (!connection.send(packet)) return false;

    setMessages((current) => upsertMessage(current, packet));
    return true;
  }, []);

  const sendCallback = useCallback((messageId: string, data: string): boolean => {
    const connection = connectionRef.current;
    if (!connection) return false;

    const packet: CbPacket = {
      v: PROTOCOL_VERSION,
      type: "cb",
      id: messageId,
      from: "usr",
      d: data,
    };
    return connection.send(packet);
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
  }, []);

  return useMemo(
    () => ({
      messages,
      status,
      // LAN mode has no relay "status" packets: an open socket means the
      // device is reachable, so report it as online.
      deviceOnline: mode === "local" ? status === "online" : deviceOnline,
      error,
      sendText,
      sendCallback,
      clearHistory,
    }),
    [messages, status, deviceOnline, error, mode, sendText, sendCallback, clearHistory],
  );
}
