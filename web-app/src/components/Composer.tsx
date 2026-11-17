import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";

export interface ComposerProps {
  disabled: boolean;
  onSend(text: string): boolean;
}

/** Height of the textarea is clamped to four `leading-6` lines. */
const MAX_LINES = 4;
const FALLBACK_LINE_HEIGHT = 24;

export default function Composer({ disabled, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabled && text.trim().length > 0;

  // Auto-grow between one and MAX_LINES lines.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const styles = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(styles.lineHeight) || FALLBACK_LINE_HEIGHT;
    const verticalPadding =
      (Number.parseFloat(styles.paddingTop) || 0) +
      (Number.parseFloat(styles.paddingBottom) || 0);
    const maxHeight = lineHeight * MAX_LINES + verticalPadding;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [text]);

  function submit() {
    const value = text.trim();
    if (!value || disabled) return;

    // Keep the draft when the transport refuses the message.
    if (!onSend(value)) return;

    setText("");
    // Re-focus after a successful send so the mobile keyboard stays open.
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    submit();
  }

  return (
    <div className="safe-bottom flex items-end gap-2 px-3 pt-2">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        maxLength={512}
        placeholder="Сообщение или /команда"
        aria-label="Сообщение или /команда"
        enterKeyHint="send"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        className="field min-h-11 min-w-0 flex-1 resize-none px-3 py-2.5 text-[14px] leading-6 disabled:opacity-60"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!canSend}
        aria-label="Отправить"
        className="flex size-11 shrink-0 items-center justify-center border border-accent-400 bg-accent-400 text-ink-950 transition hover:bg-accent-300 active:translate-y-px disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-ink-800 disabled:text-zinc-600"
      >
        <ArrowUp className="size-4" strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
  );
}
