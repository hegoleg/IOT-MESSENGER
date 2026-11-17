const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

const shortDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
});

const dayFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
});

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Stable key for grouping chat messages by calendar day. */
export function dayKey(tsSeconds?: number): string {
  if (!tsSeconds) return "unknown";
  return String(startOfDay(new Date(tsSeconds * 1000)));
}

/** "Сегодня", "Вчера" or "5 ноября" for a message timestamp. */
export function formatDayLabel(tsSeconds?: number): string {
  if (!tsSeconds) return "";
  const date = new Date(tsSeconds * 1000);
  const day = startOfDay(date);
  const today = startOfDay(new Date());
  if (day === today) return "Сегодня";

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === startOfDay(yesterday)) return "Вчера";

  return dayFormatter.format(date);
}

/** "14:32" for today, "05.11, 14:32" otherwise. Input is Unix seconds. */
export function formatTime(tsSeconds?: number): string {
  if (!tsSeconds) return "";
  const date = new Date(tsSeconds * 1000);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? timeFormatter.format(date)
    : `${shortDateFormatter.format(date)}, ${timeFormatter.format(date)}`;
}

/** "только что", "5 мин назад", "3 ч назад" or a short date. Input is ms or seconds. */
export function formatRelative(ts?: number): string {
  if (!ts) return "нет данных";
  const ms = ts > 1_000_000_000_000 ? ts : ts * 1000;
  const diff = Date.now() - ms;

  if (diff < 60_000) return "только что";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`;
  return shortDateFormatter.format(new Date(ms));
}

/** Shortens long tokens for display: "AbCdEf…XyZ123". */
export function truncateMiddle(value: string, head = 6, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
