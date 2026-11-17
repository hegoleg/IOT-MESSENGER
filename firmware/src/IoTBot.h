#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>

#include "IB_msg.h"
#include "IoTBotConfig.h"

/** Handler signature for bot.attach(): receives incoming messages and callbacks. */
typedef void (*IB_callback)(IB_msg &msg);

/**
 * IoTBot — FastBot-compatible client for the IoT-Messenger relay
 * (PROTOCOL.md, wire protocol v1).
 *
 * Minimal usage:
 *
 *   IoTBot bot(DEVICE_TOKEN);
 *
 *   void onMessage(IB_msg &msg) {
 *     if (!msg.isCallback && msg.text == "/start") bot.sendMessage("Hi!");
 *   }
 *
 *   void setup() {
 *     bot.setServer("relay.example.com", 443, true);
 *     bot.attach(onMessage);
 *   }
 *
 *   void loop() {
 *     bot.tick();  // non-blocking
 *   }
 */
class IoTBot {
 public:
  explicit IoTBot(const String &token);

  /**
   * Relay endpoint. secure=true uses wss:// (default), secure=false uses
   * ws:// which is handy for a relay running on the local network.
   */
  void setServer(const String &host, uint16_t port = 443, bool secure = true);

  /** Registers the message/callback handler (call once in setup()). */
  void attach(IB_callback handler);

  /** Enables Serial debug logging. */
  void setDebug(bool enabled);

  /** Non-blocking pump: WiFi, WebSocket, heartbeat. Call from loop(). */
  void tick();

  /** Sends a text message from the device ("from": "dev"). */
  bool sendMessage(const String &text);

  /** Sends a text message with an inline keyboard parsed from `menu`. */
  bool sendInline(const String &text, const String &menu);

  /** Updates text of an existing message with the same id (edit: true). */
  bool editMessage(const String &id, const String &text);

  /** Updates text and inline keyboard of an existing message. */
  bool editMessage(const String &id, const String &text, const String &menu);

  /** True while the relay WebSocket is connected and the heartbeat is alive. */
  bool isConnected() const;

 private:
  String _token;
  String _host;
  uint16_t _port;
  bool _secure;
  bool _serverSet;
  bool _transportStarted;
  bool _connected;
  bool _debug;
  IB_callback _handler;

  WebSocketsClient _ws;
  JsonDocument _rxDoc;
  JsonDocument _txDoc;
  char _txBuf[IOTBOT_TX_BUFFER_SIZE];

  uint32_t _msgSeq;
  unsigned long _lastPing;
  unsigned long _pingSentAt;

  void startTransport();
  void handleEvent(WStype_t type, uint8_t *payload, size_t length);
  void handlePacket(uint8_t *payload, size_t length);
  void sendPing();

  String nextMessageId();
  bool publish(const String &id, const String &text, bool hasMenu, const String &menu, bool edit);
  void buildKeyboard(const String &menu, JsonDocument &doc);
  bool sendPacket(JsonDocument &doc);
  void log(const char *message);
};
