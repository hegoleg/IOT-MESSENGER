#include "IoTBotLAN.h"

#include "IoTBotPacket.h"

#ifdef ESP32
#include <WiFi.h>
#include <ESPmDNS.h>
#else
#include <ESP8266WiFi.h>
#include <ESP8266mDNS.h>
#endif

#include <stdio.h>
#include <string.h>

namespace {

const char *const kLogPrefix = "[IoTBotLAN] ";

}  // namespace

IoTBotLAN::IoTBotLAN(const String &token, uint16_t port)
    : _token(token),
      _port(port),
      _debug(false),
      _begun(false),
      _mdns(false),
      _handler(nullptr),
      _server(port),
      _msgSeq(0) {
  for (uint8_t i = 0; i < kMaxClients; ++i) {
    _clients[i].authorized = false;
    _clients[i].windowStart = 0;
    _clients[i].count = 0;
  }
}

void IoTBotLAN::attach(IB_callback handler) {
  _handler = handler;
}

void IoTBotLAN::setDebug(bool enabled) {
  _debug = enabled;
}

void IoTBotLAN::begin() {
  if (_begun) {
    return;
  }
  _begun = true;

  _server.onEvent([this](uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
    handleEvent(num, type, payload, length);
  });
  _server.begin();
  log("LAN server started");
}

void IoTBotLAN::tick() {
  if (!_begun) {
    // The sketch owns Wi-Fi; start serving only when the link is up.
    if (WiFi.status() != WL_CONNECTED) {
      return;
    }
    begin();
  }

  _server.loop();

#ifdef ESP8266
  // The ESP8266 mDNS responder needs a periodic pump from loop().
  if (_mdns) {
    MDNS.update();
  }
#endif
}

bool IoTBotLAN::sendMessage(const String &text) {
  return publish(iotbot::nextMessageId(_msgSeq), text, false, String(), false);
}

bool IoTBotLAN::sendInline(const String &text, const String &menu) {
  return publish(iotbot::nextMessageId(_msgSeq), text, true, menu, false);
}

bool IoTBotLAN::editMessage(const String &id, const String &text) {
  return publish(id, text, false, String(), true);
}

bool IoTBotLAN::editMessage(const String &id, const String &text, const String &menu) {
  return publish(id, text, true, menu, true);
}

bool IoTBotLAN::isConnected() const {
  return clients() > 0;
}

uint8_t IoTBotLAN::clients() const {
  uint8_t total = 0;
  for (uint8_t i = 0; i < kMaxClients; ++i) {
    if (_clients[i].authorized) {
      ++total;
    }
  }
  return total;
}

String IoTBotLAN::ip() const {
  return WiFi.localIP().toString();
}

bool IoTBotLAN::enableMdns(const String &hostname) {
  const String host = hostname.length() > 0 ? hostname : defaultHostname();
  if (!MDNS.begin(host.c_str())) {
    log("mDNS failed to start");
    return false;
  }

  MDNS.addService("iotbot", "tcp", _port);
  _mdns = true;

  if (_debug) {
    Serial.print(kLogPrefix);
    Serial.print("mDNS: ");
    Serial.print(host);
    Serial.println(".local");
  }
  return true;
}

void IoTBotLAN::handleEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  if (num >= kMaxClients) {
    return;
  }

  switch (type) {
    case WStype_CONNECTED: {
      String url;
      if (payload != nullptr && length > 0) {
        // ESP8266's String has no (ptr, len) constructor; copy into a small buffer.
        char urlBuf[128];
        const size_t copy = length < sizeof(urlBuf) - 1 ? length : sizeof(urlBuf) - 1;
        memcpy(urlBuf, payload, copy);
        urlBuf[copy] = '\0';
        url = urlBuf;
      }
      if (!authorize(num, url)) {
        sendErr(num, 401, "invalid token");
        _server.disconnect(num);
        return;
      }
      resetClient(num);
      _clients[num].authorized = true;
      _clients[num].windowStart = millis();
      sendStatus(num);
      log("client connected");
      break;
    }
    case WStype_DISCONNECTED:
      resetClient(num);
      log("client disconnected");
      break;
    case WStype_TEXT:
      handlePacket(num, payload, length);
      break;
    default:
      break;
  }
}

bool IoTBotLAN::authorize(uint8_t num, const String &url) {
  (void)num;
  if (_token.length() == 0) {
    return false;
  }

  const int at = url.indexOf("token=");
  if (at < 0) {
    return false;
  }

  int start = at + 6;  // strlen("token=")
  int end = url.indexOf('&', start);
  if (end < 0) {
    end = url.length();
  }
  return url.substring(start, end) == _token;
}

bool IoTBotLAN::allowPacket(uint8_t num) {
  ClientState &state = _clients[num];
  const uint32_t now = millis();

  if (now - state.windowStart >= 60UL * 1000UL) {
    state.windowStart = now;
    state.count = 0;
  }
  if (state.count >= IOTBOT_LAN_RATE_LIMIT_PER_MIN) {
    return false;
  }

  state.count += 1;
  return true;
}

