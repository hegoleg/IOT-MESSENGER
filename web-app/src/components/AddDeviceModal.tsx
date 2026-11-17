import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { ClipboardPaste, Plus, QrCode, RefreshCw, X } from "lucide-react";
import type { AddDeviceInput } from "../lib/types";
import { TOKEN_MIN_LENGTH, normalizeLocalHost } from "../lib/deviceStore";
import { createDeviceToken } from "../lib/serverApi";
import QrScanner from "./QrScanner";

export interface AddDeviceModalProps {
  open: boolean;
  serverUrl: string;
  existingTokens: string[];
  onClose(): void;
  /** May throw Error (e.g. duplicate token) — the message is shown in the modal. */
  onAdd(input: AddDeviceInput): void;
}

const TOKEN_CHARS = /^[A-Za-z0-9_-]+$/;

const fieldClass =
  "w-full border border-white/15 bg-ink-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none transition focus:border-accent-400/70";

const TOKEN_QUERY = /[?&]token=([^&#\s]+)/i;

/** Extracts a token from a QR payload: ?token=..., a URL path segment, or raw text. */
function extractToken(raw: string): string {
  const text = raw.trim();
  if (!text) return "";

  const queryMatch = text.match(TOKEN_QUERY);
  if (queryMatch?.[1]) {
    try {
      return decodeURIComponent(queryMatch[1]).trim();
    } catch {
      return queryMatch[1].trim();
    }
  }

  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get("token");
    if (fromQuery) return fromQuery.trim();

    const fromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get("token");
    if (fromHash) return fromHash.trim();

    const lastSegment = url.pathname.split("/").filter(Boolean).at(-1);
    if (lastSegment) {
      try {
        return decodeURIComponent(lastSegment).trim();
      } catch {
        return lastSegment.trim();
      }
    }
  } catch {
    // Not a URL — the text itself is the token.
  }

  return text;
}

/** Tokens are pasted from QR codes and clipboard, so strip any whitespace. */
function cleanToken(value: string): string {
  return value.replace(/\s+/g, "");
}

export default function AddDeviceModal({
  open,
  serverUrl,
  existingTokens,
  onClose,
  onAdd,
}: AddDeviceModalProps): JSX.Element | null {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [localHost, setLocalHost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdOnRelay, setCreatedOnRelay] = useState(false);

  const tokenRef = useRef<HTMLTextAreaElement | null>(null);

  const trimmedToken = token.trim();
  const lengthOk = trimmedToken.length >= TOKEN_MIN_LENGTH;
  const charsOk = TOKEN_CHARS.test(trimmedToken);
  const canSubmit = lengthOk && charsOk;
  const duplicate = canSubmit && existingTokens.includes(trimmedToken);

  const tokenHint = !trimmedToken
    ? null
    : !lengthOk
      ? `Токен должен содержать минимум ${TOKEN_MIN_LENGTH} символов`
      : !charsOk
        ? "Допустимы только латиница, цифры, «-» и «_»"
        : null;

  // Fresh form every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setToken("");
    setName("");
    setLocalHost("");
    setError(null);
    setScanning(false);
    setCreating(false);
    setCreateError(null);
    setCreatedOnRelay(false);
  }, [open]);

  // Focus the token field (delayed a little for mobile keyboards).
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => tokenRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Block background scrolling while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Escape closes the sheet, but not while the QR scanner is on top.
  useEffect(() => {
    if (!open || scanning) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setToken("");
        setName("");
        setLocalHost("");
        setError(null);
        setCreateError(null);
        setCreatedOnRelay(false);
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, scanning, onClose]);

  if (!open) return null;

  function closeModal(): void {
    setScanning(false);
    setToken("");
    setName("");
    setLocalHost("");
    setError(null);
    setCreating(false);
    setCreateError(null);
    setCreatedOnRelay(false);
    onClose();
  }

  async function handleCreateToken(): Promise<void> {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createDeviceToken(serverUrl);
      setToken(created);
      setCreatedOnRelay(true);
      setError(null);
    } catch (createFailure) {
      setCreateError(
        createFailure instanceof Error
          ? createFailure.message
          : "Не удалось создать устройство на релее",
      );
    } finally {
      setCreating(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    try {
      onAdd({
        token: trimmedToken,
        name: name.trim() || undefined,
        localHost: normalizeLocalHost(localHost),
      });
    } catch (addError) {
      setError(
        addError instanceof Error ? addError.message : "Не удалось добавить устройство",
      );
      return;
    }

    setToken("");
    setName("");
    setLocalHost("");
    setCreatedOnRelay(false);
    setCreateError(null);
    onClose();
  }

  async function pasteFromClipboard(): Promise<void> {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
        setError("Буфер обмена недоступен в этом браузере");
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setError("Буфер обмена пуст");
        return;
      }
      setToken(cleanToken(extractToken(text)));
      setCreatedOnRelay(false);
      setError(null);
    } catch {
      setError("Не удалось прочитать буфер обмена");
    }
  }

  function handleScanResult(text: string): void {
    setScanning(false);
    setToken(cleanToken(extractToken(text)));
    setCreatedOnRelay(false);
    setError(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="animate-fade-in absolute inset-0 bg-black/80"
        onClick={closeModal}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-device-title"
        className="animate-slide-up safe-bottom relative max-h-[92dvh] w-full max-w-md overflow-y-auto border-t border-white/15 bg-ink-900 p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="add-device-title" className="font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-white">
              Новое устройство
            </h2>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500">
              Токен выдаёт релей при создании устройства
            </p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Закрыть окно добавления"
            className="-mr-1 flex size-10 shrink-0 items-center justify-center border border-white/10 text-zinc-400 transition hover:border-white/25 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="device-token"
              className="mono-label mb-1.5 block"
            >
              Токен устройства
            </label>
            <textarea
              id="device-token"
              ref={tokenRef}
              value={token}
              onChange={(event) => {
                setToken(cleanToken(event.target.value));
                setCreatedOnRelay(false);
                setCreateError(null);
                setError(null);
              }}
              rows={2}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              placeholder="Например, 9fK2mQ7xLp4vR8sT1uW6yZ3a"
              aria-invalid={Boolean(tokenHint || error)}
              aria-describedby={tokenHint || error ? "device-token-error" : undefined}
              className={`${fieldClass} resize-none break-all font-mono tracking-tight`}
            />
            {tokenHint || error ? (
              <p id="device-token-error" role="alert" className="mt-1.5 text-xs text-rose-400">
                {error ?? tokenHint}
              </p>
            ) : null}
            {!error && !tokenHint && duplicate ? (
              <p className="mt-1.5 text-xs text-amber-300">
                Такое устройство уже есть в списке
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void handleCreateToken()}
              disabled={creating}
              className="btn-ghost mt-2 min-h-10 w-full"
            >
              <RefreshCw
                className={`size-3.5 ${creating ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {creating ? "Создаём…" : "Создать новый токен на релее"}
            </button>

            {createdOnRelay ? (
              <p className="mt-1.5 text-[11px] leading-relaxed text-accent-300">
                Токен создан. Задайте название и нажмите «Добавить».
              </p>
            ) : null}

            {createError ? (
              <p role="alert" className="mt-1.5 text-[11px] leading-relaxed text-rose-300">
                {createError}
              </p>
            ) : null}

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void pasteFromClipboard()}
                className="flex min-h-10 items-center justify-center gap-2 border border-white/15 bg-ink-850 px-3 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-300 transition hover:border-accent-400/50 hover:text-white"
              >
                <ClipboardPaste className="size-3.5" aria-hidden="true" />
                Вставить
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setScanning(true);
                }}
                className="flex min-h-10 items-center justify-center gap-2 border border-white/15 bg-ink-850 px-3 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-300 transition hover:border-accent-400/50 hover:text-white"
              >
                <QrCode className="size-3.5" aria-hidden="true" />
                Сканировать
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="device-name"
              className="mono-label mb-1.5 block"
            >
              Название <span className="font-normal text-zinc-600">(необязательно)</span>
            </label>
            <input
              id="device-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              placeholder="Например, Теплица"
              className={fieldClass}
            />
          </div>

          <div>
            <label
              htmlFor="device-host"
              className="mono-label mb-1.5 block"
            >
              IP для локального режима{" "}
              <span className="font-normal text-zinc-600">(необязательно)</span>
            </label>
            <input
              id="device-host"
              type="text"
              value={localHost}
              onChange={(event) => setLocalHost(event.target.value)}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="например, 192.168.1.50"
              className={`${fieldClass} font-mono`}
            />
            <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-zinc-600">
              Нужен только для режима «Локально»: адрес платы в вашей сети.
            </p>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="btn-primary min-h-12 w-full"
          >
            <Plus className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
            Добавить
          </button>
        </form>
      </div>

      {scanning && (
        <QrScanner
          onResult={handleScanResult}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
