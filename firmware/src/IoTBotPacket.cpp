#include "IoTBotPacket.h"

namespace iotbot {

namespace {

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

String nextMessageId(uint32_t &seq) {
  char buffer[20];
  snprintf(buffer, sizeof(buffer), "m_%lu", static_cast<unsigned long>(++seq));
  return String(buffer);
}

void buildKeyboard(const String &menu, JsonDocument &doc) {
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

void buildMessage(
    JsonDocument &doc,
    const String &id,
    const String &text,
    bool hasMenu,
    const String &menu) {
  doc.clear();
  doc["v"] = 1;
  doc["type"] = "msg";
  doc["id"] = id;
  doc["from"] = "dev";
  doc["ts"] = 0;  // the receiver fills in the current time (PROTOCOL.md §2.1)
  doc["text"] = truncateUtf8(text, IOTBOT_MAX_TEXT_BYTES);
  if (hasMenu) {
    buildKeyboard(menu, doc);
  }
}

void buildEdit(
    JsonDocument &doc,
    const String &id,
    const String &text,
    bool hasMenu,
    const String &menu) {
  doc.clear();
  doc["v"] = 1;
  doc["type"] = "msg";
  doc["id"] = id;
  doc["from"] = "dev";
  doc["ts"] = 0;
  doc["edit"] = true;
  doc["text"] = truncateUtf8(text, IOTBOT_MAX_TEXT_BYTES);
  if (hasMenu) {
    buildKeyboard(menu, doc);
  }
}

void buildPing(JsonDocument &doc) {
  doc.clear();
  doc["v"] = 1;
  doc["type"] = "ping";
}

size_t serializePacket(JsonDocument &doc, char *buffer, size_t bufferSize) {
  const size_t needed = measureJson(doc);
  if (needed == 0 || needed >= bufferSize) {
    return 0;
  }

  const size_t written = serializeJson(doc, buffer, bufferSize);
  return written == needed ? written : 0;
}

}  // namespace iotbot
