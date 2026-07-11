// business_days_between / add_business_days — 1B-3's core-value tools.
//
// Both delegate the actual rule (what counts as a business day, the walk /
// range-count algorithms) to the pure functions in ../calendar.ts; this file
// only does input validation, D1 access (holiday lookups + data-range
// checks), and shaping the 封筒 response. See docs/architecture/
// business-day-semantics.md for the confirmed semantics this file must not
// deviate from (禁止事項: 意味論を実装の都合で変えない).
//
// Same `inputSchema` looseness rationale as ../tools/holidays.ts: zod
// validation failures at the SDK level bypass the 封筒 entirely, so every
// field here stays a bare `z.string()` / `z.number()` / `z.boolean()` /
// `z.array(z.string())` with all real validation (format, days !== 0,
// from <= to, calendar enum, extra_closed_dates entries) done inside the
// handler via `err()`.

import { defineTool, err, ok, type SourceKey, type ToolContext } from "@plugrail/core";
import { z } from "zod";
import { addBusinessDays, type Calendar, countBusinessDays, isCalendar } from "../calendar.js";
import {
  addDaysIso,
  dbOf,
  getDataRange,
  isValidIsoDate,
  outOfRangeError,
  weekdayOf,
} from "../dates.js";
import { latestOkRunTimestamp } from "../ingest/store.js";

// ---------------------------------------------------------------------------
// Shared validation / formatting helpers.
// ---------------------------------------------------------------------------

function invalidCalendarError() {
  return err({
    code: "invalid_input",
    message: 'calendar は "standard" または "banking" のいずれかで指定してください。',
    hint: '入力例: {"calendar": "banking"}（省略時は "standard"）',
  });
}

type ExtraClosedResult = { ok: true; set: Set<string> } | { ok: false; bad: string };

/** Validates every `extra_closed_dates` entry, short-circuiting on the first bad one. */
function validateExtraClosedDates(values: readonly string[] | undefined): ExtraClosedResult {
  const list = values ?? [];
  for (const value of list) {
    if (!isValidIsoDate(value)) return { ok: false, bad: value };
  }
  return { ok: true, set: new Set(list) };
}

function invalidExtraClosedError(bad: string) {
  return err({
    code: "invalid_input",
    message: "extra_closed_dates の各要素は YYYY-MM-DD 形式の実在する日付で指定してください。",
    hint: `不正な値: "${bad}"`,
  });
}

function sourcesFor(calendar: Calendar): readonly [SourceKey, ...SourceKey[]] {
  return calendar === "banking"
    ? ["cabinet_office_holidays", "banking_holiday_law"]
    : ["cabinet_office_holidays"];
}

function excludeLabel(calendar: Calendar): string {
  return calendar === "banking" ? "土日祝・銀行休業日を除く" : "土日祝を除く";
}

async function fetchHolidayMap(
  db: D1Database,
  from: string,
  to: string,
): Promise<Map<string, string>> {
  const { results } = await db
    .prepare("SELECT date, name FROM holidays WHERE date BETWEEN ?1 AND ?2")
    .bind(from, to)
    .all<{ date: string; name: string }>();
  return new Map(results.map((r) => [r.date, r.name]));
}

async function dataAsOfMeta(db: D1Database): Promise<{ data_as_of?: string }> {
  const dataAsOf = await latestOkRunTimestamp(db);
  return dataAsOf !== null ? { data_as_of: dataAsOf } : {};
}

// ---------------------------------------------------------------------------
// add_business_days
// ---------------------------------------------------------------------------

// A generous calendar-day span estimate for "how far might we need to walk to
// find |days| business days" — used ONLY to decide how wide a D1 query to
// issue (and whether that query would even stay inside the ingested holiday
// range). 1.6x accounts for weekends (a business week is 5/7 of a calendar
// week, i.e. a 1.4x expansion) plus headroom for holidays landing on
// weekdays; the flat +30 covers extra_closed_dates / banking closures without
// materially affecting small requests. If this guess ever turns out
// insufficient (the walk's result lands outside the queried window), the
// handler refuses with out_of_data_range rather than silently trusting an
// under-fetched holiday set (禁止事項「将来年の計算結果を返さない」の精神を延長).
function estimateSpanDays(magnitude: number): number {
  return Math.ceil(magnitude * 1.6) + 30;
}

