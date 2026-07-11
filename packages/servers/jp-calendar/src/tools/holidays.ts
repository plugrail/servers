// is_holiday / list_holidays — the first real jp-calendar tools (1B-2).
//
// Both tools read the `holidays` table 1B-1's ingest pipeline populates (the
// CSV rows themselves are the only source of truth — no holiday is ever
// computed in code here, per the 1B-2 禁止事項). `data_as_of` comes from
// `ingest_runs`' latest status="ok" row (see ../ingest/store.ts).
//
// Input validation is deliberately done INSIDE each handler rather than via a
// strict zod schema (`.regex()` / `.refine()`) at `inputSchema` level: the MCP
// SDK rejects schema-invalid `tools/call` arguments before a tool's handler
// ever runs (throws `McpError(InvalidParams)`, see
// node_modules/@modelcontextprotocol/sdk/.../server/mcp.js `safeParseAsync`),
// which bypasses `packages/core`'s envelope entirely — no `ok:false` with our
// `invalid_input` code, no disclaimer. Keeping `inputSchema` loose (`z.string()`
// / `z.number()`, no format constraints) guarantees every malformed input
// (wrong format, non-existent calendar date, empty string) still goes through
// `err()` and comes back as a proper 封筒.

import { defineTool, err, ok } from "@plugrail/core";
import { z } from "zod";
import {
  addYearsIso,
  dbOf,
  getDataRange,
  isValidIsoDate,
  isWeekendDate,
  outOfRangeError,
  parseIsoParts,
  weekdayOf,
} from "../dates.js";
import { latestOkRunTimestamp } from "../ingest/store.js";

// Date helpers (isValidIsoDate / weekdayOf / isWeekendDate / addYearsIso /
// parseIsoParts / getDataRange / outOfRangeError / dbOf) moved to ../dates.ts
// in 1B-3 so business-days.ts can share them instead of copy-pasting (1B-2's
// 申し送り to 1B-3).

const MAX_RANGE_YEARS = 5;

// ---------------------------------------------------------------------------
// is_holiday
// ---------------------------------------------------------------------------

export const isHolidayTool = defineTool({
  name: "is_holiday",
  description:
    "指定した日付が日本の祝日（国民の祝日・休日）かどうかを判定します。内閣府公表データに基づきます。" +
    '入力例: {"date": "2026-01-01"}',
  inputSchema: {
    date: z.string().describe('YYYY-MM-DD形式の日付。例: "2026-01-01"'),
  },
  handler: async (input, ctx) => {
    const { date } = input;
    if (!isValidIsoDate(date)) {
      return err({
        code: "invalid_input",
        message: "date は YYYY-MM-DD 形式の実在する日付で指定してください。",
        hint: '入力例: {"date": "2026-01-01"}',
      });
    }

    const db = dbOf(ctx);
    const range = await getDataRange(db);
    if (range === null || date < range.min || date > range.max) {
      return outOfRangeError(range);
    }

    const row = await db
      .prepare("SELECT name FROM holidays WHERE date = ?1")
      .bind(date)
      .first<{ name: string }>();
    const holidayName = row?.name ?? null;
    const weekday = weekdayOf(date);
    const dataAsOf = await latestOkRunTimestamp(db);

    return ok(
      {
        date,
        is_holiday: holidayName !== null,
        holiday_name: holidayName,
        weekday,
        is_weekend: isWeekendDate(date),
      },
      {
        sources: ["cabinet_office_holidays"],
        fetched_at: new Date().toISOString(),
        ...(dataAsOf !== null ? { data_as_of: dataAsOf } : {}),
      },
      holidayName !== null
        ? `${date}（${weekday}）は祝日「${holidayName}」です`
        : `${date}（${weekday}）は祝日ではありません`,
    );
  },
});

// ---------------------------------------------------------------------------
// list_holidays
// ---------------------------------------------------------------------------

function formatMonthDay(dateStr: string): string {
  const { m, d } = parseIsoParts(dateStr);
  return `${m}/${d}`;
}