void IoTBotLAN::resetClient(uint8_t num) {
  _clients[num].authorized = false;
  _clients[num].windowStart = 0;
  _clients[num].count = 0;
}

void IoTBotLAN::handlePacket(uint8_t num, uint8_t *payload, size_t length) {
  if (!_clients[num].authorized || payload == nullptr || length == 0) {
    return;
  }
  if (length > IOTBOT_TX_BUFFER_SIZE) {
    sendErr(num, 413, "packet exceeds 1024 bytes");
    return;
  }

  _rxDoc.clear();
  const DeserializationError error = deserializeJson(_rxDoc, payload, length);
  if (error) {
    sendErr(num, 400, "invalid JSON");
    return;
  }

  const char *type = _rxDoc["type"] | "";

  if (strcmp(type, "ping") == 0) {
    sendPong(num);
    return;
  }
  if (strcmp(type, "pong") == 0 || strcmp(type, "err") == 0) {
    return;
  }
  if (strcmp(type, "status") == 0) {
    sendErr(num, 400, "status packets are generated by the device");
    return;
  }

  if (!allowPacket(num)) {
    sendErr(num, 429, "message rate limit exceeded");
    return;
  }

  if (_handler == nullptr) {
    return;
  }

  IB_msg msg;
  msg.id = static_cast<const char *>(_rxDoc["id"] | "");

  if (strcmp(type, "msg") == 0) {
    if (strcmp(_rxDoc["from"] | "", "usr") != 0) {
      sendErr(num, 400, "from must be \"usr\"");
      return;
    }
    msg.text = static_cast<const char *>(_rxDoc["text"] | "");
    msg.isCallback = false;
    _handler(msg);
    return;
  }

  if (strcmp(type, "cb") == 0) {
    msg.data = static_cast<const char *>(_rxDoc["d"] | "");
    msg.isCallback = true;
    _handler(msg);
    return;
  }

  sendErr(num, 400, "unknown packet type");
}

void IoTBotLAN::sendStatus(uint8_t num) {
  _txDoc.clear();
  _txDoc["v"] = 1;
  _txDoc["type"] = "status";
  _txDoc["dev_online"] = true;
  _txDoc["last_seen"] = 0;

  char buffer[96];
  const size_t written = serializeJson(_txDoc, buffer, sizeof(buffer));
  if (written > 0) {
    _server.sendTXT(num, buffer, written);
  }
}

void IoTBotLAN::sendPong(uint8_t num) {
  JsonDocument doc;
  doc["v"] = 1;
  doc["type"] = "pong";

  char buffer[32];
  const size_t written = serializeJson(doc, buffer, sizeof(buffer));
  if (written > 0) {
    _server.sendTXT(num, buffer, written);
  }
}

void IoTBotLAN::sendErr(uint8_t num, int code, const char *message) {
  JsonDocument doc;
  doc["v"] = 1;
  doc["type"] = "err";
  doc["code"] = code;
  doc["msg"] = message;

  char buffer[192];
  const size_t written = serializeJson(doc, buffer, sizeof(buffer));
  if (written > 0) {
    _server.sendTXT(num, buffer, written);
  }
}

bool IoTBotLAN::publish(
    const String &id,
    const String &text,
    bool hasMenu,
    const String &menu,
    bool edit) {
  if (edit) {
    iotbot::buildEdit(_txDoc, id, text, hasMenu, menu);
  } else {
    iotbot::buildMessage(_txDoc, id, text, hasMenu, menu);
  }

  if (measureJson(_txDoc) >= IOTBOT_TX_BUFFER_SIZE) {
    log("packet exceeds 1024 bytes: shorten text or button labels");
    return false;
  }

  const size_t written = iotbot::serializePacket(_txDoc, _txBuf, sizeof(_txBuf));
  if (written == 0) {
    return false;
  }

  if (_debug) {
    Serial.print(kLogPrefix);
    Serial.print("TX ");
    Serial.write(reinterpret_cast<const uint8_t *>(_txBuf), written);
    Serial.println();
  }

  return broadcast(_txBuf, written);
}

bool IoTBotLAN::broadcast(const char *payload, size_t length) {
  bool delivered = false;
  for (uint8_t i = 0; i < kMaxClients; ++i) {
    if (!_clients[i].authorized) {
      continue;
    }
    if (_server.sendTXT(i, payload, length)) {
      delivered = true;
    }
  }
  return delivered;
}

String IoTBotLAN::defaultHostname() const {
#ifdef ESP32
  const uint32_t chip = static_cast<uint32_t>(ESP.getEfuseMac());
#else
  const uint32_t chip = static_cast<uint32_t>(ESP.getChipId());
#endif
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "iotbot-%06x", static_cast<unsigned int>(chip & 0xFFFFFFu));
  return String(buffer);
}

void IoTBotLAN::log(const char *message) {
  if (!_debug) {
    return;
  }
  Serial.print(kLogPrefix);
  Serial.println(message);
}
