import { describe, expect, it } from "vitest";
import { dayKey, formatDayLabel, formatRelative, formatTime } from "./format";

function toSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

describe("formatTime", () => {
  it("shows only the time for today", () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5);
    expect(formatTime(toSeconds(today))).toBe("09:05");
  });

  it("prefixes the date for other days", () => {
    expect(formatTime(toSeconds(new Date(2024, 0, 2, 9, 5)))).toContain("02.01");
  });

  it("returns an empty string without a timestamp", () => {
    expect(formatTime(undefined)).toBe("");
  });
});

describe("day helpers", () => {
  it("groups different times of the same day", () => {
    const morning = new Date(2025, 4, 10, 8, 0);
    const evening = new Date(2025, 4, 10, 23, 0);
    expect(dayKey(toSeconds(morning))).toBe(dayKey(toSeconds(evening)));
  });

  it("separates different days", () => {
    const first = new Date(2025, 4, 10, 23, 59);
    const second = new Date(2025, 4, 11, 0, 1);
    expect(dayKey(toSeconds(first))).not.toBe(dayKey(toSeconds(second)));
  });

  it("labels today and yesterday", () => {
    expect(formatDayLabel(toSeconds(new Date()))).toBe("Сегодня");

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatDayLabel(toSeconds(yesterday))).toBe("Вчера");
  });
});

describe("formatRelative", () => {
  it("describes a fresh timestamp", () => {
    expect(formatRelative(Date.now())).toBe("только что");
  });

  it("accepts both milliseconds and seconds", () => {
    const fiveMinutesAgo = Date.now() - 5 * 60_000;
    expect(formatRelative(fiveMinutesAgo)).toBe("5 мин назад");
    expect(formatRelative(Math.floor(fiveMinutesAgo / 1000))).toBe("5 мин назад");
  });

  it("falls back for missing values", () => {
    expect(formatRelative(undefined)).toBe("нет данных");
  });
});
