// Pure business-day calculation logic for 1B-3 (business_days_between /
// add_business_days). Deliberately separated from D1 access (../tools/
// business-days.ts owns the D1 queries) so every rule here is a plain
// function over in-memory data — testable without miniflare, and reviewable
// as the single place the confirmed semantics (docs/architecture/
// business-day-semantics.md) actually live in code.
//
// All date arithmetic goes through ./dates.ts (`addDaysIso` etc.) — never
// `Date` objects directly — per the 1B-3 禁止事項 (no timezone-dependent Date
// math).

import { addDaysIso, isWeekendDate, weekdayOf } from "./dates.js";

export type Calendar = "standard" | "banking";

export function isCalendar(value: string): value is Calendar {
  return value === "standard" || value === "banking";
}

/** One entry of `add_business_days`'s `skipped` list. */
export interface SkippedDay {
  date: string;
  reason: string;
}

// banking カレンダー固有の休業日: 銀行法第十五条 / 銀行法施行令第五条
// （docs/architecture/business-day-semantics.md 参照）。「12/31から翌年1/3まで」
// のうち 1/1 は国民の祝日（元日）として既に holidayNames 側で除外されるため、
// ここでは残り3日 (12/31, 1/2, 1/3) だけを機械的に判定すればよい。月日部分
// （"MM-DD"）だけの比較にすることで、西暦年に関係なく毎年同じ3日を弾ける。
const BANKING_EXTRA_MMDD = new Set(["12-31", "01-02", "01-03"]);

function isBankingExtraClosure(dateStr: string): boolean {
  return BANKING_EXTRA_MMDD.has(dateStr.slice(5));
}

/**
 * The single rule function every "is this day closed?" decision in 1B-3 goes
 * through — used both for the boolean is-business-day check and for building
 * a human-readable `skipped[].reason`, so the two can never disagree on
 * ordering/priority. Returns `null` when `dateStr` IS a business day.
 *
 * Priority (first match wins, matches the intuitive "why is this day off"
 * explanation a caller would give): 土日 → 国民の祝日 → banking固有休業日 →
 * extra_closed_dates.
 */
export function closureReason(
  dateStr: string,
  holidayNames: ReadonlyMap<string, string>,
  calendar: Calendar,
  extraClosed: ReadonlySet<string>,
): string | null {
  if (isWeekendDate(dateStr)) {
    return weekdayOf(dateStr) === "土" ? "土曜日" : "日曜日";
  }
  const holidayName = holidayNames.get(dateStr);
  if (holidayName !== undefined) {
    return `祝日: ${holidayName}`;
  }
  if (calendar === "banking" && isBankingExtraClosure(dateStr)) {
    return "銀行休業日(12/31〜1/3, 銀行法施行令第5条)";
  }
  if (extraClosed.has(dateStr)) {
    return "指定休業日(extra_closed_dates)";
  }
  return null;
}

export function isBusinessDay(
  dateStr: string,
  holidayNames: ReadonlyMap<string, string>,
  calendar: Calendar,
  extraClosed: ReadonlySet<string>,
): boolean {
  return closureReason(dateStr, holidayNames, calendar, extraClosed) === null;
}

// ---------------------------------------------------------------------------
// add_business_days
// ---------------------------------------------------------------------------

/** `skipped` is truncated at this many entries; `skippedTotal` carries the true count. */
export const MAX_SKIPPED_LISTED = 20;

export interface AddBusinessDaysResult {
  result: string;
  skipped: SkippedDay[];
  skippedTotal: number;
}

/**
 * Walks forward (days > 0) or backward (days < 0) from `dateStr`, one calendar
 * day at a time, counting business days until `|days|` of them have been
 * found. `dateStr` itself is never counted (1B-3 意味論: 「dateの翌日から数えて
 * days番目」). Every non-business day walked over is recorded in `skipped`
 * (capped at `MAX_SKIPPED_LISTED`, full count in `skippedTotal`).
 *
 * Caller contract: `holidayNames` MUST cover every date this walk can touch —
 * ../tools/business-days.ts guarantees this by querying D1 for a
 * generously-estimated span and refusing to call this function at all
 * (`out_of_data_range`) if that span isn't fully inside the ingested data
 * range. `days === 0` is rejected by the tool handler before this is called
 * (this function has no defined behaviour for it).
 */
export function addBusinessDays(
  dateStr: string,
  days: number,
  holidayNames: ReadonlyMap<string, string>,
  calendar: Calendar,
  extraClosed: ReadonlySet<string>,
): AddBusinessDaysResult {
  const direction = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);
  let cursor = dateStr;
  const skipped: SkippedDay[] = [];
  let skippedTotal = 0;

  while (remaining > 0) {
    cursor = addDaysIso(cursor, direction);
    const reason = closureReason(cursor, holidayNames, calendar, extraClosed);
    if (reason === null) {
      remaining--;
    } else {
      skippedTotal++;
      if (skipped.length < MAX_SKIPPED_LISTED) {
        skipped.push({ date: cursor, reason });
      }
    }
  }

  return { result: cursor, skipped, skippedTotal };
}

// ---------------------------------------------------------------------------
// business_days_between
// ---------------------------------------------------------------------------

/**
 * Counts business days strictly between the caller-chosen boundaries.
 * Implemented as "shrink [from,to] by one day on whichever end is excluded,
 * then count inclusively" — e.g. the default (include_from=false,
 * include_to=true) counts business days in `(from, to]`. If the shrunk range
 * is empty (startBoundary > endBoundary — e.g. from === to under the
 * defaults), the count is 0, never negative.
 *
 * Caller contract: same as {@link addBusinessDays} — `holidayNames` must
 * cover `[from, to]` in full.
 */
export function countBusinessDays(
  from: string,
  to: string,
  includeFrom: boolean,
  includeTo: boolean,
  holidayNames: ReadonlyMap<string, string>,
  calendar: Calendar,
  extraClosed: ReadonlySet<string>,
): number {
  const startBoundary = includeFrom ? from : addDaysIso(from, 1);
  const endBoundary = includeTo ? to : addDaysIso(to, -1);
  if (startBoundary > endBoundary) return 0;

  let count = 0;
  let cursor = startBoundary;
  while (cursor <= endBoundary) {
    if (isBusinessDay(cursor, holidayNames, calendar, extraClosed)) count++;
    cursor = addDaysIso(cursor, 1);
  }
  return count;
}
