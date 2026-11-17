# IoT-Messenger relay server

Node.js 20+ / TypeScript / Fastify / ws / better-sqlite3.

- WebSocket relay: `/ws?role=dev|usr&token=...`
- History: `GET /api/v1/history?token=...&limit=50`
- Device tokens: `POST /api/v1/devices/create`
- Reachability probe: `GET /api/v1/health`
- HTTP fallback: `POST /api/v1/msg` with `Authorization: Bearer <token>`

Contract: `../PROTOCOL.md` и `../shared/types.ts`.

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

## Проверка

```bash
npm run smoke   # HTTP/WS smoke-тест релея
npm test        # интеграционный тест: симулятор ESP <-> релей <-> клиент usr
```
