import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  RadioTower,
  Server,
  Smartphone,
  X,
} from "lucide-react";
import { copyText } from "../lib/clipboard";
import { isValidToken } from "../lib/deviceStore";
import { checkServer, createDeviceToken, normalizeServerUrl } from "../lib/serverApi";

export interface OnboardingResult {
  serverUrl: string;
  device?: { token: string; name?: string };
}

export interface OnboardingProps {
  defaultServerUrl: string;
  onComplete(result: OnboardingResult): void;
  onSkip(): void;
}

type Step = 0 | 1 | 2;
type CheckState = "idle" | "checking" | "ok" | "error";

export default function Onboarding({ defaultServerUrl, onComplete, onSkip }: OnboardingProps) {
  const [step, setStep] = useState<Step>(0);
  const [serverDraft, setServerDraft] = useState(defaultServerUrl);
  const [serverCheck, setServerCheck] = useState<CheckState>("idle");
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const [deviceMode, setDeviceMode] = useState<"create" | "token">("create");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const normalizedServer = normalizeServerUrl(serverDraft);
  const trimmedToken = token.trim();
  const tokenValid = trimmedToken.length > 0 && isValidToken(trimmedToken);
  const canFinish = Boolean(normalizedServer) && tokenValid;

  async function handleCheck(): Promise<void> {
    if (!normalizedServer) {
      setServerCheck("error");
      setServerMessage("Введите адрес вида ws://192.168.1.10:8080");
      return;
    }

    setServerCheck("checking");
    setServerMessage(null);
    try {
      const health = await checkServer(normalizedServer);
      setServerCheck("ok");
      setServerMessage(`Релей доступен · uptime ${health.uptime} с`);
    } catch (error) {
      setServerCheck("error");
      setServerMessage(error instanceof Error ? error.message : "Релей не отвечает");
    }
  }

  async function handleCreateDevice(): Promise<void> {
    if (!normalizedServer) {
      setCreateError("Сначала укажите адрес релея на предыдущем шаге.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const created = await createDeviceToken(normalizedServer);
      setToken(created);
      setCopied(false);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Не удалось создать устройство",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(): Promise<void> {
    const ok = await copyText(trimmedToken);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function finish(withDevice: boolean): void {
    if (!normalizedServer) return;
    if (withDevice && !tokenValid) return;

    onComplete({
      serverUrl: normalizedServer,
      device: withDevice
        ? { token: trimmedToken, name: name.trim() || undefined }
        : undefined,
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="safe-top flex items-center gap-3 border-b border-white/10 bg-ink-900 px-4 pb-3">
        <div
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center border border-accent-400/70 bg-accent-400/10 text-accent-400"
        >
          <RadioTower className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
            Настройка
          </p>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-accent-400">
            Шаг 0{step + 1} / 03
          </p>
        </div>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Пропустить настройку"
          className="flex size-10 items-center justify-center border border-transparent text-zinc-400 transition hover:border-white/10 hover:bg-ink-850 hover:text-white"
        >
          <X className="size-4.5" />
        </button>
      </header>

      <div className="grid shrink-0 grid-cols-3 gap-1 px-4 py-2" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={`h-0.5 ${index <= step ? "bg-accent-400" : "bg-white/10"}`}
          />
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {step === 0 ? (
          <section className="animate-fade-in">
            <p className="mono-label">Шаг 01 — знакомство</p>
            <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-tight text-white">
              Настроим ваш
              <br />
              мессенджер
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Плата и телефон будут общаться через ваш собственный релей.
              Без VPN, внешних API и подписок.
            </p>

            <ul className="mt-5 space-y-2.5">
              {[
                {
                  icon: Server,
                  title: "Свой релей",
                  text: "Сообщения хранятся на вашем сервере в SQLite.",
                },
                {
                  icon: Smartphone,
                  title: "Приложение на телефон",
                  text: "PWA устанавливается из браузера как обычное приложение.",
                },
                {
                  icon: RadioTower,
                  title: "Без VPN",
                  text: "Прямой WebSocket между платой, релеем и клиентом.",
                },
              ].map(({ icon: Icon, title, text }) => (
                <li
                  key={title}
                  className="flex items-start gap-3 border border-white/10 bg-ink-900/70 p-3"
                >
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center border border-accent-400/40 bg-accent-400/10 text-accent-400">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-zinc-100">{title}</span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-zinc-500">
                      {text}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {step === 1 ? (
          <section className="animate-fade-in">
            <p className="mono-label">Шаг 02 — релей</p>
            <h1 className="mt-2 text-[24px] font-semibold leading-tight tracking-tight text-white">
              Адрес релея
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Это сервер, через который плата и телефон обмениваются сообщениями.
              Если релей запущен на этом компьютере, оставьте значение по умолчанию.
            </p>

            <label htmlFor="relay-url" className="mono-label mt-5 block">
              WebSocket-адрес
            </label>
            <input
              id="relay-url"
              value={serverDraft}
              onChange={(event) => {
                setServerDraft(event.target.value);
                setServerCheck("idle");
                setServerMessage(null);
              }}
              placeholder="ws://192.168.1.10:8080"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="field mt-1.5 font-mono text-[12px]"
            />
            <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-[0.06em] text-zinc-600">
              Локально: ws://IP:8080 · облако: wss://relay.example
            </p>

            <button
              type="button"
              onClick={() => void handleCheck()}
              disabled={serverCheck === "checking"}
              className="btn-ghost mt-3 min-h-10 w-full"
            >
              {serverCheck === "checking" ? "Проверяем…" : "Проверить соединение"}
            </button>

            {serverMessage ? (
              <p
                role="status"
                className={`mt-2 flex items-start gap-2 border px-3 py-2 text-[12px] leading-relaxed ${
                  serverCheck === "ok"
                    ? "border-accent-400/40 bg-accent-400/10 text-accent-300"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-200"
                }`}
              >
                {serverCheck === "ok" ? (
                  <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <X className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                )}
                {serverMessage}
              </p>
            ) : null}

            <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
              Адрес можно изменить позже в настройках приложения.
            </p>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="animate-fade-in">
            <p className="mono-label">Шаг 03 — устройство</p>
            <h1 className="mt-2 text-[24px] font-semibold leading-tight tracking-tight text-white">
              Первое устройство
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Токен — это пароль платы. Его нужно будет вписать в
              <code className="mx-1 border border-white/10 bg-ink-850 px-1 font-mono text-[11px] text-zinc-300">
                secrets.h
              </code>
              перед прошивкой.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-1 border border-white/10 bg-ink-950 p-1">
              <button
                type="button"
                onClick={() => setDeviceMode("create")}
                aria-pressed={deviceMode === "create"}
                className={`min-h-9 font-mono text-[10px] uppercase tracking-[0.08em] transition ${
                  deviceMode === "create"
                    ? "bg-accent-400 text-ink-950"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Создать новое
              </button>
              <button
                type="button"
                onClick={() => setDeviceMode("token")}
                aria-pressed={deviceMode === "token"}
                className={`min-h-9 font-mono text-[10px] uppercase tracking-[0.08em] transition ${
                  deviceMode === "token"
                    ? "bg-accent-400 text-ink-950"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                У меня есть токен
              </button>
            </div>

            {deviceMode === "create" ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => void handleCreateDevice()}
                  disabled={creating}
                  className="btn-primary min-h-11 w-full"
                >
                  {creating ? "Создаём…" : token ? "Создать ещё один" : "Создать устройство"}
                </button>

                {token ? (
                  <div className="mt-3 border border-accent-400/40 bg-accent-400/5 p-3">
                    <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-accent-300">
                      Токен создан
                    </p>
                    <p className="mt-1.5 break-all font-mono text-[12px] text-zinc-100">
                      {token}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleCopy()}
                      className="btn-ghost mt-2 min-h-9 w-full"
                    >
                      {copied ? (
                        <Check className="size-3.5 text-accent-400" aria-hidden="true" />
                      ) : (
                        <Copy className="size-3.5" aria-hidden="true" />
                      )}
                      {copied ? "Скопировано" : "Скопировать токен"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-3">
                <label htmlFor="device-token-onboarding" className="mono-label block">
                  Токен устройства
                </label>
                <textarea
                  id="device-token-onboarding"
                  value={token}
                  onChange={(event) => {
                    setToken(event.target.value.replace(/\s+/g, ""));
                    setCreateError(null);
                  }}
                  rows={2}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  placeholder="Вставьте токен, выданный релеем"
                  className="field mt-1.5 resize-none break-all font-mono text-[12px]"
                />
                {trimmedToken && !tokenValid ? (
                  <p className="mt-1.5 text-[11px] text-rose-300">
                    Токен должен быть не короче 16 символов: латиница, цифры, «-» и «_».
                  </p>
                ) : null}
              </div>
            )}

            <label htmlFor="device-name-onboarding" className="mono-label mt-4 block">
              Название устройства
            </label>
            <input
              id="device-name-onboarding"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              placeholder="Например, Теплица"
              className="field mt-1.5"
            />

            {createError ? (
              <p role="alert" className="mt-2 text-[11px] leading-relaxed text-rose-300">
                {createError}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => finish(false)}
              className="mt-4 font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-500 underline-offset-2 transition hover:text-zinc-200 hover:underline"
            >
              Пропустить добавление устройства
            </button>
          </section>
        ) : null}
      </div>

      <div className="safe-bottom shrink-0 border-t border-white/10 bg-ink-900 px-4 py-3">
        {step === 0 ? (
          <button
            type="button"
            onClick={() => setStep(1)}
            className="btn-primary min-h-12 w-full"
          >
            Начать настройку
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        ) : null}

        {step === 1 ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(0)}
              aria-label="Назад"
              className="btn-ghost min-h-12 px-3"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!normalizedServer}
              className="btn-primary min-h-12 flex-1"
            >
              Далее
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              aria-label="Назад"
              className="btn-ghost min-h-12 px-3"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => finish(true)}
              disabled={!canFinish}
              className="btn-primary min-h-12 flex-1"
            >
              Завершить
              <Check className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
