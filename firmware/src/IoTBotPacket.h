#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "IoTBotConfig.h"

/**
 * Packet builders shared by the cloud client (IoTBot) and the LAN server
 * (IoTBotLAN). Keeping them in one place guarantees both transports emit
 * byte-identical protocol v1 packets (PROTOCOL.md §2).
 */
namespace iotbot {

/** Truncates a UTF-8 string to at most `maxBytes` bytes without splitting a character. */
String truncateUtf8(const String &value, size_t maxBytes);

/** Sequence-based message id: m_1, m_2, ... */
String nextMessageId(uint32_t &seq);

/** Parses "Label \t Label:data \n ..." into the "kb" field of `doc`. */
void buildKeyboard(const String &menu, JsonDocument &doc);

/** Builds a complete outgoing "msg" packet. */
void buildMessage(
    JsonDocument &doc,
    const String &id,
    const String &text,
    bool hasMenu,
    const String &menu);

/** Builds an edit of an existing message (same id, "edit": true). */
void buildEdit(
    JsonDocument &doc,
    const String &id,
    const String &text,
    bool hasMenu,
    const String &menu);

/** Builds a heartbeat "ping" packet. */
void buildPing(JsonDocument &doc);

/**
 * Serializes `doc` into `buffer`. Returns the byte count, or 0 when the
 * packet is empty or does not fit into the 1024-byte limit.
 */
size_t serializePacket(JsonDocument &doc, char *buffer, size_t bufferSize);

}  // namespace iotbot
