---
tags:
  - iot-messenger
  - pwa
updated: 2026-11-17
---

# PWA-клиент

Каталог: `web-app/`. React 19, Vite, TypeScript, Tailwind CSS, lucide-react,
PWA.

## Экраны

- **Онбординг** — знакомство → адрес релея и проверка → устройство.
- **Список устройств** — статус, активность, поиск, добавление/удаление.
- **Чат** — сообщения, инлайн-кнопки, composer, быстрые команды.
- **Настройки** — релей, установка PWA, повторный мастер.

## Ключевые файлы

| Файл | Роль |
| --- | --- |
| `App.tsx` | состояние, deep link, активный чат |
| `components/Onboarding.tsx` | мастер настройки |
| `components/SettingsModal.tsx` | релей и установка |
| `hooks/useDeviceChat.ts` | WebSocket, история, heartbeat |
| `hooks/useDevices.ts` | localStorage устройств |
| `hooks/usePresence.ts` | online/offline опрос |
| `hooks/usePwaInstall.ts` | beforeinstallprompt |
| `lib/serverApi.ts` | health, создание токена, URL |
| `lib/settings.ts` | адрес релея и флаг онбординга |

## Адрес релея

По умолчанию — тот же домен, где открыта PWA; на Vite-портах 5173/4173
используется `ws://host:8080`. Адрес меняется в настройках и сохраняется в
`localStorage`.

## QR и deep link

Сайт после прошивки показывает QR вида:

```
https://host/app/#token=...&relay=...
```

PWA читает `token` и `relay`, сохраняет адрес релея, добавляет устройство,
открывает чат и очищает hash. Тот же QR можно сканировать внутри PWA.

## Presence

Список устройств раз в ~30 секунд открывает короткий `usr`-сокет на токен,
читает `status` и закрывается. Активный чат уже сообщает статус, его presence
пропускает.

## Установка

- Android: Chrome → «Установить приложение».
- iPhone/iPad: Safari → «Поделиться» → «На экран Домой».
- Компьютер: иконка установки в адресной строке.

Для установки и Web Serial нужен HTTPS или localhost.

## Деплой

- GitHub Pages: `/IOT-MESSENGER/app/`, сборка с `SITE_BASE=/IOT-MESSENGER/`.
- Netlify: `/app/`, сборка без `SITE_BASE`.

Связанные заметки: [[02 Протокол]], [[06 Сайт и деплой]],
[[07 Запуск и проверки]].
