#pragma once

/**
 * Compile-time limits and timings of the IoT-Messenger protocol v1.
 * Override any macro with -D... if you know what you are doing.
 */

/** Whole JSON packet limit (PROTOCOL.md §2). */
#ifndef IOTBOT_TX_BUFFER_SIZE
#define IOTBOT_TX_BUFFER_SIZE 1024
#endif

/** Maximum `text` field size in bytes, UTF-8 (PROTOCOL.md §2.1). */
#ifndef IOTBOT_MAX_TEXT_BYTES
#define IOTBOT_MAX_TEXT_BYTES 512
#endif

/** Inline keyboard limits (PROTOCOL.md §2.1). */
#ifndef IOTBOT_MAX_KB_ROWS
#define IOTBOT_MAX_KB_ROWS 3
#endif
#ifndef IOTBOT_MAX_KB_COLS
#define IOTBOT_MAX_KB_COLS 3
#endif

/** Heartbeat timings (PROTOCOL.md §2.4). */
#ifndef IOTBOT_PING_INTERVAL_MS
#define IOTBOT_PING_INTERVAL_MS 25000UL
#endif
#ifndef IOTBOT_PONG_TIMEOUT_MS
#define IOTBOT_PONG_TIMEOUT_MS 5000UL
#endif
#ifndef IOTBOT_RECONNECT_DELAY_MS
#define IOTBOT_RECONNECT_DELAY_MS 3000UL
#endif

/** LAN mode: inbound msg/cb packets per client per minute (IoTBotLAN). */
#ifndef IOTBOT_LAN_RATE_LIMIT_PER_MIN
#define IOTBOT_LAN_RATE_LIMIT_PER_MIN 30
#endif
