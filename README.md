# IoT-Messenger

Самодостаточный мессенджер для микроконтроллеров ESP8266 и ESP32 — лёгкий
аналог Telegram-ботов без внешних API, VPN и подписок. Свой релей, инлайн-кнопки,
история сообщений, PWA-клиент и прошивка с настройкой прямо из браузера.

- **Протокол:** IoT-Messenger v1, плоский JSON, пакет до 1024 байт.
- **Платы:** ESP8266 (`espressif8266`) и ESP32 (`espressif32`).
- **Сервер:** Node.js 20+, Fastify 5, ws, better-sqlite3.
- **Клиент:** React 19, Vite, TypeScript, Tailwind CSS, PWA.
- **Сайт:** статический лендинг + прошивка через Web Serial.

## Архитектура

```
ESP8266 / ESP32                 Relay server                 PWA / телефон
┌────────────────┐   WSS   ┌──────────────────────┐   WSS   ┌──────────────┐
│ IoTBot (C++)   │ ◄─────► │ Fastify + ws + SQLite│ ◄─────► │ React PWA    │
│ датчики, реле  │         │ история 50 на токен  │         │ чат, кнопки  │
└────────────────┘         └──────────────────────┘         └──────────────┘
        │                            ▲
        │ USB (Web Serial)           │ HTTPS
        ▼                            │
┌────────────────────┐       ┌───────┴──────────┐
│ Прошивка из браузера│       │ Лендинг + мастер │
│ ESP Web Tools      │       │ прошивки/токена  │
└────────────────────┘       └──────────────────┘
```

LAN-режим (`ws://IP:81`) описан в протоколе, но серверная часть на ESP пока не
реализована.

## Структура репозитория

```
.
├── AGENTS.md          # правила проекта для людей и AI-агентов
├── PROTOCOL.md        # контракт JSON-протокола (source of truth)
├── README.md          # этот файл: запуск, деплой, передача проекта
├── shared/            # @iot/shared: типы, константы, валидация протокола
├── server/            # релей: Fastify, WebSocket, SQLite, REST
├── web-app/           # PWA-клиент
├── landing/           # промо-сайт + браузерная прошивка ESP
└── firmware/          # C++ библиотека IoTBot и примеры PlatformIO
```

## Быстрый старт

Нужны Node.js 20+ и npm. Для прошивки — PlatformIO.

```bash
npm install

# терминал 1: релей на :8080
npm run dev

# терминал 2: PWA на :5173
npm run dev:web

# сайт на :5174
npm run dev:landing
```

Откройте PWA, пройдите мастер настройки (адрес релея → проверка → создание
устройства) или отправьте токен из релея.

Без платы можно проверить весь сценарий симулятором:

```bash
npm run sim:esp -- --telemetry=5
```

Симулятор создаёт токен и отвечает как ESP: `/start`, `/on`, `/off`,
`/status`, `/stop`, инлайн-кнопки и телеметрия.

## Команды

| Команда | Что делает |
| --- | --- |
| `npm run dev` | релей с автоперезагрузкой (`server/`) |
| `npm run dev:web` | PWA в dev-режиме (`web-app/`) |
| `npm run dev:landing` | промо-сайт (`landing/`) |
| `npm run build` | сборка shared, server, web-app и landing |
| `npm test` | 30 юнит-тестов PWA + интеграционный тест симулятора ESP |
| `npm run test:esp` | только тест симулятора ESP |
| `npm run smoke` | HTTP/WS smoke-тест релея |
| `npm run sim:esp` | интерактивный симулятор платы |
| `npm run firmware:export` | бинарники прошивки → `landing/public/firmware/` |
| `npm run preview:landing` | предпросмотр собранного сайта |

Можно запускать команды внутри workspace:

```bash
npm run build --workspace @iot/server
npm run test  --workspace @iot/web-app
```

## Прошивка

Библиотека: `firmware/src/IoTBot.*`, API повторяет FastBot
(`IoTBot bot(TOKEN)`, `attach`, `tick`, `sendMessage`, `sendInline`,
`editMessage`).

Два примера:

- `firmware/examples/greenhouse` — реле, датчик, меню, настройки в
  `secrets.h`.
- `firmware/examples/quickstart` — прошивка без секретов для настройки из
  браузера: Wi-Fi, токен и релей приходят по USB-серийному порту.

```bash
cd firmware/examples/greenhouse
pio run -e nodemcuv2 -e esp32dev      # сборка
pio run -e nodemcuv2 -t upload        # прошивка (для ESP32: -e esp32dev)
```

Пересборка браузерных бинарников:

```bash
cd firmware/examples/quickstart
pio run -e nodemcuv2 -e esp32dev
cd ../../..
npm run firmware:export
```

