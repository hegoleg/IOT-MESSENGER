import { RadioTower, Settings } from "lucide-react";
import ModeSwitch from "./ModeSwitch";
import { profileInitials, type Profile } from "../lib/profiles";
import type { ConnectionMode } from "../lib/types";

export interface AppHeaderProps {
  mode: ConnectionMode;
  profile: Profile;
  onModeChange(mode: ConnectionMode): void;
  onOpenProfiles(): void;
  onOpenSettings(): void;
}

export default function AppHeader({
  mode,
  profile,
  onModeChange,
  onOpenProfiles,
  onOpenSettings,
}: AppHeaderProps) {
  return (
    <header className="safe-top flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-ink-900 px-4 pb-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center border border-accent-400/70 bg-accent-400/10 text-accent-400">
          <RadioTower className="size-4" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-sans text-[15px] font-semibold leading-none tracking-[-0.03em] text-zinc-100">
            IoT Messenger <span className="text-accent-400">↗</span>
          </h1>
          <p className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
            relay client / v1 <span className="text-accent-400">· {profile.name}</span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ModeSwitch mode={mode} onChange={onModeChange} />
        <button
          type="button"
          onClick={onOpenProfiles}
          aria-label={`Профиль ${profile.name}: открыть список профилей`}
          title={profile.name}
          className="flex size-9 shrink-0 items-center justify-center border text-[11px] font-bold transition hover:border-accent-400/70"
          style={{
            borderColor: `${profile.color}66`,
            color: profile.color,
            background: "#0b0b0a",
          }}
        >
          {profileInitials(profile.name)}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Настройки"
          className="flex size-9 items-center justify-center border border-white/15 bg-ink-950 text-zinc-400 transition hover:border-white/30 hover:text-white"
        >
          <Settings className="size-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
