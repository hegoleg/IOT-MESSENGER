import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Cloud,
  Copy,
  Cpu,
  MessageSquare,
  MoreVertical,
  Pencil,
  Settings,
  Trash2,
  Wifi,
} from "lucide-react";
import type { UseDeviceChatResult } from "../hooks/useDeviceChat";
import type { ConnectionMode, StoredDevice } from "../lib/types";
import { copyText } from "../lib/clipboard";
import { dayKey, formatDayLabel } from "../lib/format";
import MessageBubble from "./MessageBubble";
import Composer from "./Composer";
import QuickCommands from "./QuickCommands";

export interface ChatViewProps {
  device: StoredDevice;
  chat: UseDeviceChatResult;
  mode: ConnectionMode;
  onBack(): void;
  /** Saves the LAN host and reconnects in local mode. */
  onSetLocalHost(host: string): void;
  onOpenSettings(): void;
}

/** Distance from the bottom (px) that still counts as "reading the latest". */
const STICK_THRESHOLD = 120;

interface StatusInfo {
  label: string;
  dotClass: string;
  pulse: boolean;
}

type CopyState = "idle" | "ok" | "fail";

function describeStatus(status: UseDeviceChatResult["status"], deviceOnline: boolean): StatusInfo {
  if (status === "connecting") {
    return { label: "подключение…", dotClass: "bg-amber-400", pulse: true };
  }
  if (status === "offline") {
    return { label: "нет соединения", dotClass: "bg-zinc-600", pulse: false };
  }
  return deviceOnline
    ? { label: "в сети", dotClass: "bg-accent-400", pulse: false }
    : { label: "не в сети", dotClass: "bg-zinc-600", pulse: false };
}

