export interface QuickCommandsProps {
  disabled: boolean;
  onSend(text: string): void;
}

const COMMANDS = ["/start", "/status", "/on", "/off", "/stop"] as const;

/** One-tap commands, styled as monospaced console chips. */
export default function QuickCommands({ disabled, onSend }: QuickCommandsProps) {
  return (
    <div
      role="group"
      aria-label="Быстрые команды"
      className="flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-3 pb-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {COMMANDS.map((command) => (
        <button
          key={command}
          type="button"
          disabled={disabled}
          onClick={() => onSend(command)}
          className="min-h-9 shrink-0 snap-start border border-white/15 bg-ink-950 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-400 transition hover:border-accent-400/60 hover:text-accent-300 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
        >
          {command}
        </button>
      ))}
    </div>
  );
}
