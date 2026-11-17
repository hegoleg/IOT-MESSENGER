import { Cloud, Wifi } from "lucide-react";
import type { ConnectionMode } from "../lib/types";

export interface ModeSwitchProps {
  mode: ConnectionMode;
  onChange(mode: ConnectionMode): void;
}

const OPTIONS: Array<{
  value: ConnectionMode;
  label: string;
  icon: typeof Cloud;
}> = [
  { value: "cloud", label: "Облако", icon: Cloud },
  { value: "local", label: "Локально", icon: Wifi },
];

export default function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  return (
    <div
      className="flex shrink-0 items-center border border-white/15 bg-ink-950 p-0.5"
      role="radiogroup"
      aria-label="Режим подключения"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => onChange(value)}
            className={`flex min-h-8 items-center gap-1.5 px-2 font-mono text-[9px] font-bold uppercase tracking-[0.1em] transition ${
              active
                ? "bg-accent-400 text-ink-950"
                : "text-zinc-500 hover:text-zinc-200"
            }`}
          >
            <Icon className="size-3" aria-hidden="true" />
            <span className="hidden min-[360px]:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
