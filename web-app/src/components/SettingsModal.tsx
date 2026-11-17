import { useEffect, useState } from "react";
import { Check, Download, RefreshCw, Server, Settings, X } from "lucide-react";
import type { PwaInstallState } from "../hooks/usePwaInstall";
import type { ConnectionMode } from "../lib/types";
import { checkServer, normalizeServerUrl } from "../lib/serverApi";

export interface SettingsModalProps {
  open: boolean;
  serverUrl: string;
  mode: ConnectionMode;
  install: PwaInstallState;
  onClose(): void;
  onSave(serverUrl: string): void;
  onRunOnboarding(): void;
}

type CheckState = "idle" | "checking" | "ok" | "error";

const MODE_LABEL: Record<ConnectionMode, string> = {
  cloud: "Облако · WSS через релей",
  local: "Локально · прямое подключение",
};

export default function SettingsModal({
  open,
  serverUrl,
  mode,
  install,
  onClose,
  onSave,
  onRunOnboarding,
}: SettingsModalProps) {
  const [draft, setDraft] = useState(serverUrl);
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  const normalized = normalizeServerUrl(draft);

  useEffect(() => {
    if (!open) return;
    setDraft(serverUrl);
    setCheckState("idle");
    setMessage(null);
    setError(null);
    setInstalling(false);
  }, [open, serverUrl]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  async function handleCheck(): Promise<void> {
    if (!normalized) {
      setCheckState("error");
      setMessage("Адрес должен начинаться с ws:// или wss://");
      return;
    }
    setCheckState("checking");
    setMessage(null);
    try {
      const health = await checkServer(normalized);
      setCheckState("ok");
      setMessage(`Релей доступен · uptime ${health.uptime} с`);
    } catch (checkError) {
      setCheckState("error");
      setMessage(checkError instanceof Error ? checkError.message : "Релей не отвечает");
    }
  }

  function handleSave(): void {
    if (!normalized) {
      setError("Введите корректный адрес релея");
      return;
    }
    onSave(normalized);
    onClose();
  }

  async function handleInstall(): Promise<void> {
    setInstalling(true);
    try {
      await install.install();
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="animate-fade-in absolute inset-0 bg-black/80"
        aria-hidden="true"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="animate-slide-up safe-bottom relative max-h-[92dvh] w-full max-w-md overflow-y-auto border-t border-white/15 bg-ink-900 p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="settings-title"
              className="font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-white"
            >
              Настройки
            </h2>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500">
              Релей, приложение, подключение
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть настройки"
            className="-mr-1 flex size-10 shrink-0 items-center justify-center border border-white/10 text-zinc-400 transition hover:border-white/25 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>

        <section>
          <p className="mono-label flex items-center gap-2">
            <Server className="size-3.5" aria-hidden="true" />
            Адрес релея
          </p>
          <input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setCheckState("idle");
              setMessage(null);
              setError(null);
            }}
            placeholder="ws://192.168.1.10:8080"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Адрес релея"
            className="field mt-1.5 font-mono text-[12px]"
          />
          <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.06em] text-zinc-600">
            ws://IP:8080 для локального релея · wss://домен для облака
          </p>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleCheck()}
              disabled={checkState === "checking"}
              className="btn-ghost min-h-10"
            >
              {checkState === "checking" ? "Проверяем…" : "Проверить"}
            </button>
            <button type="button" onClick={handleSave} className="btn-primary min-h-10">
              Сохранить
            </button>
          </div>

          {message ? (
            <p
              role="status"
              className={`mt-2 flex items-start gap-2 border px-3 py-2 text-[11px] leading-relaxed ${
                checkState === "ok"
                  ? "border-accent-400/40 bg-accent-400/10 text-accent-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-200"
              }`}
            >
              {checkState === "ok" ? (
                <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <X className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              )}
              {message}
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="mt-2 text-[11px] text-rose-300">
              {error}
            </p>
          ) : null}

          <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.06em] text-zinc-600">
            Сейчас: {MODE_LABEL[mode]}
          </p>
        </section>

        <section className="mt-5 border-t border-white/10 pt-4">
          <p className="mono-label flex items-center gap-2">
            <Download className="size-3.5" aria-hidden="true" />
            Приложение
          </p>

          {install.installed ? (
            <p className="mt-2 flex items-center gap-2 border border-accent-400/40 bg-accent-400/10 px-3 py-2 text-[12px] text-accent-300">
              <Check className="size-4" aria-hidden="true" />
              Приложение установлено
            </p>
          ) : install.canInstall ? (
            <button
              type="button"
              onClick={() => void handleInstall()}
              disabled={installing}
              className="btn-primary mt-2 min-h-11 w-full"
            >
              <Download className="size-4" aria-hidden="true" />
              {installing ? "Устанавливаем…" : "Установить приложение"}
            </button>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              {install.isIos
                ? "На iPhone: Safari → «Поделиться» → «На экран Домой»."
                : "Откройте меню браузера → «Установить приложение» или используйте иконку установки в адресной строке."}
            </p>
          )}

          <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.06em] text-zinc-600">
            Установка доступна по HTTPS или на localhost
          </p>
        </section>

        <section className="mt-5 border-t border-white/10 pt-4">
          <p className="mono-label flex items-center gap-2">
            <Settings className="size-3.5" aria-hidden="true" />
            Мастер настройки
          </p>
          <button
            type="button"
            onClick={onRunOnboarding}
            className="btn-ghost mt-2 min-h-10 w-full"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Пройти настройку заново
          </button>
        </section>

        <p className="mt-5 border-t border-white/10 pt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-600">
          IoT Messenger · протокол v1
        </p>
      </div>
    </div>
  );
}
