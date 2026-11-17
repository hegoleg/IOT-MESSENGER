#pragma once

#include <Arduino.h>

/**
 * Incoming event delivered to the bot.attach() handler.
 * Field names match FastBot's FB_msg so migration is a drop-in change.
 */
struct IB_msg {
  /** Message text or command ("/start", ...). Empty for button presses. */
  String text;
  /** callback_data of the pressed inline button (only for callbacks). */
  String data;
  /** Id of the source message. */
  String id;
  /** true when the user pressed an inline button (packet type "cb"). */
  bool isCallback = false;
};

/** Handler signature for bot.attach(): receives incoming messages and callbacks. */
typedef void (*IB_callback)(IB_msg &msg);
