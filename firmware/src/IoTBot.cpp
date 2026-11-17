#include "IoTBot.h"

#include "IoTBotPacket.h"

#ifdef ESP32
#include <WiFi.h>
#else
#include <ESP8266WiFi.h>
#endif
#include <string.h>

namespace {

const char *const kLogPrefix = "[IoTBot] ";

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
  return iotbot::nextMessageId(_msgSeq);
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

  if (edit) {
    iotbot::buildEdit(_txDoc, id, text, hasMenu, menu);
  } else {
    iotbot::buildMessage(_txDoc, id, text, hasMenu, menu);
  }

  if (measureJson(_txDoc) >= IOTBOT_TX_BUFFER_SIZE) {
    log("packet exceeds 1024 bytes: shorten text or button labels");
    return false;
  }

  return sendPacket(_txDoc);
}

bool IoTBot::sendPacket(JsonDocument &doc) {
  const size_t written = iotbot::serializePacket(doc, _txBuf, sizeof(_txBuf));
  if (written == 0) {
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
  iotbot::buildPing(_txDoc);

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
