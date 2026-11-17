# IoT-Messenger relay server

Node.js 20+ / TypeScript / Fastify / ws / better-sqlite3.

- WebSocket relay: `/ws?role=dev|usr&token=...`
- History: `GET /api/v1/history?token=...&limit=50`
- Device tokens: `POST /api/v1/devices/create`
- Reachability probe: `GET /api/v1/health`
- HTTP fallback: `POST /api/v1/msg` with `Authorization: Bearer <token>`
- Admin API (requires `ADMIN_KEY`):
  - `GET /api/v1/devices` — devices with `online` and `last_seen`
  - `DELETE /api/v1/devices/:token` — remove a device, its history and live sockets
  - `GET /api/v1/metrics` — uptime, connections and message/error counters

Contract: `../PROTOCOL.md` и `../shared/types.ts`.

Deployment (Telegram-like relay: Cloudflare Tunnel, VPS + Caddy, Docker):
[`DEPLOY.md`](DEPLOY.md).

## Запуск

```bash
cp .env.example .env
npm run dev          # tsx watch, по умолчанию :8080
npm run build && npm start
```

## Симулятор ESP8266/ESP32

Скрипт говорит на том же JSON-протоколе, что и прошивка: heartbeat, инлайн-меню,
callback-кнопки, редактирование сообщений и телеметрия. Токен создаётся сам.

```bash
# из корня репозитория
npm run sim:esp -- --telemetry=5

# или из server/
npm run sim -- --server=wss://relay.example --token=<token>
npm run sim -- --help
```

Дальше добавьте напечатанный токен в PWA и отправьте `/start`, `/on`, `/off`,
`/status`, `/stop` или нажимайте инлайн-кнопки.

## Симулятор LAN-сервера (IoTBotLAN)

Виртуальная ESP с собственным WebSocket-сервером на порту 81. Проверяет
LAN-режим PWA без платы и без релея: токен из query, `err` 401, `status`,
`ping`/`pong`, инлайн-меню и живые обновления.

```bash
# из корня репозитория
npm run sim:lan -- --telemetry=5 --port=81
npm run dev:web:lan

# или из server/
npm run lan -- --help
```

Скрипт печатает токен и адрес. В PWA выберите режим «Локально» и укажите хост
компьютера — порт 81 добавится автоматически. С телефона откройте
`http://<IP-ПК>:5173` (именно http: с HTTPS-страницы браузер блокирует
`ws://`). Подсказка также доступна по `http://<IP>:81/`.

## Проверка

```bash
npm run smoke   # HTTP/WS smoke-тест релея
npm test        # интеграционные тесты: симулятор ESP, админ-API, метрики, история
```

Когда `ADMIN_KEY` задан в `.env`, создание устройств и весь админ-API требуют
`Authorization: Bearer <ADMIN_KEY>`. Без `ADMIN_KEY` админ-API отвечает `401`,
а `POST /api/v1/devices/create` работает без авторизации — так удобно для
локальной разработки, но не для публичного сервера.

```bash
# список устройств
curl -H "Authorization: Bearer $ADMIN_KEY" http://localhost:8080/api/v1/devices

# метрики
curl -H "Authorization: Bearer $ADMIN_KEY" http://localhost:8080/api/v1/metrics

# удалить устройство вместе с историей
curl -X DELETE -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:8080/api/v1/devices/<token>
```
