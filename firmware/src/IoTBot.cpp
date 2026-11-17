#include "IoTBot.h"

#ifdef ESP32
#include <WiFi.h>
#else
#include <ESP8266WiFi.h>
#endif
#include <stdio.h>
#include <string.h>

namespace {

const char *const kLogPrefix = "[IoTBot] ";

/** Truncates a UTF-8 string to at most `maxBytes` bytes without splitting a character. */
String truncateUtf8(const String &value, size_t maxBytes) {
  if (value.length() <= maxBytes) {
    return value;
  }

  size_t cut = maxBytes;
  // Move back while the first excluded byte is a UTF-8 continuation byte.
  while (cut > 0 && (static_cast<uint8_t>(value[cut]) & 0xC0) == 0x80) {
    --cut;
  }
  return value.substring(0, cut);
}

/**
 * Parses one menu token: "Label" or "Label:data".
 * Returns false for empty/invalid tokens (skipped by the keyboard builder).
 */
bool splitButton(const String &token, String &label, String &data, int autoIndex) {
  String trimmed = token;
  trimmed.trim();
  if (trimmed.length() == 0) {
    return false;
  }

  const int colon = trimmed.indexOf(':');
  if (colon >= 0) {
    label = trimmed.substring(0, colon);
    data = trimmed.substring(colon + 1);
    label.trim();
    data.trim();
    return label.length() > 0 && data.length() > 0;
  }

  label = trimmed;
  data = "b";
  data += autoIndex;
  return true;
}

}  // namespace

IoTBot::IoTBot(const String &token)
    : _token(token),
      _host(),
      _port(443),
      _secure(true),
      _serverSet(false),
      _transportStarted(false),
      _connected(false),
      _debug(false),
      _handler(nullptr),
      _msgSeq(0),
      _lastPing(0),
      _pingSentAt(0) {}

void IoTBot::setServer(const String &host, uint16_t port, bool secure) {
  _host = host;
  _port = port;
  _secure = secure;
  _serverSet = host.length() > 0 && _token.length() > 0;
}

void IoTBot::attach(IB_callback handler) {
  _handler = handler;
}

void IoTBot::setDebug(bool enabled) {
  _debug = enabled;
}

void IoTBot::tick() {
  if (!_serverSet) {
    return;
  }

  // The sketch owns WiFi; the library only works when the link is up.
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  if (!_transportStarted) {
    startTransport();
  }

  _ws.loop();

  if (!_connected) {
    return;
  }

  const unsigned long now = millis();

  if (_pingSentAt != 0 && (now - _pingSentAt) >= IOTBOT_PONG_TIMEOUT_MS) {
    log("pong timeout: reconnecting");
    _pingSentAt = 0;
    _connected = false;
    _ws.disconnect();
    return;
  }

  if (_pingSentAt == 0 && (now - _lastPing) >= IOTBOT_PING_INTERVAL_MS) {
    sendPing();
  }
}

void IoTBot::startTransport() {
  _transportStarted = true;

  // wss://HOST/ws?role=dev&token=<TOKEN> (PROTOCOL.md §1.1)
  String path = "/ws?role=dev&token=";
  path += _token;

  _ws.setReconnectInterval(IOTBOT_RECONNECT_DELAY_MS);
  _ws.onEvent([this](WStype_t type, uint8_t *payload, size_t length) {
    handleEvent(type, payload, length);
  });

  if (_secure) {
    _ws.beginSSL(_host.c_str(), _port, path.c_str());
  } else {
    _ws.begin(_host.c_str(), _port, path.c_str());
  }
}

void IoTBot::handleEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      _connected = true;
      _pingSentAt = 0;
      _lastPing = millis();
      log("connected");
      break;
    case WStype_DISCONNECTED:
      _connected = false;
      _pingSentAt = 0;
      log("disconnected");
      break;
    case WStype_TEXT:
      handlePacket(payload, length);
      break;
    case WStype_PONG:
      // Transport-level pong (ws ping frame) also proves the link is alive.
      _pingSentAt = 0;
      _lastPing = millis();
      break;
    case WStype_ERROR:
      log("websocket error");
      break;
    default:
      break;
  }
}

void IoTBot::handlePacket(uint8_t *payload, size_t length) {
  if (payload == nullptr || length == 0) {
    return;
  }

  _rxDoc.clear();
  const DeserializationError error = deserializeJson(_rxDoc, payload, length);
  if (error) {
    if (_debug) {
      Serial.print(kLogPrefix);
      Serial.print("JSON error: ");
      Serial.println(error.c_str());
    }
    return;
  }

  const char *type = _rxDoc["type"] | "";

  if (strcmp(type, "pong") == 0) {
    _pingSentAt = 0;
    _lastPing = millis();
    return;
  }

  if (strcmp(type, "err") == 0) {
    if (_debug) {
      Serial.print(kLogPrefix);
      Serial.print("server error ");
      Serial.print(static_cast<int>(_rxDoc["code"] | 0));
      Serial.print(": ");
      Serial.println(static_cast<const char *>(_rxDoc["msg"] | ""));
    }
    return;
  }

  if (_handler == nullptr) {
    return;
  }

  IB_msg msg;
  msg.id = static_cast<const char *>(_rxDoc["id"] | "");

  if (strcmp(type, "msg") == 0) {
    msg.text = static_cast<const char *>(_rxDoc["text"] | "");
    msg.isCallback = false;
    _handler(msg);
    return;
  }

  if (strcmp(type, "cb") == 0) {
    msg.data = static_cast<const char *>(_rxDoc["d"] | "");
    msg.isCallback = true;
    _handler(msg);
  }
}

