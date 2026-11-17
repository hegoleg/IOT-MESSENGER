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
 * One chat message in the landing's dark-room style: device messages are warm
 * dark panels with an orange signal, user messages are solid warm-paper blocks.
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
        <div className="min-w-0 max-w-[85%] bg-[#e6dfd0] px-3 py-2 text-[#191612]">
          <div className="mb-1 flex items-center justify-end gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#74634d]">
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
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center border border-white/10 bg-ink-850 text-accent-400"
      >
        <Cpu className="size-3.5" />
      </div>
      <div className="min-w-0 max-w-[85%] bg-[#302c25] px-3 py-2">
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
        <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[#f2f0eb]">
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
