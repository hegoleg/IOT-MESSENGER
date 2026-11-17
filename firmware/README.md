# IoTBot (firmware)

C++ библиотека для ESP8266 / ESP32: лёгкий аналог Telegram-ботов с API, совместимым с [FastBot](https://github.com/GyverLibs/FastBot).
Реализует проводной протокол IoT-Messenger v1 (см. `PROTOCOL.md` в корне репозитория).

## Возможности

- `IoTBot bot("TOKEN")` — синтаксис как у FastBot, миграция сводится к замене `#include` и токена.
- `bot.tick()` — строго неблокирующий вызов в `loop()` (никаких `delay()` внутри библиотеки).
- Текстовые сообщения, инлайн-клавиатуры, редактирование сообщений (`edit: true`).
- Heartbeat: `ping` каждые 25 с, таймаут `pong` 5 с, переподключение через 3 с.
- Компактный синтаксис меню: `"Кнопка 1 \t Кнопка 2 \n Кнопка 3"` и пары `"Текст:data"`.
- Экономия памяти: ArduinoJson v7, статический TX-буфер 1024 байта, переиспользуемые JSON-документы.
- `IoTBotLAN` — тот же API, но без облака: ESP сама поднимает WebSocket-сервер на порту 81 и работает по LAN (`ws://IP:81`).

## Установка (PlatformIO)

```ini
lib_deps =
    symlink://path/to/firmware
    bblanchon/ArduinoJson@^7.0.0
    links2004/WebSockets@^2.4.0
```

Для Arduino IDE: скопируйте папку `firmware/` в `~/Arduino/libraries/IoTBot`.

## Быстрый старт

```cpp
#include <IoTBot.h>

IoTBot bot(BOT_TOKEN);

void onMessage(IB_msg &msg) {
  if (msg.isCallback) {
    // нажатие кнопки: msg.data содержит callback_data
    if (msg.data == "on") {
      digitalWrite(RELAY_PIN, HIGH);
      bot.editMessage(msg.id, "Полив включён");
    }
    return;
  }

  if (msg.text == "/start") {
    bot.sendInline(
      "Теплица онлайн:",
      "Полив вкл:on\tПолив выкл:off\nСтатус:status");
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  bot.setServer(SERVER_HOST, 443, true);  // true => wss://, false => ws://
  bot.attach(onMessage);
}

void loop() {
  bot.tick();   // неблокирующий цикл: WiFi, WebSocket, heartbeat
}
```

## LAN-режим (IoTBotLAN)

Если интернет или релей недоступны, плата сама становится сервером:
поднимает WebSocket на порту 81, проверяет `token` из query и общается теми
же JSON-пакетами. PWA подключается к `ws://<IP>:81/ws?token=<LAN_TOKEN>`.

```cpp
#include <IoTBotLAN.h>

IoTBotLAN bot(LAN_TOKEN);   // LAN_TOKEN — любая длинная случайная строка

void onMessage(IB_msg &msg) {
  if (msg.text == "/status") bot.sendMessage("OK");
}

void setup() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  bot.attach(onMessage);
  bot.enableMdns();         // необязательно: iotbot-xxxx.local
}

void loop() {
  bot.tick();               // неблокирующий
}
```

| Метод | Назначение |
| --- | --- |
| `void attach(handler)` | обработчик `void(IB_msg&)` |
| `void begin()` | запустить сервер сразу (иначе `tick()` сделает это после Wi-Fi) |
| `void tick()` | неблокирующий цикл: клиенты, mDNS, сообщения |
| `bool enableMdns(hostname = "")` | анонс `_iotbot._tcp`, по умолчанию `iotbot-<chip>.local` |
| `bool sendMessage / sendInline / editMessage` | те же методы, что у `IoTBot` |
| `bool isConnected()` | есть хотя бы один авторизованный клиент |
| `uint8_t clients()` | число клиентов |
| `String ip()`, `uint16_t port()` | адрес и порт сервера |

Порт по умолчанию — 81 (как в `PROTOCOL.md` §1.2). Входящие `msg`/`cb`
ограничены 30 в минуту на клиента (`IOTBOT_LAN_RATE_LIMIT_PER_MIN`).
Плата отправляет `status` при подключении и отвечает `pong` на `ping`.

Сборка и запуск примера:

```bash
cd examples/lan
cp include/secrets.h.example include/secrets.h   # Wi-Fi + LAN_TOKEN
pio run -e nodemcuv2 -e esp32dev
pio device monitor -b 115200                     # печатает ws://IP:81/ws?token=...
```

## Миграция с FastBot

| FastBot | IoTBot |
| --- | --- |
| `#include <FastBot.h>` | `#include <IoTBot.h>` |
| `FastBot bot(TOKEN);` | `IoTBot bot(TOKEN);` |
| `bot.attach(onMessage);` | `bot.attach(onMessage);` |
| `void onMessage(FB_msg &msg)` | `void onMessage(IB_msg &msg)` |
| `msg.text`, `msg.data`, `msg.isCallback`, `msg.id` | то же самое |
| `bot.tick();` | `bot.tick();` (неблокирующий) |
| `bot.sendMessage(text);` | `bot.sendMessage(text);` |
| `bot.sendInline(text, menu);` | `bot.sendInline(text, menu);` |
| `bot.editMessage(id, text);` | `bot.editMessage(id, text);` |

## Синтаксис меню

- `\n` разделяет ряды, `\t` — кнопки внутри ряда (максимум 3×3, лимит протокола).
- `"Текст"` — callback_data генерируется автоматически (`b0`, `b1`, ...).
- `"Текст:data"` — явная пара label/callback_data.

```cpp
bot.sendInline(
  "Выберите действие:",
  "Полив вкл:on\tПолив выкл:off\nДатчик:status\nПерезагрузить:reboot");
```

## API

| Метод | Назначение |
| --- | --- |
| `void setServer(host, port = 443, secure = true)` | адрес релея; `secure=false` — `ws://` для локальных тестов |
| `void attach(handler)` | обработчик `void(IB_msg&)` |
| `void setDebug(bool)` | логирование в `Serial` |
| `void tick()` | неблокирующий цикл (вызывать в `loop()`) |
| `bool sendMessage(text)` | отправить текстовое сообщение |
| `bool sendInline(text, menu)` | сообщение с инлайн-клавиатурой |
| `bool editMessage(id, text)` | обновить текст существующего сообщения |
| `bool editMessage(id, text, menu)` | обновить текст и кнопки |
| `bool isConnected()` | состояние WebSocket |

Методы отправки возвращают `false`, если соединение не установлено или итоговый JSON превысил 1024 байта (лимит протокола).

## Память и TLS

- Весь TX-буфер — 1024 байта (лимит пакета протокола), JSON-документы переиспользуются между вызовами, без `String`-конкатенации в цикле.
- `WSS` на ESP8266 использует BearSSL и требует ~16–20 КБ heap. Для отладки с локальным сервером используйте `setServer(host, port, false)` (`ws://`).
- `beginSSL` вызывается без fingerprint, поэтому TLS-сертификат сервера **не проверяется** (типично для hobby-IoT). Для продакшена используйте сервер с доверенным сертификатом и при необходимости замените транспорт на `beginSslWithCA`.

## Быстрая прошивка из браузера

`examples/quickstart` — отдельный скетч без `secrets.h`: Wi-Fi, токен и адрес
релея приходят по USB-серийному порту от сайта. Подходит для прошивки через
[ESP Web Tools](https://esphome.github.io/esp-web-tools/).

```bash
cd examples/quickstart
pio run -e nodemcuv2 -e esp32dev

# из корня репозитория: скопировать бинарники и собрать манифест
npm run firmware:export
```

Скрипт кладёт `esp8266.bin`, `esp32-merged.bin` и `manifest.json` в
`landing/public/firmware/`. ESP32 специально собирается в единый образ
(`esptool merge-bin`), потому что браузерный flasher не патчит flash-mode.

### Серийный протокол настройки

| Команда | Ответ |
| --- | --- |
| `IOTBOT:WHO` | `IOTBOT:HELLO:<chip>:v1:<setup\|configured>` |
| `IOTBOT:SCAN` | `IOTBOT:NETWORKS:["ssid1","ssid2"]` |
| `IOTBOT:SET:{...}` | `IOTBOT:OK`, сохранение в EEPROM и перезагрузка |
| `IOTBOT:RESET` | `IOTBOT:OK`, очистка настроек и перезагрузка |

`IOTBOT:SET` принимает JSON `{ssid, pass, token, host, port, secure}`.
Настройки хранятся в EEPROM (Wi-Fi-пароль в открытом виде — это локальная
память платы). Плата всегда слушает USB-команды, поэтому Wi-Fi и токен можно
перенастроить без перепрошивки.

## Пример

Полный рабочий скетч: [examples/greenhouse](examples/greenhouse) — управление реле, опрос датчика, инлайн-кнопки и «живые» обновления через `editMessage`.

LAN-вариант без релея: [examples/lan](examples/lan) — тот же сценарий на
`IoTBotLAN`, плата сама поднимает сервер на порту 81 и mDNS.

Сборка:

```bash
cd examples/greenhouse   # или examples/lan
pio run -e nodemcuv2 -e esp32dev
```