String IoTBot::nextMessageId() {
  char buffer[20];
  snprintf(buffer, sizeof(buffer), "m_%lu", static_cast<unsigned long>(++_msgSeq));
  return String(buffer);
}

bool IoTBot::sendMessage(const String &text) {
  return publish(nextMessageId(), text, false, String(), false);
}

bool IoTBot::sendInline(const String &text, const String &menu) {
  return publish(nextMessageId(), text, true, menu, false);
}

bool IoTBot::editMessage(const String &id, const String &text) {
  return publish(id, text, false, String(), true);
}

bool IoTBot::editMessage(const String &id, const String &text, const String &menu) {
  return publish(id, text, true, menu, true);
}

bool IoTBot::isConnected() const {
  return _connected;
}

bool IoTBot::publish(const String &id, const String &text, bool hasMenu, const String &menu, bool edit) {
  if (!_connected) {
    return false;
  }

  _txDoc.clear();
  _txDoc["v"] = 1;
  _txDoc["type"] = "msg";
  _txDoc["id"] = id;
  _txDoc["from"] = "dev";
  _txDoc["ts"] = 0;  // the relay fills in the current time (PROTOCOL.md §2.1)
  if (edit) {
    _txDoc["edit"] = true;
  }
  _txDoc["text"] = truncateUtf8(text, IOTBOT_MAX_TEXT_BYTES);

  if (hasMenu) {
    buildKeyboard(menu, _txDoc);
  }

  if (measureJson(_txDoc) >= IOTBOT_TX_BUFFER_SIZE) {
    log("packet exceeds 1024 bytes: shorten text or button labels");
    return false;
  }

  return sendPacket(_txDoc);
}

void IoTBot::buildKeyboard(const String &menu, JsonDocument &doc) {
  JsonArray keyboard;  // created lazily: an empty menu must not add "kb":[]
  int globalIndex = 0;
  int rowStart = 0;
  int rows = 0;
  const int length = static_cast<int>(menu.length());

  while (rowStart <= length && rows < IOTBOT_MAX_KB_ROWS) {
    int rowEnd = menu.indexOf('\n', rowStart);
    if (rowEnd < 0 || rowEnd > length) {
      rowEnd = length;
    }

    // Pass 1: count valid buttons so empty rows are never added.
    int validButtons = 0;
    for (int i = rowStart; i <= rowEnd;) {
      int next = menu.indexOf('\t', i);
      if (next < 0 || next > rowEnd) {
        next = rowEnd;
      }
      String label;
      String data;
      if (splitButton(menu.substring(i, next), label, data, globalIndex + validButtons)) {
        ++validButtons;
      }
      if (next >= rowEnd) {
        break;
      }
      i = next + 1;
    }

    if (validButtons > 0) {
      if (keyboard.isNull()) {
        keyboard = doc["kb"].to<JsonArray>();
      }
      JsonArray row = keyboard.add<JsonArray>();

      // Pass 2: emit up to IOTBOT_MAX_KB_COLS buttons.
      int added = 0;
      for (int i = rowStart; i <= rowEnd && added < IOTBOT_MAX_KB_COLS;) {
        int next = menu.indexOf('\t', i);
        if (next < 0 || next > rowEnd) {
          next = rowEnd;
        }
        String label;
        String data;
        if (splitButton(menu.substring(i, next), label, data, globalIndex)) {
          JsonObject button = row.add<JsonObject>();
          button["t"] = label;
          button["d"] = data;
          ++globalIndex;
          ++added;
        }
        if (next >= rowEnd) {
          break;
        }
        i = next + 1;
      }
      ++rows;
    }

    if (rowEnd >= length) {
      break;
    }
    rowStart = rowEnd + 1;
  }
}

bool IoTBot::sendPacket(JsonDocument &doc) {
  const size_t needed = measureJson(doc);
  if (needed == 0 || needed >= IOTBOT_TX_BUFFER_SIZE) {
    return false;
  }

  const size_t written = serializeJson(doc, _txBuf, sizeof(_txBuf));
  if (written != needed) {
    return false;
  }

  const bool sent = _ws.sendTXT(_txBuf, written);

  if (_debug) {
    Serial.print(kLogPrefix);
    Serial.print(sent ? "TX " : "TX failed ");
    Serial.write(reinterpret_cast<const uint8_t *>(_txBuf), written);
    Serial.println();
  }

  return sent;
}

void IoTBot::sendPing() {
  _txDoc.clear();
  _txDoc["v"] = 1;
  _txDoc["type"] = "ping";

  if (sendPacket(_txDoc)) {
    _pingSentAt = millis();
    _lastPing = _pingSentAt;
  }
}

void IoTBot::log(const char *message) {
  if (!_debug) {
    return;
  }
  Serial.print(kLogPrefix);
  Serial.println(message);
}