export const addBusinessDaysTool = defineTool({
  name: "add_business_days",
  description:
    "指定した日付(date)の翌日から数えてN営業日目(days)の日付を返します。dateの当日は数えません。" +
    "daysが負の場合は過去方向（dateの前日から遡ってN営業日目）に計算します。" +
    '土日・日本の祝日を除外し、calendar="banking"を指定すると銀行休業日（12/31〜1/3）も除外します。' +
    "dateが営業日かどうかだけ知りたい場合は is_holiday を使ってください。" +
    '入力例: {"date": "2026-07-10", "days": 3}',
  inputSchema: {
    date: z.string().describe('起点日 YYYY-MM-DD。例: "2026-07-10"。この日自体は数えません。'),
    days: z
      .number()
      .describe("何営業日先(正)/前(負)かを表す整数。0は不可（is_holidayまたはdays=1を使用）。"),
    calendar: z
      .string()
      .optional()
      .describe('"standard"（既定）または"banking"（銀行休業日も除外）。'),
    extra_closed_dates: z
      .array(z.string())
      .optional()
      .describe('顧客固有の追加休業日（YYYY-MM-DD の配列）。例: ["2026-12-29", "2026-12-30"]'),
  },
  handler: async (input, ctx: ToolContext) => {
    const { date, days, calendar: calendarInput, extra_closed_dates } = input;

    if (!isValidIsoDate(date)) {
      return err({
        code: "invalid_input",
        message: "date は YYYY-MM-DD 形式の実在する日付で指定してください。",
        hint: '入力例: {"date": "2026-07-10", "days": 3}',
      });
    }
    if (!Number.isInteger(days)) {
      return err({
        code: "invalid_input",
        message: "days は整数で指定してください。",
        hint: '入力例: {"date": "2026-07-10", "days": 3}',
      });
    }
    if (days === 0) {
      return err({
        code: "invalid_input",
        message: "days に 0 は指定できません。",
        hint: "dateが営業日か知りたい場合は is_holiday を、次の営業日が欲しい場合は days=1 を使ってください。",
      });
    }

    const calendar = calendarInput ?? "standard";
    if (!isCalendar(calendar)) {
      return invalidCalendarError();
    }

    const extraClosedResult = validateExtraClosedDates(extra_closed_dates);
    if (!extraClosedResult.ok) return invalidExtraClosedError(extraClosedResult.bad);
    const extraClosed = extraClosedResult.set;

    const db = dbOf(ctx);
    const range = await getDataRange(db);
    if (range === null || date < range.min || date > range.max) {
      return outOfRangeError(range);
    }

    const direction: 1 | -1 = days > 0 ? 1 : -1;
    const magnitude = Math.abs(days);
    const spanGuess = estimateSpanDays(magnitude);
    const boundary = addDaysIso(date, direction * spanGuess);
    const boundaryOutOfRange = direction > 0 ? boundary > range.max : boundary < range.min;
    if (boundaryOutOfRange) {
      return outOfRangeError(range);
    }

    const queryFrom = direction > 0 ? date : boundary;
    const queryTo = direction > 0 ? boundary : date;
    const holidayNames = await fetchHolidayMap(db, queryFrom, queryTo);

    const { result, skipped, skippedTotal } = addBusinessDays(
      date,
      days,
      holidayNames,
      calendar,
      extraClosed,
    );

    // Safety net for the (practically unreachable, given estimateSpanDays'
    // margin) case where the guessed span still wasn't wide enough — the
    // walk would have consulted holiday data we never fetched.
    if (result < queryFrom || result > queryTo) {
      return outOfRangeError(range);
    }

    const dataAsOf = await dataAsOfMeta(db);
    const summary =
      `${date}(${weekdayOf(date)})の${magnitude}営業日${days > 0 ? "後" : "前"}は` +
      `${result}(${weekdayOf(result)})です（${excludeLabel(calendar)}・カレンダー: ${calendar}）`;

    return ok(
      {
        result,
        input_date: date,
        days,
        calendar,
        skipped,
        skipped_total: skippedTotal,
      },
      {
        sources: sourcesFor(calendar),
        fetched_at: new Date().toISOString(),
        ...dataAsOf,
      },
      summary,
    );
  },
});

