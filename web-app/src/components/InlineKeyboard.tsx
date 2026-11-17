import type { IBKeyboard } from "@iot/shared";

export interface InlineKeyboardProps {
  keyboard: IBKeyboard;
  onPress(data: string): void;
  disabled?: boolean;
}

/**
 * Inline keyboard rendered as a keypad grid: hairline separators, square
 * keys, monospaced labels. The relay already enforces the 3x3 limit.
 */
export default function InlineKeyboard({
  keyboard,
  onPress,
  disabled = false,
}: InlineKeyboardProps) {
  if (keyboard.length === 0) return null;

  return (
    <div className="flex flex-col gap-px border border-white/10 bg-white/10">
      {keyboard.map((row, rowIndex) => (
        <div key={rowIndex} className="flex gap-px">
          {row.map((button, buttonIndex) => (
            <button
              key={`${rowIndex}-${buttonIndex}-${button.d}`}
              type="button"
              disabled={disabled}
              onClick={() => onPress(button.d)}
              className="min-h-10 min-w-0 flex-1 bg-ink-850 px-2 py-2 text-center font-mono text-[10px] font-medium uppercase leading-tight tracking-[0.06em] break-words text-accent-300 transition hover:bg-ink-700 active:bg-ink-600 disabled:cursor-not-allowed disabled:text-zinc-600"
            >
              {button.t}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
