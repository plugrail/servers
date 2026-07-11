// Shared calendar-date utilities — extracted from 1B-2's tools/holidays.ts so
// 1B-3 (calendar.ts / tools/business-days.ts) doesn't duplicate them (1B-2's
// explicit 申し送り: "コピペせず共有モジュールへ抽出してから使う").
//
// Every date here is a "civil" YYYY-MM-DD string with no time-of-day
// component. All arithmetic goes through `Date.UTC` / `getUTC*` explicitly —
// never `new Date(dateStr)` (implicit parsing, which historically differs
// between date-only and datetime strings) or local getters (`getDate()` etc,
// which read the *host*'s timezone). Using UTC explicitly is NOT
// timezone-dependent: UTC has no DST/offset ambiguity, so this is "calendar-date
// string arithmetic" in effect, just implemented via Date.UTC rather than
// hand-rolled day-count math (see also the equivalent comment this replaces in
// tools/holidays.ts).

import { err, type FailureResult, type ToolContext } from "@plugrail/core";

// ---------------------------------------------------------------------------
// Parsing / validation.
// ---------------------------------------------------------------------------

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;
export type WeekdayJa = (typeof WEEKDAY_JA)[number];

// Fixed-width "YYYY-MM-DD" slicing (not split + array-destructure) so this
// type-checks cleanly under `noUncheckedIndexedAccess` — callers only rely on
// the numeric result after `DATE_RE` has already confirmed the shape.
export function parseIsoParts(value: string): { y: number; m: number; d: number } {
  return {
    y: Number(value.slice(0, 4)),
    m: Number(value.slice(5, 7)),
    d: Number(value.slice(8, 10)),
  };
}

/** True iff `value` is `YYYY-MM-DD` AND names a real calendar date (rejects e.g. "2026-02-30"). */
export function isValidIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const { y, m, d } = parseIsoParts(value);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// ---------------------------------------------------------------------------
// Weekday / arithmetic.
// ---------------------------------------------------------------------------

export function dayOfWeek(dateStr: string): number {
  const { y, m, d } = parseIsoParts(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function weekdayOf(dateStr: string): WeekdayJa {
  return WEEKDAY_JA[dayOfWeek(dateStr)] as WeekdayJa;
}

export function isWeekendDate(dateStr: string): boolean {
  const dow = dayOfWeek(dateStr);
  return dow === 0 || dow === 6;
}

/** `dateStr` shifted forward by `years` calendar years, as an ISO string. */
export function addYearsIso(dateStr: string, years: number): string {
  const { y, m, d } = parseIsoParts(dateStr);
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

/**
 * `dateStr` shifted by `days` calendar days (may be negative), as an ISO
 * string. New in 1B-3 — the one primitive `calendar.ts`'s business-day walk
 * is built on.
 */
export function addDaysIso(dateStr: string, days: number): string {
  const { y, m, d } = parseIsoParts(dateStr);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// D1 data-range helpers (1B-2's is_holiday/list_holidays pattern, reused
// as-is by 1B-3's business-day tools).
// ---------------------------------------------------------------------------

export interface DataRange {
  min: string;
  max: string;
}

/** The CSV's covered date span, or `null` if `holidays` is still empty (pre-ingest). */
export async function getDataRange(db: D1Database): Promise<DataRange | null> {
  const row = await db
    .prepare("SELECT MIN(date) AS min, MAX(date) AS max FROM holidays")
    .first<{ min: string | null; max: string | null }>();
  if (!row?.min || !row?.max) return null;
  return { min: row.min, max: row.max };
}

export function outOfRangeError(range: DataRange | null): FailureResult {
  if (range === null) {
    return err({
      code: "out_of_data_range",
      message: "祝日データが未取込のため判定できません。",
      hint: "データの取込（ingest）が完了してから再実行してください。",
    });
  }
  return err({
    code: "out_of_data_range",
    message: "指定された日付・期間はデータ収録範囲外です。",
    hint: `内閣府CSVの収録範囲は${range.min}〜${range.max}です。この範囲で再実行してください`,
  });
}

/** `holidays` table's D1 binding, from a tool handler's `ctx` (1B-1's `Env.DB`). */
export function dbOf(ctx: ToolContext): D1Database {
  return (ctx.env as Env).DB;
}
