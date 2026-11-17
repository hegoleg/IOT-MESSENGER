#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebSocketsServer.h>

#include "IB_msg.h"
#include "IoTBotConfig.h"

/**
 * IoTBotLAN — the same messaging API as IoTBot, but the ESP is the server.
 *
 * The board runs a WebSocket server on port 81; the PWA connects directly to
 * ws://<DEVICE_IP>:81/ws?token=<DEVICE_TOKEN> using the same JSON packets as
 * the cloud relay (PROTOCOL.md §1.2). No internet or relay is required.
 *
 *   IoTBotLAN bot(LAN_TOKEN);
 *
 *   void onMessage(IB_msg &msg) { ... }
 *
 *   void setup() {
 *     WiFi.begin(SSID, PASS);
 *     bot.attach(onMessage);
 *     bot.enableMdns();   // optional: iotbot-xxxx.local
 *   }
 *
 *   void loop() {
 *     bot.tick();         // non-blocking
 *   }
 */
class IoTBotLAN {
 public:
  explicit IoTBotLAN(const String &token, uint16_t port = 81);

  /** Registers the message/callback handler (call once in setup()). */
  void attach(IB_callback handler);

  /** Enables Serial debug logging. */
  void setDebug(bool enabled);

  /** Starts the WebSocket server now instead of lazily from tick(). */
  void begin();

  /** Non-blocking pump: serves clients and the local message loop. */
  void tick();

  /** Sends a text message from the device ("from": "dev") to all clients. */
  bool sendMessage(const String &text);

  /** Sends a text message with an inline keyboard parsed from `menu`. */
  bool sendInline(const String &text, const String &menu);

  /** Updates text of an existing message with the same id (edit: true). */
  bool editMessage(const String &id, const String &text);

  /** Updates text and inline keyboard of an existing message. */
  bool editMessage(const String &id, const String &text, const String &menu);

  /** True while at least one authorized client is connected. */
  bool isConnected() const;

  /** Number of authorized clients. */
  uint8_t clients() const;

  /** Local IP as text (0.0.0.0 before the Wi-Fi link is up). */
  String ip() const;

  uint16_t port() const { return _port; }

  /**
   * Advertises the board as `_iotbot._tcp` via mDNS so the PWA can find it.
   * Call after Wi-Fi is connected. Returns false if mDNS failed to start.
   */
  bool enableMdns(const String &hostname = String());

  bool mdnsEnabled() const { return _mdns; }

 private:
  struct ClientState {
    bool authorized;
    uint32_t windowStart;
    uint16_t count;
  };

  enum { kMaxClients = 8 };

  String _token;
  uint16_t _port;
  bool _debug;
  bool _begun;
  bool _mdns;
  IB_callback _handler;
  WebSocketsServer _server;
  JsonDocument _rxDoc;
  JsonDocument _txDoc;
  char _txBuf[IOTBOT_TX_BUFFER_SIZE];
  uint32_t _msgSeq;
  ClientState _clients[kMaxClients];

  void handleEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length);
  void handlePacket(uint8_t num, uint8_t *payload, size_t length);
  bool authorize(uint8_t num, const String &url);
  bool allowPacket(uint8_t num);
  void resetClient(uint8_t num);
  void sendStatus(uint8_t num);
  void sendPong(uint8_t num);
  void sendErr(uint8_t num, int code, const char *message);
  bool publish(const String &id, const String &text, bool hasMenu, const String &menu, bool edit);
  bool broadcast(const char *payload, size_t length);
  String defaultHostname() const;
  void log(const char *message);
};
