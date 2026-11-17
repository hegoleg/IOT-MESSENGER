/**
 * ESP8266/ESP32 protocol simulator.
 *
 * Speaks the same JSON packets as firmware/IoTBot over the cloud relay:
 * device heartbeat, inline menus, callback handling, message edits and
 * periodic telemetry. Used by the interactive CLI and by integration tests.
 */

import WebSocket from "ws";
import {
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  PROTOCOL_VERSION,
  RECONNECT_DELAY_MS,
  WS_PATH,
  validatePacket,
  type CbPacket,
  type ErrPacket,
  type IBButton,
  type MsgPacket,
  type Packet,
} from "@iot/shared";

export interface EspSimulatorOptions {
  /** Relay origin, e.g. "ws://127.0.0.1:8080" (without the /ws path). */
  serverUrl: string;
  /** Device token issued by POST /api/v1/devices/create. */
  token: string;
  /** Log sink; defaults to console. */
  log?: (message: string) => void;
  /** Sensor broadcast period in ms; 0 disables telemetry. */
  telemetryIntervalMs?: number;
  /** Heartbeat overrides (used by fast integration tests). */
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  reconnectDelayMs?: number;
}

const SENSOR_MESSAGE_ID = "sim_sensor";

const MENU_TEXT = "Теплица онлайн. Выберите действие:";
const MENU_KEYBOARD: IBButton[][] = [
  [
    { t: "Полив вкл", d: "pump_on" },
    { t: "Полив выкл", d: "pump_off" },
  ],
  [
    { t: "Датчик", d: "status" },
    { t: "Перезагрузка", d: "reboot" },
  ],
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function maskToken(url: string): string {
  return url.replace(/token=[^&]+/, "token=***");
}

export class EspSimulator {
  private readonly serverUrl: string;
  private readonly token: string;
  private readonly log: (message: string) => void;
  private readonly telemetryIntervalMs: number;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly reconnectDelayMs: number;

  private socket: WebSocket | null = null;
  private stopped = true;
  private online = false;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private pongPending = false;

  private sequence = 0;
  private relayOn = false;
  private sensorPublished = false;
  private temperature = 24.5;
  private humidity = 61;
  private light = 64;

  constructor(options: EspSimulatorOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.log = options.log ?? ((message) => console.log(`[esp-sim] ${message}`));
    this.telemetryIntervalMs = options.telemetryIntervalMs ?? 0;
    this.pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
    this.pongTimeoutMs = options.pongTimeoutMs ?? PONG_TIMEOUT_MS;
    this.reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    this.stopHeartbeat();
    this.stopTelemetry();
    this.online = false;

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      try {
        socket.close();
        socket.terminate();
      } catch {
        // Already closed.
      }
    }
  }

  isOnline(): boolean {
    return this.online;
  }

  /* --------------------------------------------------------------------- */
  /* Connection                                                             */
  /* --------------------------------------------------------------------- */

  private connect(): void {
    if (this.stopped) return;
    this.clearReconnect();

    const url = `${this.serverUrl}${WS_PATH}?role=dev&token=${encodeURIComponent(this.token)}`;
    this.log(`connecting ${maskToken(url)}`);

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      this.log(`dial failed: ${(error as Error).message}`);
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;

    socket.on("open", () => {
      if (this.socket !== socket) return;
      this.online = true;
      this.pongPending = false;
      this.log("connected as role=dev");
      this.startHeartbeat();
      this.startTelemetry();
    });

    socket.on("message", (data) => {
      if (this.socket !== socket) return;
      this.handleData(data.toString());
    });

    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.online = false;
      this.stopHeartbeat();
      this.stopTelemetry();
      if (!this.stopped) {
        this.log(`disconnected, retry in ${this.reconnectDelayMs} ms`);
        this.scheduleReconnect();
      }
    });

    socket.on("error", (error) => {
      // The close event owns reconnection.
      this.log(`socket error: ${error.message}`);
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
  }

  private clearReconnect(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /* --------------------------------------------------------------------- */
  /* Heartbeat (PROTOCOL.md §2.4)                                           */
  /* --------------------------------------------------------------------- */

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (!this.online) return;
      if (this.pongPending) {
        this.log("heartbeat: no pong for the previous ping, reconnecting");
        this.socket?.terminate();
        return;
      }

      this.pongPending = true;
      this.send({ v: PROTOCOL_VERSION, type: "ping" });
      this.clearPongTimer();
      this.pongTimer = setTimeout(() => {
        if (!this.pongPending) return;
        this.log("heartbeat: pong timeout, reconnecting");
        this.socket?.terminate();
      }, this.pongTimeoutMs);
    }, this.pingIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearPongTimer();
    this.pongPending = false;
  }

  private clearPongTimer(): void {
    if (!this.pongTimer) return;
    clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  /* --------------------------------------------------------------------- */
  /* Incoming packets                                                       */
  /* --------------------------------------------------------------------- */

  private handleData(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.log("invalid JSON from relay");
      return;
    }

    const result = validatePacket(json);
    if (!result.ok) {
      this.log(`invalid packet: ${result.reason}`);
      return;
    }

    const packet = result.packet;
    switch (packet.type) {
      case "ping":
        this.send({ v: PROTOCOL_VERSION, type: "pong" });
        break;
      case "pong":
        this.pongPending = false;
        this.clearPongTimer();
        break;
      case "msg":
        this.handleUserMessage(packet);
        break;
      case "cb":
        this.handleCallback(packet);
        break;
      case "err":
        this.handleError(packet);
        break;
      case "status":
        // The device does not need the relay's presence packets.
        break;
    }
  }

  private handleError(packet: ErrPacket): void {
    this.log(`server err ${packet.code}: ${packet.msg}`);
    if (packet.code === 401) {
      this.log("invalid device token, stopping simulation");
      this.stop();
    }
  }

  private handleUserMessage(packet: MsgPacket): void {
    this.log(`<- msg "${packet.text}"`);
    const command = packet.text.trim().toLowerCase();

    if (command === "/start" || command.startsWith("/start ")) {
      this.sendInline(MENU_TEXT, MENU_KEYBOARD);
      this.startTelemetry();
      return;
    }

    if (command === "/on") {
      this.setRelay(true);
      this.sendMessage(`Полив включён\n${this.sensorText()}`);
      return;
    }

    if (command === "/off") {
      this.setRelay(false);
      this.sendMessage(`Полив выключен\n${this.sensorText()}`);
      return;
    }

    if (command === "/status") {
      this.updateSensors();
      if (this.sensorPublished) {
        this.sendMessageById(SENSOR_MESSAGE_ID, this.sensorText(), MENU_KEYBOARD, true);
      } else {
        this.sendMessage(this.sensorText());
      }
      return;
    }

    if (command === "/stop") {
      this.stopTelemetry();
      this.sendMessage("Телеметрия остановлена");
      return;
    }

    this.sendMessage(
      `Неизвестная команда: ${packet.text.trim()}\nДоступно: /start, /on, /off, /status, /stop`,
    );
  }

  private handleCallback(packet: CbPacket): void {
    this.log(`<- cb "${packet.d}" (message ${packet.id})`);

    switch (packet.d) {
      case "pump_on":
        this.setRelay(true);
        this.sendMessageById(
          packet.id,
          `Полив включён\n${this.sensorText()}`,
          MENU_KEYBOARD,
          true,
        );
        break;
      case "pump_off":
        this.setRelay(false);
        this.sendMessageById(
          packet.id,
          `Полив выключен\n${this.sensorText()}`,
          MENU_KEYBOARD,
          true,
        );
        break;
      case "status":
        this.updateSensors();
        this.sendMessageById(packet.id, this.sensorText(), MENU_KEYBOARD, true);
        break;
      case "reboot":
        this.log("reboot simulated");
        this.sendMessageById(
          packet.id,
          "ESP перезагружена (симуляция)",
          MENU_KEYBOARD,
          true,
        );
        break;
      default:
        this.sendMessage(`Неизвестный callback: ${packet.d}`);
        break;
    }
  }

  /* --------------------------------------------------------------------- */
  /* Telemetry                                                              */
  /* --------------------------------------------------------------------- */

  private startTelemetry(): void {
    if (!this.telemetryIntervalMs || this.telemetryTimer) return;
    this.telemetryTimer = setInterval(() => this.publishTelemetry(), this.telemetryIntervalMs);
    this.publishTelemetry();
  }

  private stopTelemetry(): void {
    if (!this.telemetryTimer) return;
    clearInterval(this.telemetryTimer);
    this.telemetryTimer = null;
  }

  private publishTelemetry(): void {
    if (!this.online) return;
    this.updateSensors();

    if (!this.sensorPublished) {
      this.sensorPublished = this.sendMessageById(
        SENSOR_MESSAGE_ID,
        this.sensorText(),
        MENU_KEYBOARD,
        false,
      );
    } else {
      this.sendMessageById(SENSOR_MESSAGE_ID, this.sensorText(), MENU_KEYBOARD, true);
    }
  }

  private updateSensors(): void {
    this.temperature = clamp(this.temperature + (Math.random() - 0.5) * 0.6, 18, 30);
    this.humidity = clamp(Math.round(this.humidity + (Math.random() - 0.5) * 4), 35, 85);
    this.light = clamp(Math.round(this.light + (Math.random() - 0.5) * 6), 0, 100);
  }

  private setRelay(on: boolean): void {
    this.relayOn = on;
    this.log(`relay -> ${on ? "ON" : "OFF"}`);
  }

  private sensorText(): string {
    return [
      `Температура: ${this.temperature.toFixed(1)}°C`,
      `Влажность: ${this.humidity}%`,
      `Освещённость: ${this.light}%`,
      `Полив: ${this.relayOn ? "включён" : "выключен"}`,
    ].join("\n");
  }

  /* --------------------------------------------------------------------- */
  /* Outgoing packets                                                       */
  /* --------------------------------------------------------------------- */

  private nextId(): string {
    this.sequence += 1;
    return `m_${this.sequence}`;
  }

  private sendMessage(text: string): string | null {
    const id = this.nextId();
    return this.sendMessageById(id, text, undefined, false) ? id : null;
  }

  private sendInline(text: string, keyboard: IBButton[][]): string | null {
    const id = this.nextId();
    return this.sendMessageById(id, text, keyboard, false) ? id : null;
  }

  private sendMessageById(
    id: string,
    text: string,
    keyboard: IBButton[][] | undefined,
    edit: boolean,
  ): boolean {
    const packet: MsgPacket = {
      v: PROTOCOL_VERSION,
      type: "msg",
      id,
      from: "dev",
      ts: 0, // the relay substitutes the current time (PROTOCOL.md §2.1)
      text,
    };
    if (keyboard) packet.kb = keyboard;
    if (edit) packet.edit = true;

    const sent = this.send(packet);
    if (sent) {
      this.log(`-> ${edit ? "edit" : "msg"} ${id}: ${text.split("\n")[0]}`);
    }
    return sent;
  }

  private send(packet: Packet): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(packet));
      return true;
    } catch {
      return false;
    }
  }
}
