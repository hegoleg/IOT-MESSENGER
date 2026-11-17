import "esp-web-tools";
import QRCode from "qrcode";

const $ = (id) => document.getElementById(id);

/** WebSocket relay URL -> normalized ws(s) origin. */
function normalizeRelay(raw) {
  const value = raw.trim();
  if (!value) return null;

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `ws://${value}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;

  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/ws")) path = path.slice(0, -3).replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

function toHttpBase(relay) {
  return relay
    .replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:")
    .replace(/\/+$/, "");
}

function parseRelay(relay) {
  const url = new URL(relay);
  const secure = url.protocol === "wss:";
  return {
    host: url.hostname,
    port: Number(url.port) || (secure ? 443 : 80),
    secure,
  };
}

async function checkRelay(relay) {
  const response = await fetch(`${toHttpBase(relay)}/api/v1/health`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Релей ответил HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload || payload.ok !== true || payload.v !== 1) {
    throw new Error("По адресу отвечает несовместимый сервер");
  }
  return payload;
}

async function createToken(relay) {
  const response = await fetch(`${toHttpBase(relay)}/api/v1/devices/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`Не удалось создать токен: HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload || typeof payload.token !== "string" || payload.token.length === 0) {
    throw new Error("Релей вернул некорректный токен");
  }
  return payload.token;
}

/** Line-based USB serial connection to the quickstart firmware. */
class BoardSerial {
  constructor(log) {
    this.log = log;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.buffer = "";
    this.history = [];
    this.waiters = [];
    this.decoder = new TextDecoder();
  }

  get connected() {
    return this.port !== null;
  }

  async connect() {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    this.port = port;
    this.writer = port.writable.getWriter();
    this.reader = port.readable.getReader();
    this.buffer = "";
    this.history = [];
    void this.readLoop();
  }

  async readLoop() {
    const reader = this.reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.buffer += this.decoder.decode(value, { stream: true });

        let newline;
        while ((newline = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, newline).replace(/\r$/, "").trim();
          this.buffer = this.buffer.slice(newline + 1);
          if (line) this.handleLine(line);
        }
      }
    } catch (error) {
      if (this.port) this.log(`USB: ${error.message}`);
    }
  }

  handleLine(line) {
    this.history.push(line);
    if (this.history.length > 80) this.history.shift();
    if (line.startsWith("IOTBOT:")) this.log(line);

    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(line)) continue;
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter((item) => item !== waiter);
      waiter.resolve(line);
    }
  }

  clearHistory() {
    this.history = [];
  }

  waitFor(predicate, timeoutMs = 5000) {
    const existing = this.history.find((line) => predicate(line));
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error("Плата не ответила вовремя"));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async send(line) {
    if (!this.writer) throw new Error("USB-порт не открыт");
    await this.writer.write(new TextEncoder().encode(`${line}\n`));
  }

  async close() {
    try {
      await this.reader?.cancel();
    } catch {
      // Already stopped.
    }
    try {
      this.writer?.releaseLock();
    } catch {
      // Already released.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      await this.port?.close();
    } catch {
      // Already closed.
    }
    this.port = null;
    this.reader = null;
    this.writer = null;
  }
}

export function initFlasher() {
  const section = $("flash");
  if (!section) return;

  const relayInput = $("flash-relay");
  const checkButton = $("flash-check");
  const relayStatus = $("flash-relay-status");
  const connectButton = $("flash-connect");
  const serialBox = $("flash-serial");
  const scanButton = $("flash-scan");
  const ssidInput = $("flash-ssid");
  const networkList = $("flash-networks");
  const passwordInput = $("flash-password");
  const configureButton = $("flash-configure");
  const logBox = $("flash-log");
  const unsupported = $("flash-unsupported");
  const controls = $("flash-controls");
  const result = $("flash-result");
  const tokenValue = $("flash-token-value");
  const qrCanvas = $("flash-qr");
  const copyButton = $("flash-copy");

  const params = new URLSearchParams(window.location.search);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const defaultRelay = local
    ? `ws://${window.location.hostname}:8080`
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
  relayInput.value = params.get("relay") || defaultRelay;

  const serial = new BoardSerial((line) => appendLog(line));
  let busy = false;

  function appendLog(line) {
    logBox.textContent += `${line}\n`;
    const lines = logBox.textContent.split("\n");
    if (lines.length > 14) logBox.textContent = lines.slice(-14).join("\n");
    logBox.scrollTop = logBox.scrollHeight;
  }

  function setStatus(text, kind = "") {
    relayStatus.textContent = text;
    relayStatus.dataset.kind = kind;
  }

  function setBusy(value) {
    busy = value;
    for (const button of [checkButton, connectButton, scanButton, configureButton]) {
      if (button) button.disabled = value;
    }
  }

  const supported = "serial" in navigator && window.isSecureContext;
  if (!supported) {
    unsupported.hidden = false;
    controls.hidden = true;
    return;
  }
  unsupported.hidden = true;

  checkButton.addEventListener("click", async () => {
    const relay = normalizeRelay(relayInput.value);
    if (!relay) {
      setStatus("Введите адрес вида ws://192.168.1.10:8080", "error");
      return;
    }
    relayInput.value = relay;
    setStatus("Проверяем релей…");
    try {
      const health = await checkRelay(relay);
      setStatus(`Релей доступен · uptime ${health.uptime} с`, "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  connectButton.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    try {
      appendLog("Открываем USB-порт…");
      await serial.connect();
      appendLog("Порт открыт. Ищем плату…");

      serial.clearHistory();
      const ready = await serial
        .waitFor(
          (line) => line.includes("IOTBOT:READY") || line.includes("IOTBOT:HELLO"),
          3500,
        )
        .catch(() => null);

      if (!ready) {
        serial.clearHistory();
        await serial.send("IOTBOT:WHO");
        await serial.waitFor(
          (line) => line.includes("IOTBOT:HELLO") || line.includes("IOTBOT:READY"),
          5000,
        );
      }

      appendLog("Плата на связи.");
      serialBox.hidden = false;
      await scanNetworks();
    } catch (error) {
      appendLog(`USB: ${error.message}`);
      appendLog("Если открыто окно ESP Web Tools, закройте его и нажмите снова.");
      await serial.close();
    } finally {
      setBusy(false);
    }
  });

  async function scanNetworks() {
    setBusy(true);
    try {
      serial.clearHistory();
      appendLog("Сканируем Wi-Fi сети…");
      await serial.send("IOTBOT:SCAN");
      const line = await serial.waitFor(
        (value) => value.startsWith("IOTBOT:NETWORKS:"),
        15000,
      );
      const networks = JSON.parse(line.slice("IOTBOT:NETWORKS:".length));
      networkList.innerHTML = "";
      for (const ssid of networks) {
        const option = document.createElement("option");
        option.value = ssid;
        networkList.appendChild(option);
      }
      appendLog(`Найдено сетей: ${networks.length}. Выберите сеть или введите SSID.`);
    } catch (error) {
      appendLog(`Скан не удался: ${error.message}. Введите SSID вручную.`);
    } finally {
      setBusy(false);
    }
  }

  scanButton.addEventListener("click", () => {
    if (!busy) void scanNetworks();
  });

  configureButton.addEventListener("click", async () => {
    if (busy) return;

    const relay = normalizeRelay(relayInput.value);
    const ssid = ssidInput.value.trim();
    if (!relay) {
      appendLog("Укажите корректный адрес релея.");
      return;
    }
    if (!ssid) {
      appendLog("Выберите Wi-Fi сеть или введите SSID.");
      return;
    }
    if (!serial.connected) {
      appendLog("Сначала подключитесь к плате по USB.");
      return;
    }

    setBusy(true);
    try {
      appendLog("Проверяем релей…");
      await checkRelay(relay);

      appendLog("Создаём токен…");
      const token = await createToken(relay);
      const target = parseRelay(relay);
      const config = {
        ssid,
        pass: passwordInput.value,
        token,
        host: target.host,
        port: target.port,
        secure: target.secure,
      };

      serial.clearHistory();
      appendLog("Отправляем настройки на плату…");
      await serial.send(`IOTBOT:SET:${JSON.stringify(config)}`);
      await serial.waitFor((line) => line === "IOTBOT:OK", 10000);
      appendLog("Плата сохранила настройки и перезагружается.");
      await serial.close();
      await showResult(token, relay);
    } catch (error) {
      appendLog(`Ошибка настройки: ${error.message}`);
    } finally {
      setBusy(false);
    }
  });

  async function showResult(token, relay) {
    tokenValue.textContent = token;
    result.hidden = false;

    let qrValue = token;
    try {
      const appLink = document.querySelector("[data-app-link]");
      const base = appLink?.href || new URL("app/", window.location.href).toString();
      const appUrl = new URL(base);
      const hash = new URLSearchParams({ token, relay });
      appUrl.hash = hash.toString();
      qrValue = appUrl.toString();
    } catch {
      // Fall back to the raw token.
    }

    try {
      await QRCode.toCanvas(qrCanvas, qrValue, {
        width: 200,
        margin: 1,
        color: { dark: "#101113", light: "#f2f0e7" },
      });
    } catch {
      // QR is a convenience; the token text remains.
    }

    result.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  copyButton.addEventListener("click", async () => {
    const token = tokenValue.textContent ?? "";
    if (!token) return;

    try {
      await navigator.clipboard.writeText(token);
    } catch {
      const area = document.createElement("textarea");
      area.value = token;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }

    copyButton.textContent = "Скопировано";
    window.setTimeout(() => {
      copyButton.textContent = "Скопировать токен";
    }, 1600);
  });
}
