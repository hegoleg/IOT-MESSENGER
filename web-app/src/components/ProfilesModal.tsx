import { useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { countDevicesFor } from "../lib/deviceStore";
import { DEFAULT_PROFILE_ID, profileInitials, type Profile } from "../lib/profiles";

export interface ProfilesModalProps {
  open: boolean;
  profiles: Profile[];
  activeId: string;
  onClose(): void;
  onCreate(name: string): void;
  onSwitch(id: string): void;
  /** Returns false when the name is empty, so the editor stays open. */
  onRename(id: string, name: string): boolean;
  onDelete(id: string): void;
}

const NAME_MAX_LENGTH = 24;

export default function ProfilesModal({
  open,
  profiles,
  activeId,
  onClose,
  onCreate,
  onSwitch,
  onRename,
  onDelete,
}: ProfilesModalProps) {
  const [draftName, setDraftName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraftName("");
    setRenamingId(null);
    setConfirmDeleteId(null);
  }, [open]);

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
        aria-labelledby="profiles-title"
        className="animate-slide-up safe-bottom relative max-h-[92dvh] w-full max-w-md overflow-y-auto border-t border-white/15 bg-ink-900 p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="profiles-title"
              className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.03em] text-white"
            >
              <Users className="size-4 text-accent-400" aria-hidden="true" />
              Профили
            </h2>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500">
              Список устройств и адрес релея — отдельно для каждого
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть профили"
            className="-mr-1 flex size-10 shrink-0 items-center justify-center border border-white/10 text-zinc-400 transition hover:border-white/25 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>

        <ul className="panel divide-y divide-white/10">
          {profiles.map((profile) => {
            const active = profile.id === activeId;
            const devices = countDevicesFor(profile.id);

            return (
              <li key={profile.id} className="relative flex items-center gap-3 px-3 py-3">
                <button
                  type="button"
                  onClick={() => {
                    if (active) {
                      onClose();
                      return;
                    }
                    onSwitch(profile.id);
                  }}
                  disabled={renamingId === profile.id || confirmDeleteId === profile.id}
                  aria-label={active ? `Активный профиль ${profile.name}` : `Переключиться на профиль ${profile.name}`}
                  className="absolute inset-0 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-400/70"
                />

                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center border text-[12px] font-bold"
                  style={{
                    borderColor: `${profile.color}66`,
                    color: profile.color,
                    background: "#0b0b0a",
                  }}
                >
                  {profileInitials(profile.name)}
                </span>

                <div className="pointer-events-none relative min-w-0 flex-1">
                  {renamingId === profile.id ? (
                    <div
                      className="pointer-events-auto"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        autoFocus
                        value={renameDraft}
                        maxLength={NAME_MAX_LENGTH}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            if (onRename(profile.id, renameDraft)) setRenamingId(null);
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            setRenamingId(null);
                          }
                        }}
                        onBlur={() => setRenamingId(null)}
                        aria-label="Новое название профиля"
                        className="field px-2 py-1 text-[13px] font-medium"
                      />
                    </div>
                  ) : (
                    <p className="truncate text-[14px] font-medium text-zinc-100">
                      {profile.name}
                    </p>
                  )}
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-500">
                    {devices} устр.
                    {active ? <span className="ml-2 text-accent-400">активен</span> : null}
                  </p>
                </div>

                <div
                  className="pointer-events-auto relative flex shrink-0 items-center"
                  onClick={(event) => event.stopPropagation()}
                >
                  {confirmDeleteId === profile.id ? (
                    <>
                      <span className="mr-1 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
                        Удалить?
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onDelete(profile.id);
                          setConfirmDeleteId(null);
                        }}
                        aria-label={`Удалить профиль ${profile.name}`}
                        className="flex min-h-9 min-w-9 items-center justify-center border border-rose-500/40 bg-rose-500/10 px-2 font-mono text-[10px] font-bold uppercase text-rose-300 transition hover:bg-rose-500/20"
                      >
                        Да
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        aria-label="Отменить удаление профиля"
                        className="flex min-h-9 min-w-9 items-center justify-center border border-white/10 bg-ink-850 px-2 font-mono text-[10px] font-bold uppercase text-zinc-300 transition hover:border-white/25"
                      >
                        Нет
                      </button>
                    </>
                  ) : (
                    <>
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="mr-1 flex size-9 items-center justify-center text-accent-400"
                        >
                          <Check className="size-4" />
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          setRenameDraft(profile.name);
                          setRenamingId(profile.id);
                        }}
                        aria-label={`Переименовать профиль ${profile.name}`}
                        className="flex size-10 items-center justify-center border border-transparent text-zinc-500 transition hover:border-white/10 hover:bg-ink-850 hover:text-zinc-200"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(profile.id)}
                        disabled={profile.id === DEFAULT_PROFILE_ID || profiles.length <= 1}
                        aria-label={`Удалить профиль ${profile.name}`}
                        className="flex size-10 items-center justify-center border border-transparent text-zinc-500 transition hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-transparent disabled:hover:bg-transparent"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-4">
          <label htmlFor="new-profile" className="mono-label block">
            Новый профиль
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="new-profile"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onCreate(draftName);
                setDraftName("");
              }}
              maxLength={NAME_MAX_LENGTH}
              placeholder="Например, Дача"
              className="field min-h-11 min-w-0 flex-1"
            />
            <button
              type="button"
              onClick={() => {
                onCreate(draftName);
                setDraftName("");
              }}
              disabled={draftName.trim().length === 0}
              className="btn-primary min-h-11 shrink-0 px-3"
            >
              <Plus className="size-4" strokeWidth={2.5} aria-hidden="true" />
              Создать
            </button>
          </div>
          <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.08em] text-zinc-600">
            Профили хранятся только на этом устройстве
          </p>
        </div>
      </div>
    </div>
  );
}
