/*
 * IoTBot LAN example: the ESP is the server, no relay or internet required.
 *
 * - /start            shows the inline menu
 * - buttons           toggle the relay, start live sensor updates
 * - /on /off /status  text commands
 * - /stop             stops live sensor updates
 *
 * The PWA connects to ws://<DEVICE_IP>:81/ws?token=<LAN_TOKEN>.
 * Copy include/secrets.h.example to include/secrets.h and fill it in.
 * The sketch is non-blocking: the LAN server is driven by tick().
 */

#include <Arduino.h>
#ifdef ESP32
#include <WiFi.h>
#else
#include <ESP8266WiFi.h>
#endif
#include <IoTBotLAN.h>

#if __has_include("secrets.h")
#include "secrets.h"
#else
#warning "include/secrets.h is missing: copy include/secrets.h.example and fill it in"
#define WIFI_SSID "your-wifi"
#define WIFI_PASS "your-password"
#define LAN_TOKEN "REPLACE_WITH_LONG_RANDOM_STRING"
#define LAN_HOSTNAME ""
#endif

#ifdef ESP32
static const uint8_t SENSOR_PIN = 34;
static const int SENSOR_MAX = 4095;
#else
static const uint8_t SENSOR_PIN = A0;
static const int SENSOR_MAX = 1023;
#endif

#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif
static const uint8_t RELAY_PIN = LED_BUILTIN;

static const unsigned long SENSOR_POLL_INTERVAL_MS = 5000;

IoTBotLAN bot(LAN_TOKEN);

bool relayOn = false;
bool liveMode = false;
String liveMessageId;
unsigned long lastSensorPoll = 0;
bool lanAnnounced = false;

/** Human-readable sensor state, used for both fresh messages and edits. */
String sensorText() {
  const int raw = analogRead(SENSOR_PIN);
  const int percent = static_cast<int>(map(raw, 0, SENSOR_MAX, 0, 100));

  String text = "Освещённость: ";
  text += percent;
  text += "%\nПолив: ";
  text += relayOn ? "включён" : "выключен";
  return text;
}

void setRelay(bool on) {
  relayOn = on;
  digitalWrite(RELAY_PIN, on ? HIGH : LOW);
}

void handleMessage(IB_msg &msg) {
  if (msg.isCallback) {
    if (msg.data == "on") {
      setRelay(true);
      bot.editMessage(msg.id, "Полив включён 💧");
    } else if (msg.data == "off") {
      setRelay(false);
      bot.editMessage(msg.id, "Полив выключен ⛔");
    } else if (msg.data == "status") {
      // Edit the message that owns the button — the protocol's live-dashboard pattern.
      liveMessageId = msg.id;
      liveMode = true;
      bot.editMessage(msg.id, sensorText());
    }
    return;
  }

  String command = msg.text;
  command.trim();

  if (command == "/start") {
    bot.sendInline(
        "Теплица онлайн (LAN). Выберите действие:",
        "Полив вкл:on\tПолив выкл:off\nДатчик:status");
  } else if (command == "/on") {
    setRelay(true);
    bot.sendMessage("Полив включён 💧");
  } else if (command == "/off") {
    setRelay(false);
    bot.sendMessage("Полив выключен ⛔");
  } else if (command == "/status") {
    bot.sendMessage(sensorText());
  } else if (command == "/stop") {
    liveMode = false;
    bot.sendMessage("Живые обновления остановлены.");
  } else {
    bot.sendMessage("Неизвестная команда. Доступно: /start, /on, /off, /status, /stop");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  bot.attach(handleMessage);
  bot.setDebug(true);
}

void loop() {
  bot.tick();

  if (!lanAnnounced && WiFi.status() == WL_CONNECTED) {
    lanAnnounced = true;
    bot.enableMdns(LAN_HOSTNAME);
    Serial.print("[IoTBotLAN] open ws://");
    Serial.print(bot.ip());
    Serial.println(":81/ws?token=<LAN_TOKEN> in the PWA");
  }

  if (liveMode && bot.isConnected() && (millis() - lastSensorPoll >= SENSOR_POLL_INTERVAL_MS)) {
    lastSensorPoll = millis();
    bot.editMessage(liveMessageId, sensorText());
  }
}
