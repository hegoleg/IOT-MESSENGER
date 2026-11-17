# Деплой релея — «как в Telegram»

В Telegram клиенты сами подключаются наружу к серверам Telegram. Входящие
соединения к телефону или боту не нужны — поэтому всё работает из любой сети,
через CGNAT и мобильный интернет.

Наш релей (`server/`) устроен так же:

```text
ESP  --исходящее WSS-->  релей  <--исходящее WSS--  PWA
```

- Плата не требует публичного IP и проброса портов.
- Один релей обслуживает любое число устройств.
- Релей — один небольшой Node.js-процесс; хватит Raspberry Pi или VPS за
  несколько долларов.

Режим `IoTBotLAN` (сервер на самой ESP) — это отдельный сценарий для одной
Wi-Fi или полностью автономной работы. Для «как в Telegram» нужен релей.

## Вариант 1. Домашний ПК / Raspberry Pi + Cloudflare Tunnel

Бесплатно, без публичного IP и настройки роутера. Подходит для теста и
небольшого числа устройств.

1. Установите Node.js 20+ и склонируйте репозиторий:

   ```bash
   git clone https://github.com/hegoleg/IOT-MESSENGER.git
   cd IOT-MESSENGER
   npm ci
   npm run build
   ```

2. Создайте конфигурацию и задайте `ADMIN_KEY`:

   ```bash
   cp server/.env.example server/.env
   # откройте server/.env и впишите длинный случайный ADMIN_KEY
   ```

3. Запустите релей:

   ```bash
   npm start
   # проверка: curl http://localhost:8080/api/v1/health
   ```

   Для постоянной работы используйте systemd (вариант 2) или
   `pm2 start server/dist/index.js --name iot-relay`.

4. Установите [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
   и поднимите быстрый туннель:

   ```bash
   cloudflared tunnel --url http://localhost:8080
   ```

   В выводе будет адрес вида `https://random-words.trycloudflare.com`.
   Для WebSocket используйте его с `wss://`.

5. Укажите этот адрес:

   - в PWA — как адрес релея: `wss://random-words.trycloudflare.com`;
   - в прошивке (`secrets.h`):

     ```cpp
     #define SERVER_HOST "random-words.trycloudflare.com"
     #define SERVER_PORT 443
     #define SERVER_SECURE true
     ```

Проверка: `curl https://random-words.trycloudflare.com/api/v1/health`.

> [!warning] Быстрый туннель меняет адрес при каждом перезапуске.
> Для постоянного адреса нужен домен и именованный туннель — см.
> `deploy/cloudflared.yml.example` и
> [документацию Cloudflare](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

## Вариант 2. VPS + Caddy (HTTPS/WSS автоматически)

Нужен VPS с Ubuntu 22.04/24.04 и домен, например `relay.example.com`.

1. DNS: `A`-запись `relay.example.com` → IP сервера (для IPv6 — `AAAA`).

2. Установите Node.js 20+, Caddy и git:

   ```bash
   sudo apt update
   sudo apt install -y caddy git
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   ```

3. Скопируйте проект и соберите:

   ```bash
   sudo mkdir -p /opt/iot-messenger
   sudo chown "$USER" /opt/iot-messenger
   git clone https://github.com/hegoleg/IOT-MESSENGER.git /opt/iot-messenger
   cd /opt/iot-messenger
   npm ci
   npm run build
   cp server/.env.example server/.env
   # впишите ADMIN_KEY, при необходимости LOG_LEVEL
   mkdir -p server/data
   ```

4. Запустите релей через systemd:

   ```bash
   sudo cp deploy/iot-relay.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now iot-relay
   sudo systemctl status iot-relay
   ```

   В `deploy/iot-relay.service` пользователь — `iot`. Создайте его или
   замените `User=` на своего:

   ```bash
   sudo useradd --system --home /opt/iot-messenger --shell /usr/sbin/nologin iot
   sudo chown -R iot:iot /opt/iot-messenger
   ```

5. Настройте Caddy (WebSocket проксируется автоматически):

   ```bash
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
   sudo nano /etc/caddy/Caddyfile   # замените relay.example.com
   sudo systemctl reload caddy
   ```

6. Проверьте:

   ```bash
   curl https://relay.example.com/api/v1/health
   ```

7. В PWA и прошивке укажите `wss://relay.example.com` (порт 443,
   `SERVER_SECURE=true`).

## Вариант 3. Docker

```bash
cp server/.env.example server/.env   # задайте ADMIN_KEY
docker compose up -d --build
docker compose logs -f relay
```

Контейнер слушает `127.0.0.1:8080`; снаружи его закрывает Caddy или
Cloudflare Tunnel. База лежит в `server/data/iot.db`.

## Проверка релея

```bash
# health
curl https://relay.example.com/api/v1/health

# создать устройство (нужен ADMIN_KEY)
curl -X POST \
  -H "Authorization: Bearer $ADMIN_KEY" \
  https://relay.example.com/api/v1/devices/create

# метрики
curl -H "Authorization: Bearer $ADMIN_KEY" \
  https://relay.example.com/api/v1/metrics
```

WebSocket можно проверить `wscat`:

```bash
wscat -c "wss://relay.example.com/ws?role=usr&token=<token>"
# отправьте: {"v":1,"type":"ping"}
# ожидайте: {"v":1,"type":"pong"}
```

## Безопасность

- В продакшене — только `wss://`; порт 8080 держите за прокси, не открывайте
  напрямую в интернет.
- `ADMIN_KEY` — длинная случайная строка; без него админ-API отключён (`401`).
- Токен устройства — bearer-секрет: кто его знает, тот читает историю и
  управляет платой. Не публикуйте токены.
- Rate limit по умолчанию — 20 сообщений в минуту на соединение.
- CORS сейчас открыт (`origin: true`). Когда появится постоянный домен PWA,
  ограничьте его в `server/src/app.ts`.
- Резервная копия — файл `server/data/iot.db`:

  ```bash
  sqlite3 server/data/iot.db ".backup 'iot-backup.db'"
  ```

## Что выбрать

| Сценарий | Вариант |
| --- | --- |
| Быстро попробовать, нет публичного IP | Raspberry Pi + Cloudflare Tunnel |
| Постоянная работа, свой домен | VPS + Caddy |
| Уже есть Docker на сервере | Docker + Caddy/туннель |
| Одна Wi-Fi, без интернета | `IoTBotLAN`, релей не нужен |