export default function ChatView({
  device,
  chat,
  mode,
  onBack,
  onSetLocalHost,
  onOpenSettings,
}: ChatViewProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const copyTimer = useRef<number | null>(null);

  const [hostDraft, setHostDraft] = useState("");
  const [editingHost, setEditingHost] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [showJump, setShowJump] = useState(false);

  const status = describeStatus(chat.status, chat.deviceOnline);
  const canSend = chat.status === "online";
  const needsLocalHost = mode === "local" && !device.localHost;
  const showHostForm = needsLocalHost || editingHost;
  const canCancelHost = editingHost && Boolean(device.localHost);

  // Keep the feed pinned to the newest message unless the user scrolled up.
  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    const feed = feedRef.current;
    if (!feed) return;
    feed.scrollTop = feed.scrollHeight;
    setShowJump(false);
  }, [chat.messages]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  function handleScroll() {
    const feed = feedRef.current;
    if (!feed) return;
    const atBottom =
      feed.scrollHeight - feed.scrollTop - feed.clientHeight < STICK_THRESHOLD;
    stickToBottom.current = atBottom;
    setShowJump(!atBottom);
  }

  function scrollToBottom() {
    const feed = feedRef.current;
    if (!feed) return;
    stickToBottom.current = true;
    setShowJump(false);
    feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
  }

  async function copyToken() {
    setMenuOpen(false);
    const copied = await copyText(device.token);
    setCopyState(copied ? "ok" : "fail");
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState("idle"), 1600);
  }

  const copyLabel =
    copyState === "ok" ? "Скопировано" : copyState === "fail" ? "Не удалось" : "Скопировать токен";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="safe-top flex shrink-0 items-center gap-2 border-b border-white/10 bg-ink-900 px-2 pb-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Назад к устройствам"
          className="flex size-10 shrink-0 items-center justify-center border border-transparent text-zinc-400 transition hover:border-white/10 hover:bg-ink-850 hover:text-white active:translate-y-px"
        >
          <ArrowLeft className="size-4.5" aria-hidden="true" />
        </button>

        <div
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center border border-accent-400/60 bg-accent-400/10 text-accent-400"
        >
          <Cpu className="size-4" />
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold leading-tight tracking-[-0.02em] text-zinc-100">
            {device.name}
          </h2>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 ${status.dotClass} ${
                status.pulse ? "animate-pulse" : ""
              }`}
            />
            <span className="truncate">{status.label}</span>
          </div>
        </div>

        <span className="flex shrink-0 items-center gap-1 border border-white/15 bg-ink-950 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-500">
          {mode === "cloud" ? (
            <Cloud className="size-3" aria-hidden="true" />
          ) : (
            <Wifi className="size-3" aria-hidden="true" />
          )}
          <span className="hidden min-[380px]:inline">
            {mode === "cloud" ? "облако" : "локально"}
          </span>
        </span>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Меню чата"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex size-10 items-center justify-center border border-transparent text-zinc-400 transition hover:border-white/10 hover:bg-ink-850 hover:text-white active:translate-y-px"
          >
            <MoreVertical className="size-4.5" aria-hidden="true" />
          </button>

          {menuOpen ? (
            <>
              <div
                className="fixed inset-0 z-40"
                aria-hidden="true"
                onClick={() => setMenuOpen(false)}
              />
              <div
                role="menu"
                aria-label="Действия с чатом"
                className="animate-fade-in absolute right-0 top-full z-50 mt-1 w-60 border border-white/15 bg-ink-900 p-1 shadow-2xl shadow-black/70"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenSettings();
                  }}
                  className="flex min-h-10 w-full items-center gap-2.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-300 transition hover:bg-ink-800 hover:text-white"
                >
                  <Settings className="size-3.5" aria-hidden="true" />
                  Настройки
                </button>
                {mode === "local" ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setHostDraft(device.localHost ?? "");
                      setEditingHost(true);
                    }}
                    className="flex min-h-10 w-full items-center gap-2.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-300 transition hover:bg-ink-800 hover:text-white"
                  >
                    <Wifi className="size-3.5" aria-hidden="true" />
                    Изменить IP-адрес
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void copyToken()}
                  className="flex min-h-10 w-full items-center gap-2.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-300 transition hover:bg-ink-800 hover:text-white"
                >
                  {copyState === "ok" ? (
                    <Check className="size-3.5 text-accent-400" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                  {copyLabel}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={chat.messages.length === 0}
                  title="Скрывает сообщения на этом устройстве; на сервере история сохраняется"
                  onClick={() => {
                    setMenuOpen(false);
                    chat.clearHistory();
                  }}
                  className="flex min-h-10 w-full items-center gap-2.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-300 transition hover:bg-ink-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Очистить ленту
                </button>
              </div>
            </>
          ) : null}
        </div>
      </header>

      {showHostForm ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const host = hostDraft.trim();
            if (!host) return;
            onSetLocalHost(host);
            setEditingHost(false);
          }}
          className="shrink-0 border-b border-white/10 bg-ink-900 px-4 py-3"
        >
          <label htmlFor="local-host" className="mono-label block">
            IP-адрес устройства в локальной сети
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="local-host"
              value={hostDraft}
              onChange={(event) => setHostDraft(event.target.value)}
              placeholder="192.168.1.50"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="field min-h-10 min-w-0 flex-1 font-mono text-[12px]"
            />
            <button
              type="submit"
              disabled={!hostDraft.trim()}
              className="btn-primary min-h-10 shrink-0 px-3 text-[10px]"
            >
              Подключиться
            </button>
          </div>
          <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-zinc-600">
            Порт 81 добавится автоматически · mDNS: iotbot.local
          </p>
          {canCancelHost ? (
            <button
              type="button"
              onClick={() => setEditingHost(false)}
              className="mt-2 font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-500 underline-offset-2 transition hover:text-zinc-200 hover:underline"
            >
              Отмена
            </button>
          ) : null}
        </form>
      ) : chat.error ? (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-[11px] leading-snug text-rose-200"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 break-words">{chat.error}</p>
        </div>
      ) : chat.status === "offline" ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[11px] leading-snug text-amber-200"
        >
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 animate-pulse bg-amber-400"
          />
          <p className="min-w-0">Соединение потеряно. Переподключаемся…</p>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={feedRef}
          onScroll={handleScroll}
          role="log"
          aria-live="polite"
          aria-label="Сообщения устройства"
          className="h-full space-y-3 overflow-y-auto px-4 py-4"
        >
          {chat.messages.length === 0 ? (
            <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div
                aria-hidden="true"
                className="flex size-12 items-center justify-center border border-white/10 bg-ink-900 text-zinc-500"
              >
                <MessageSquare className="size-5" strokeWidth={1.6} />
              </div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-300">
                Нет сообщений
              </p>
              <p className="max-w-[16rem] text-xs leading-relaxed text-zinc-500">
                Отправьте /start, чтобы открыть меню устройства
              </p>
            </div>
          ) : (
            chat.messages.map((message, index) => {
              const previous = chat.messages[index - 1];
              const startsNewDay = !previous || dayKey(previous.ts) !== dayKey(message.ts);
              return (
                <Fragment key={message.id}>
                  {startsNewDay ? (
                    <div className="flex items-center gap-3 py-1">
                      <span className="h-px flex-1 bg-white/10" aria-hidden="true" />
                      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                        {formatDayLabel(message.ts)}
                      </span>
                      <span className="h-px flex-1 bg-white/10" aria-hidden="true" />
                    </div>
                  ) : null}
                  <MessageBubble
                    message={message}
                    disabled={!canSend}
                    onCallback={(messageId, data) => {
                      chat.sendCallback(messageId, data);
                    }}
                  />
                </Fragment>
              );
            })
          )}
        </div>

        {showJump ? (
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label="Прокрутить вниз"
            className="absolute bottom-4 right-4 flex size-9 items-center justify-center border border-white/15 bg-ink-900 text-zinc-300 shadow-lg shadow-black/50 transition hover:border-accent-400/60 hover:text-accent-300 active:translate-y-px"
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-white/10 bg-ink-900">
        <QuickCommands
          disabled={!canSend}
          onSend={(text) => {
            // The user's own message must always be visible.
            stickToBottom.current = true;
            chat.sendText(text);
          }}
        />
        <Composer
          disabled={!canSend}
          onSend={(text) => {
            stickToBottom.current = true;
            return chat.sendText(text);
          }}
        />
      </div>
    </div>
  );
}
