import { useRef, useState, type JSX } from "react";
import { CircuitBoard, Pencil, Trash2 } from "lucide-react";
import { formatRelative, truncateMiddle } from "../lib/format";
import type { PresenceState, StoredDevice } from "../lib/types";

export interface DeviceCardProps {
  device: StoredDevice;
  active: boolean;
  status: PresenceState;
  onOpen(): void;
  onRemove(): void;
  onRename(name: string): void;
}

const STATUS_META: Record<
  PresenceState,
  { label: string; dot: string; text: string }
> = {
  online: { label: "в сети", dot: "bg-accent-400", text: "text-accent-300" },
  connecting: { label: "проверка", dot: "bg-amber-400 animate-pulse", text: "text-amber-300" },
  offline: { label: "не в сети", dot: "bg-zinc-600", text: "text-zinc-500" },
  unknown: { label: "нет данных", dot: "bg-zinc-700", text: "text-zinc-500" },
};

export default function DeviceCard({
  device,
  active,
  status,
  onOpen,
  onRemove,
  onRename,
}: DeviceCardProps): JSX.Element {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(device.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const cancelledRename = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const meta = STATUS_META[status];
  const activity = device.lastActivityAt
    ? formatRelative(device.lastActivityAt)
    : "нет активности";

  function startRename(): void {
    cancelledRename.current = false;
    setConfirmingDelete(false);
    setDraft(device.name);
    setRenaming(true);
  }

  function commitRename(): void {
    setRenaming(false);
    const nextName = draft.trim();
    if (nextName && nextName !== device.name) onRename(nextName);
  }

  function cancelRename(): void {
    cancelledRename.current = true;
    setDraft(device.name);
    setRenaming(false);
  }

  function handleRenameBlur(): void {
    if (cancelledRename.current) {
      cancelledRename.current = false;
      return;
    }
    commitRename();
  }

  return (
    <article
      className={`relative flex items-center gap-3 px-3 py-3 transition ${
        active ? "bg-accent-400/[0.06]" : "hover:bg-white/[0.03]"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={renaming || confirmingDelete}
        aria-label={`Открыть чат устройства ${device.name}`}
        className="absolute inset-0 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-400/70 disabled:cursor-default"
      />

      <div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-3">
        <div
          className={`flex size-10 shrink-0 items-center justify-center border bg-ink-950 ${
            active ? "border-accent-400/60 text-accent-400" : "border-white/10 text-zinc-400"
          }`}
        >
          <CircuitBoard className="size-4.5" strokeWidth={1.8} aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="pointer-events-auto" onClick={(event) => event.stopPropagation()}>
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={handleRenameBlur}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRename();
                  }
                }}
                maxLength={40}
                autoFocus
                aria-label="Новое название устройства"
                className="field px-2 py-1 text-[13px] font-medium"
              />
            </div>
          ) : (
            <p className="truncate text-[14px] font-medium text-zinc-100">{device.name}</p>
          )}

          <p className="mt-0.5 truncate font-mono text-[10px] tracking-tight text-zinc-500">
            {truncateMiddle(device.token, 6, 6)}
          </p>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.1em]">
            <span className={`inline-flex items-center gap-1.5 ${meta.text}`}>
              <span className={`size-1.5 shrink-0 ${meta.dot}`} aria-hidden="true" />
              {meta.label}
            </span>
            <span className="text-zinc-700" aria-hidden="true">
              /
            </span>
            <span className="min-w-0 truncate text-zinc-600">{activity}</span>
          </div>
        </div>
      </div>

      <div
        className="pointer-events-auto relative flex shrink-0 items-center"
        onClick={(event) => event.stopPropagation()}
      >
        {confirmingDelete ? (
          <>
            <span className="mr-1 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
              Удалить?
            </span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setConfirmingDelete(false);
                onRemove();
              }}
              aria-label={`Удалить устройство ${device.name}`}
              className="flex min-h-9 min-w-9 items-center justify-center border border-rose-500/40 bg-rose-500/10 px-2 font-mono text-[10px] font-bold uppercase text-rose-300 transition hover:bg-rose-500/20"
            >
              Да
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setConfirmingDelete(false);
              }}
              aria-label="Отменить удаление"
              className="flex min-h-9 min-w-9 items-center justify-center border border-white/10 bg-ink-850 px-2 font-mono text-[10px] font-bold uppercase text-zinc-300 transition hover:border-white/25"
            >
              Нет
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                startRename();
              }}
              aria-label={`Переименовать устройство ${device.name}`}
              className="flex size-10 items-center justify-center border border-transparent text-zinc-500 transition hover:border-white/10 hover:bg-ink-850 hover:text-zinc-200"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setConfirmingDelete(true);
              }}
              aria-label={`Удалить устройство ${device.name}`}
              className="flex size-10 items-center justify-center border border-transparent text-zinc-500 transition hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300"
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        )}
      </div>
    </article>
  );
}
