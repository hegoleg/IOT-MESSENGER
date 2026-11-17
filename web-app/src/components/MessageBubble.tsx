import { Cpu } from "lucide-react";
import type { MsgPacket } from "@iot/shared";
import { formatTime } from "../lib/format";
import InlineKeyboard from "./InlineKeyboard";

export interface MessageBubbleProps {
  message: MsgPacket;
  onCallback(messageId: string, data: string): void;
  disabled?: boolean;
}

/**
 * One chat message in the instrument-panel style: device messages are dark
 * panels with a signal-lime edge, user messages are solid lime blocks.
 */
export default function MessageBubble({
  message,
  onCallback,
  disabled = false,
}: MessageBubbleProps) {
  const isUser = message.from === "usr";
  const time = formatTime(message.ts);
  const keyboard = !isUser && message.kb && message.kb.length > 0 ? message.kb : null;

  if (isUser) {
    return (
      <div className="flex animate-fade-in justify-end">
        <div className="min-w-0 max-w-[85%] border border-accent-400 bg-accent-400 px-3 py-2 text-ink-950">
          <div className="mb-1 flex items-center justify-end gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-950/60">
            <span>usr</span>
            {time ? (
              <>
                <span aria-hidden="true">/</span>
                <span className="tabular-nums">{time}</span>
              </>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
            {message.text}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex animate-fade-in items-start gap-2">
      <div
        aria-hidden="true"
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center border border-white/10 bg-ink-900 text-accent-400"
      >
        <Cpu className="size-3.5" />
      </div>
      <div className="min-w-0 max-w-[85%] border border-white/10 border-l-2 border-l-accent-400 bg-ink-900/90 px-3 py-2">
        <div className="mb-1 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">
          <span className="text-accent-400">dev</span>
          {time ? (
            <>
              <span className="text-zinc-700" aria-hidden="true">
                /
              </span>
              <span className="tabular-nums text-zinc-500">{time}</span>
            </>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-zinc-100">
          {message.text}
        </p>
        {keyboard ? (
          <div className="mt-2">
            <InlineKeyboard
              keyboard={keyboard}
              disabled={disabled}
              onPress={(data) => onCallback(message.id, data)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