function buildListSummary(
  periodLabel: string,
  holidays: ReadonlyArray<{ date: string; name: string }>,
): string {
  const count = holidays.length;
  if (count === 0) {
    return `${periodLabel}の祝日は0件です`;
  }
  const maxShown = 5;
  const shown = holidays
    .slice(0, maxShown)
    .map((h) => `${h.name}(${formatMonthDay(h.date)})`)
    .join(", ");
  const suffix = count > maxShown ? "、…" : "";
  return `${periodLabel}の祝日は${count}件です: ${shown}${suffix}`;
}

export const listHolidaysTool = defineTool({
  name: "list_holidays",
  description:
    "指定した年または期間の日本の祝日一覧を返します。" +
    '入力例: {"year": 2026} または {"from": "2026-01-01", "to": "2026-06-30"}',
  inputSchema: {
    year: z.number().int().optional().describe("西暦年。例: 2026。from/toとは併用不可。"),
    from: z
      .string()
      .optional()
      .describe('期間開始日 YYYY-MM-DD。例: "2026-01-01"。yearとは併用不可。'),
    to: z
      .string()
      .optional()
      .describe('期間終了日 YYYY-MM-DD。例: "2026-06-30"。yearとは併用不可。'),
  },
  handler: async (input, ctx) => {
    const { year, from, to } = input;
    const hasYear = year !== undefined;
    const hasRange = from !== undefined || to !== undefined;

    if (hasYear && hasRange) {
      return err({
        code: "invalid_input",
        message: "year と from/to は同時に指定できません。",
        hint: "year のみ、または from と to のペアのみを指定してください。",
      });
    }
    if (!hasYear && !hasRange) {
      return err({
        code: "invalid_input",
        message: "year または from/to のいずれかを指定してください。",
        hint: '入力例: {"year": 2026} または {"from": "2026-01-01", "to": "2026-06-30"}',
      });
    }

    let fromDate: string;
    let toDate: string;
    let periodLabel: string;

    if (hasYear) {
      if (!Number.isInteger(year) || year < 1 || year > 9999) {
        return err({
          code: "invalid_input",
          message: "year は西暦の整数で指定してください。",
          hint: '入力例: {"year": 2026}',
        });
      }
      const y = String(year).padStart(4, "0");
      fromDate = `${y}-01-01`;
      toDate = `${y}-12-31`;
      periodLabel = `${year}年`;
    } else {
      if (from === undefined || to === undefined) {
        return err({
          code: "invalid_input",
          message: "from と to は両方指定してください。",
          hint: '入力例: {"from": "2026-01-01", "to": "2026-06-30"}',
        });
      }
      if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
        return err({
          code: "invalid_input",
          message: "from / to は YYYY-MM-DD 形式の実在する日付で指定してください。",
          hint: '入力例: {"from": "2026-01-01", "to": "2026-06-30"}',
        });
      }
      if (from > to) {
        return err({
          code: "invalid_input",
          message: "from は to 以前の日付にしてください。",
          hint: "from <= to となるよう指定し直してください。",
        });
      }
      fromDate = from;
      toDate = to;
      periodLabel = `${fromDate}〜${toDate}`;
    }

    const maxTo = addYearsIso(fromDate, MAX_RANGE_YEARS);
    if (toDate > maxTo) {
      return err({
        code: "invalid_input",
        message: `期間は最大${MAX_RANGE_YEARS}年までです。`,
        hint: `期間を${MAX_RANGE_YEARS}年以内に分割して再実行してください`,
      });
    }

    const db = dbOf(ctx);
    const range = await getDataRange(db);
    if (range === null || toDate < range.min || fromDate > range.max) {
      return outOfRangeError(range);
    }

    const { results } = await db
      .prepare("SELECT date, name FROM holidays WHERE date BETWEEN ?1 AND ?2 ORDER BY date")
      .bind(fromDate, toDate)
      .all<{ date: string; name: string }>();
    const holidays = results.map((r) => ({ date: r.date, name: r.name }));
    const dataAsOf = await latestOkRunTimestamp(db);

    return ok(
      { holidays, count: holidays.length },
      {
        sources: ["cabinet_office_holidays"],
        fetched_at: new Date().toISOString(),
        ...(dataAsOf !== null ? { data_as_of: dataAsOf } : {}),
      },
      buildListSummary(periodLabel, holidays),
    );
  },
});
