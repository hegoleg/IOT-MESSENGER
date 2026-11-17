/*
 * IoT-Messenger quickstart firmware.
 *
 * Intended for flashing from the promo site. No Wi-Fi or token is compiled in:
 * the browser sends the configuration over USB serial:
 *
 *   IOTBOT:WHO            -> IOTBOT:HELLO:<chip>:v1:<setup|configured>
 *   IOTBOT:SCAN           -> IOTBOT:NETWORKS:["ssid1","ssid2"]
 *   IOTBOT:SET:{json}     -> IOTBOT:OK  (saves to EEPROM and reboots)
 *   IOTBOT:RESET          -> IOTBOT:OK  (clears settings and reboots)
 *
 * JSON fields: ssid, pass, token, host, port, secure.
 */

#include <Arduino.h>
#ifdef ESP32
#include <WiFi.h>
#else
#include <ESP8266WiFi.h>
#endif
#include <EEPROM.h>
#include <ArduinoJson.h>
#include <IoTBot.h>

namespace {

constexpr uint32_t CONFIG_MAGIC = 0x49425431;  // "IBT1"
constexpr uint16_t CONFIG_VERSION = 1;
constexpr int EEPROM_SIZE = 512;
constexpr size_t SERIAL_LINE_MAX = 512;

struct PersistedConfig {
  uint32_t magic;
  uint16_t version;
  char ssid[33];
  char password[65];
  char token[65];
  char host[65];
  uint16_t port;
  uint8_t secure;
  uint8_t reserved;
};

PersistedConfig stored{};
bool configured = false;
IoTBot *bot = nullptr;
String serialLine;
bool relayOn = false;

#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif
const uint8_t RELAY_PIN = LED_BUILTIN;
#ifdef ESP32
const uint8_t SENSOR_PIN = 34;
const int SENSOR_MAX = 4095;
#else
const uint8_t SENSOR_PIN = A0;
const int SENSOR_MAX = 1023;
#endif

const char *chipName() {
#if defined(ESP8266)
  return "ESP8266";
#elif defined(ESP32)
  return "ESP32";
#else
  return "unknown";
#endif
}

void copyText(char *destination, size_t size, const char *source) {
  if (!source) {
    destination[0] = '\0';
    return;
  }
  size_t length = strlen(source);
  if (length >= size) length = size - 1;
  memcpy(destination, source, length);
  destination[length] = '\0';
}

void emit(const char *message) {
  Serial.print(message);
  Serial.println();
}

void setRelay(bool on) {
  relayOn = on;
  digitalWrite(RELAY_PIN, on ? HIGH : LOW);
}

String sensorText() {
  const int raw = analogRead(SENSOR_PIN);
  const int percent = static_cast<int>(map(raw, 0, SENSOR_MAX, 0, 100));
  String text = "Освещённость: ";
  text += percent;
  text += "%\nПолив: ";
  text += relayOn ? "включён" : "выключен";
  return text;
}

/* --------------------------------------------------------------------- */
/* EEPROM settings                                                       */
/* --------------------------------------------------------------------- */

bool loadConfig() {
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.get(0, stored);
  configured = stored.magic == CONFIG_MAGIC &&
               stored.version == CONFIG_VERSION &&
               stored.ssid[0] != '\0' &&
               stored.host[0] != '\0' &&
               stored.token[0] != '\0';
  return configured;
}

void persistConfig() {
  stored.magic = CONFIG_MAGIC;
  stored.version = CONFIG_VERSION;
  stored.reserved = 0;
  EEPROM.put(0, stored);
  EEPROM.commit();
}

void clearConfig() {
  stored.magic = 0;
  EEPROM.put(0, stored);
  EEPROM.commit();
}

/* --------------------------------------------------------------------- */
/* USB serial provisioning                                               */
/* --------------------------------------------------------------------- */

void sendNetworks() {
  const int found = WiFi.scanNetworks();
  if (found < 0) {
    emit("IOTBOT:ERR:scan");
    return;
  }

  JsonDocument document;
  JsonArray networks = document.to<JsonArray>();

  for (int index = 0; index < found; ++index) {
    const String ssid = WiFi.SSID(index);
    if (ssid.length() == 0) continue;

    bool duplicate = false;
    for (JsonVariant value : networks) {
      if (value.as<String>() == ssid) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) networks.add(ssid);
  }

  Serial.print("IOTBOT:NETWORKS:");
  serializeJson(document, Serial);
  Serial.println();
  WiFi.scanDelete();
}

void handleSet(const String &payload) {
  JsonDocument document;
  const DeserializationError error = deserializeJson(document, payload);
  if (error) {
    emit("IOTBOT:ERR:json");
    return;
  }

  const char *ssid = document["ssid"] | "";
  const char *password = document["pass"] | "";
  const char *token = document["token"] | "";
  const char *host = document["host"] | "";
  const uint16_t port = document["port"] | 8080;
  const bool secure = document["secure"] | false;

  if (ssid[0] == '\0' || host[0] == '\0' || strlen(token) < 16) {
    emit("IOTBOT:ERR:fields");
    return;
  }

  memset(&stored, 0, sizeof(stored));
  stored.magic = CONFIG_MAGIC;
  stored.version = CONFIG_VERSION;
  copyText(stored.ssid, sizeof(stored.ssid), ssid);
  copyText(stored.password, sizeof(stored.password), password);
  copyText(stored.token, sizeof(stored.token), token);
  copyText(stored.host, sizeof(stored.host), host);
  stored.port = port;
  stored.secure = secure ? 1 : 0;

  persistConfig();
  emit("IOTBOT:OK");
  delay(250);
  ESP.restart();
}

void handleCommand(const String &line) {
  if (line.startsWith("IOTBOT:WHO")) {
    Serial.print("IOTBOT:HELLO:");
    Serial.print(chipName());
    Serial.print(":v1:");
    Serial.println(configured ? "configured" : "setup");
    return;
  }

  if (line.startsWith("IOTBOT:SCAN")) {
    sendNetworks();
    return;
  }

  if (line.startsWith("IOTBOT:RESET")) {
    clearConfig();
    emit("IOTBOT:OK");
    delay(250);
    ESP.restart();
    return;
  }

  if (line.startsWith("IOTBOT:SET:")) {
    handleSet(line.substring(strlen("IOTBOT:SET:")));
    return;
  }
}

void pollSerial() {
  while (Serial.available() > 0) {
    const char character = static_cast<char>(Serial.read());
    if (character == '\n' || character == '\r') {
      if (serialLine.length() > 0) {
        handleCommand(serialLine);
        serialLine = "";
      }
    } else if (serialLine.length() < SERIAL_LINE_MAX) {
      serialLine += character;
    }
  }
}

/* --------------------------------------------------------------------- */
/* Bot                                                                   */
/* --------------------------------------------------------------------- */

void onMessage(IB_msg &msg) {
  if (bot == nullptr) return;

  if (msg.isCallback) {
    if (msg.data == "pump_on") {
      setRelay(true);
      bot->editMessage(msg.id, "Полив включён");
    } else if (msg.data == "pump_off") {
      setRelay(false);
      bot->editMessage(msg.id, "Полив выключен");
    } else if (msg.data == "status") {
      bot->editMessage(msg.id, sensorText());
    } else if (msg.data == "reboot") {
      bot->sendMessage("Перезагружаюсь...");
      delay(200);
      ESP.restart();
    }
    return;
  }

  String command = msg.text;
  command.trim();

  if (command == "/start") {
    bot->sendInline(
        "Теплица онлайн. Выберите действие:",
        "Полив вкл:on\tПолив выкл:off\nДатчик:status\nПерезагрузка:reboot");
  } else if (command == "/on") {
    setRelay(true);
    bot->sendMessage("Полив включён");
  } else if (command == "/off") {
    setRelay(false);
    bot->sendMessage("Полив выключен");
  } else if (command == "/status") {
    bot->sendMessage(sensorText());
  } else {
    bot->sendMessage("Команды: /start, /on, /off, /status");
  }
}

void startBot() {
  bot = new IoTBot(String(stored.token));
  if (bot == nullptr) {
    emit("IOTBOT:ERR:memory");
    return;
  }

  bot->setServer(String(stored.host), stored.port, stored.secure != 0);
  bot->attach(onMessage);

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(stored.ssid, stored.password);

  Serial.print("IOTBOT:WIFI:");
  Serial.println(stored.ssid);
}

}  // namespace

void setup() {
#if defined(ESP8266) || defined(ESP32)
  Serial.setRxBufferSize(1024);
#endif
  Serial.begin(115200);
  serialLine.reserve(SERIAL_LINE_MAX);

  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);

  loadConfig();

  Serial.print("IOTBOT:BOOT:");
  Serial.println(chipName());
  Serial.println(configured ? "IOTBOT:CONFIGURED" : "IOTBOT:SETUP");
  Serial.println("IOTBOT:READY");

  if (configured) startBot();
}

void loop() {
  pollSerial();

  if (configured && bot != nullptr) {
    bot->tick();
  }
}