Скрипт собирает единый ESP32-образ (`esptool merge-bin`) и обновляет
`landing/public/firmware/manifest.json`.

## Настройка и секреты

- `server/.env` — порт, путь к SQLite, rate limit, опциональный `ADMIN_KEY`
  (см. `server/.env.example`).
- `web-app/.env` — необязательный `VITE_SERVER_URL`. По умолчанию PWA
  использует свой домен, а на Vite-портах 5173/4173 — `ws://host:8080`.
- `firmware/examples/*/include/secrets.h` — Wi-Fi и токен для greenhouse.
  В quickstart секретов нет.
- **Никогда не коммитьте** `.env`, `secrets.h`, базы `*.db` и реальные токены.
  Они уже в `.gitignore`; в репозитории есть только `*.example`.

## Протокол

Единый источник правды — `PROTOCOL.md`. TypeScript-зеркало —
`shared/types.ts`; сервер и PWA импортируют типы из `@iot/shared`.

Правило: новое поле или изменение ключа сначала появляется в `PROTOCOL.md` и
`shared/types.ts`, затем в коде. Сервер не выполняет пользовательскую логику —
только маршрутизирует пакеты между `role=dev` и `role=usr`.

## Деплой

Рекомендуемая схема — один домен:

- `/` — `landing/dist` (промо + прошивка);
- `/app/` — `web-app/dist` (PWA);
- `/api/*` и `/ws` — Node-релей (`server/dist/index.js`, порт 8080).

Либо PWA на отдельном поддомене (`app.example.com`) — тогда укажите адрес в
`data-app-url` у ссылок `[data-app-link]` в `landing/index.html` или
пересоберите PWA с нужным `base`.

Важно: PWA собирается с `base=/`. Для размещения в подпапке `/app/`
пересоберите `web-app` с `--base=/app/` и поправьте `start_url`/`scope` в
манифесте, либо используйте отдельный поддомен — это проще и надёжнее.

Минимальный nginx:

```nginx
server {
  server_name relay.example.com;
  location /api/ { proxy_pass http://127.0.0.1:8080; }
  location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

PWA и Web Serial требуют HTTPS (или `localhost`). Домен, DNS, сертификаты и
хостинг в репозиторий не входят.

## Текущие ограничения

- Прошивка из браузера и USB-настройка реализованы, но **не проверены на
  реальной плате** в этом окружении.
- LAN-режим ESP (порт 81 + mDNS) есть в протоколе и клиенте, но не в прошивке.
- Web Push на релее — заглушка; подписки появятся вместе с push в PWA.
- Presence в списке устройств опрашивается раз в ~30 секунд; для больших
  списков лучше мультиплексировать presence на сервере.
- Создание устройств открыто, если не задан `ADMIN_KEY`; история защищена
  токеном.
- Лицензия проекта пока не выбрана (`library.json` указывает MIT для
  библиотеки). Перед публичным использованием стоит добавить `LICENSE`.

## Для AI-агентов и контрибьюторов

Порядок чтения:

1. `AGENTS.md` — правила проекта и границы модулей.
2. `README.md` — запуск, проверки, деплой (этот файл).
3. `PROTOCOL.md` + `shared/types.ts` — контракт.

Правила:

- не добавляйте поля протокола без обновления `PROTOCOL.md` и `shared/types.ts`;
- не коммитьте секреты;
- в библиотеке прошивки нет `delay()` и блокирующих вызовов;
- пакет ≤1024 байт, текст ≤512, клавиатура ≤3×3;
- после изменений запускайте `npm run build` и `npm test`, для прошивки —
  `pio run -e nodemcuv2 -e esp32dev`;
- не ломайте same-origin-дефолт PWA: в production она должна ходить на свой
  домен, а не на `localhost`.

Если задача касается только сайта — работайте в `landing/`, не меняя
протокол и сервер. Если прошивки — `firmware/`, не трогая PWA. Это снижает
конфликты при параллельной работе.

## Передача проекта другу или команде

Дайте доступ к репозиторию (collaborator с write или fork + PR). Агенту
достаточно открыть репозиторий и прочитать `README.md` и `AGENTS.md` — код,
команды и ограничения описаны здесь.

Отдельно, не в репозитории, передайте:

- домен и хостинг, куда деплоить;
- адрес релея (`wss://…`) и, если используется, `ADMIN_KEY` — через
  менеджер паролей;
- модели плат и кабелей, статус проверки на железе;
- доступ к GitHub (и к хостингу, если деплой делает друг).

Агент не угадает пароли, DNS и состояние железа — это единственное, что
нужно передать словами. Всё остальное уже в коде и документации.
