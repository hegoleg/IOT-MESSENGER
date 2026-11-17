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

## Работа с двух ПК

### Код: GitHub (рекомендуется)

На первом ПК репозиторий уже связан с GitHub (`origin`). На втором:

```bash
git clone https://github.com/hegoleg/IOT-MESSENGER.git iot-project
cd iot-project
npm install
npm run build
npm test
```

Рабочий цикл на обоих ПК:

```bash
git pull --rebase
# ... изменения ...
git add -A
git commit -m "что изменено"
git push
```

Для параллельной работы над разными частями создавайте ветки
(`git switch -c feature/site`) и сливайте через pull request — так проще
избежать конфликтов. Перед пушем всегда делайте `git pull --rebase`.

Секреты в Git не попадают. На каждом ПК создайте свои:

```bash
cp server/.env.example server/.env
cp web-app/.env.example web-app/.env          # необязательно
cp firmware/examples/greenhouse/include/secrets.h.example \
   firmware/examples/greenhouse/include/secrets.h
```

Файлы `.env` и `secrets.h` переносите вручную или через менеджер паролей.

### Код: локальный Git без интернета

Если GitHub недоступен, сделайте bare-репозиторий на общем диске/папке.

На ПК №1:

```powershell
# папку C:\iot-sync расшарьте по сети с правом записи
git init --bare C:\iot-sync\IOT-MESSENGER.git
cd D:\iot-project
git remote add lan C:\iot-sync\IOT-MESSENGER.git
git push lan main
```

На ПК №2:

```powershell
git clone \\PC1\iot-sync\IOT-MESSENGER.git iot-project
cd iot-project
npm install
```

Если Git не понимает UNC-путь, подключите сетевую папку как диск:

```powershell
net use Z: \\PC1\iot-sync /persistent:yes
git clone Z:\IOT-MESSENGER.git iot-project
```

Дальше — обычные `git pull lan main` и `git push lan main`. Это тот же Git,
только вместо GitHub — папка в локальной сети. Не открывайте один и тот же
рабочий каталог на двух ПК одновременно.

### Что не синхронизировать

Не кладите в Git, OneDrive, Dropbox или Syncthing рабочие каталоги целиком:

- `.env`, `secrets.h` — только вручную/менеджер паролей;
- `node_modules` — на каждом ПК `npm install`;
- `.pio`, `dist` — пересобираются;
- SQLite-базу `server/data/*.db` — она живёт на одном релее.

OneDrive/Syncthing на живой папке с `.git` и `node_modules` приводят к
конфликтам и битым индексам. Для кода используйте Git, для секретов —
менеджер паролей.

### Один релей на двоих

Чтобы видеть общую историю и устройства, релей должен быть один:

```
ПК №1: npm run dev            → http://192.168.1.10:8080
ПК №2: PWA → релей ws://192.168.1.10:8080
телефон → тот же адрес
```

- IP ПК №1 смотрите через `ipconfig` (IPv4), порт 8080 должен быть открыт в
  брандмауэре:

  ```powershell
  # PowerShell от имени администратора
  New-NetFirewallRule -DisplayName "IoT-Messenger relay" `
    -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
  ```

- В PWA адрес меняется в настройках (шестерёнка) или в мастере настройки.
  Если PWA запущена на ПК №2, её адрес по умолчанию указывает на ПК №2 —
  поставьте IP ПК №1.
- QR из браузерной прошивки уже содержит адрес релея.
- История сообщений общая — она в SQLite на ПК №1. Список устройств хранится
  в браузере каждого ПК отдельно, токен добавляется на каждом устройстве
  (удобнее по QR).
- Не запускайте два релея с разными базами, если нужна общая история: это
  будут два независимых сервера.

## Как смотреть изменения сайта

### Пока друг редактирует (одна локальная сеть)

Друг запускает сайт с доступом по сети:

```bash
npm run dev:landing:lan
```

Vite покажет `Network: http://192.168.x.x:5174`. Откройте этот адрес у себя —
страница будет обновляться сама при каждом сохранении файла (HMR). Нужно
разрешить порт 5174 в брандмауэре на ПК друга.

```powershell
# PowerShell от имени администратора на ПК друга
New-NetFirewallRule -DisplayName "IoT-Messenger landing" `
  -Direction Inbound -Protocol TCP -LocalPort 5174 -Action Allow
```

Это живой предпросмотр: правки видны до коммита.

### После пуша — GitHub Pages

Workflow `.github/workflows/deploy-landing.yml` собирает `landing/` и
публикует сайт на GitHub Pages при каждом пуше в `main` (и вручную через
`workflow_dispatch`).

Адрес сайта:

```
https://hegoleg.github.io/IOT-MESSENGER/
```

Первый запуск: в GitHub откройте **Settings → Pages** и выберите
**Source: GitHub Actions** (workflow пытается включить это сам, но настройку
стоит проверить). После пуша страница обновится через минуту-две.

Если друг работает в отдельной ветке и открывает pull request, сайт
обновится после merge в `main`. Чтобы смотреть правки до merge —
используйте LAN-предпросмотр выше.

Кнопка «Открыть приложение» на GitHub Pages ведёт в `/app/`. Пока PWA там не
развёрнута, сама страница сайта работает, а ссылка на приложение — нет. Когда
PWA будет опубликована, укажите её адрес в `data-app-url` у ссылок
`[data-app-link]` в `landing/index.html`.

### На своём ПК

```bash
git pull --rebase
npm install          # если менялся package-lock
npm run dev:landing  # живой просмотр
# или
npm run build:landing && npm run preview:landing
```

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