// ---------------------------------------------------------------------------
// business_days_between
// ---------------------------------------------------------------------------

export const businessDaysBetweenTool = defineTool({
  name: "business_days_between",
  description:
    "from〜to間の営業日数を数えます。既定では「fromを含まず、toを含む」境界です" +
    "（例:「今日から支払期日まで何営業日か」）。include_from/include_toで境界を変更できます。" +
    '土日・日本の祝日を除外し、calendar="banking"を指定すると銀行休業日（12/31〜1/3）も除外します。' +
    "from > to はエラーになります（負の期間は未対応）。" +
    '入力例: {"from": "2026-07-10", "to": "2026-07-20"}',
  inputSchema: {
    from: z.string().describe('起点日 YYYY-MM-DD。例: "2026-07-10"。'),
    to: z.string().describe('終点日 YYYY-MM-DD。例: "2026-07-20"。fromより前の日付は不可。'),
    calendar: z
      .string()
      .optional()
      .describe('"standard"（既定）または"banking"（銀行休業日も除外）。'),
    extra_closed_dates: z
      .array(z.string())
      .optional()
      .describe('顧客固有の追加休業日（YYYY-MM-DD の配列）。例: ["2026-12-29", "2026-12-30"]'),
    include_from: z.boolean().optional().describe("fromを営業日数に含めるか。既定はfalse。"),
    include_to: z.boolean().optional().describe("toを営業日数に含めるか。既定はtrue。"),
  },
  handler: async (input, ctx: ToolContext) => {
    const {
      from,
      to,
      calendar: calendarInput,
      extra_closed_dates,
      include_from,
      include_to,
    } = input;

    if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
      return err({
        code: "invalid_input",
        message: "from / to は YYYY-MM-DD 形式の実在する日付で指定してください。",
        hint: '入力例: {"from": "2026-07-10", "to": "2026-07-20"}',
      });
    }
    if (from > to) {
      return err({
        code: "invalid_input",
        message: "from は to 以前の日付にしてください。",
        hint: "from/toを入れ替えるか、from <= to となるよう指定し直してください（負の期間は未対応です）。",
      });
    }

    const calendar = calendarInput ?? "standard";
    if (!isCalendar(calendar)) {
      return invalidCalendarError();
    }

    const extraClosedResult = validateExtraClosedDates(extra_closed_dates);
    if (!extraClosedResult.ok) return invalidExtraClosedError(extraClosedResult.bad);
    const extraClosed = extraClosedResult.set;

    const includeFrom = include_from ?? false;
    const includeTo = include_to ?? true;

    const db = dbOf(ctx);
    const range = await getDataRange(db);
    if (range === null || from < range.min || to > range.max) {
      return outOfRangeError(range);
    }

    const holidayNames = await fetchHolidayMap(db, from, to);
    const businessDays = countBusinessDays(
      from,
      to,
      includeFrom,
      includeTo,
      holidayNames,
      calendar,
      extraClosed,
    );

    const dataAsOf = await dataAsOfMeta(db);
    const boundaryLabel = `from${includeFrom ? "含む" : "含まず"}・to${includeTo ? "含む" : "含まず"}`;
    const summary =
      `${from}〜${to}の営業日数は${businessDays}日です` +
      `（${boundaryLabel}・${excludeLabel(calendar)}・カレンダー: ${calendar}）`;

    return ok(
      {
        business_days: businessDays,
        from,
        to,
        include_from: includeFrom,
        include_to: includeTo,
        calendar,
      },
      {
        sources: sourcesFor(calendar),
        fetched_at: new Date().toISOString(),
        ...dataAsOf,
      },
      summary,
    );
  },
});
