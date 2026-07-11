import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  closureReason,
  countBusinessDays,
  isBusinessDay,
} from "../src/calendar.js";

// Pure-function unit tests for 1B-3's business-day rules (../src/calendar.ts),
// independent of D1 — the holiday data below is a hand-copied subset of the
// REAL 2026/2027 内閣府 CSV (same rows as test/fixtures/holiday-csv.ts's
// `validBase`, decoded) so every case here is grounded in the actual
// confirmed calendar, not invented dates. The MCP-level equivalents (through
// the real /mcp endpoint, exercising D1 + the 封筒) live in
// test/tools/business-days.test.ts.
//
// 2026 calendar reference (weekdays, computed via Date.UTC — see ../src/dates.ts):
//   2026-04-24 金, 04-25 土, 04-26 日, 04-27 月, 04-28 火, 04-29 水(祝: 昭和の日),
//   04-30 木, 05-01 金, 05-02 土, 05-03 日(祝: 憲法記念日, already weekend),
//   05-04 月(祝: みどりの日), 05-05 火(祝: こどもの日), 05-06 水(祝: 休日),
//   05-07 木, 05-08 金.
//   2026-07-10 金, 07-11 土, 07-12 日, 07-13 月.
//   2026-12-28 月, 12-29 火, 12-30 水, 12-31 木, 2027-01-01 金(祝: 元日),
//   01-02 土, 01-03 日, 01-04 月.

const NO_EXTRA: ReadonlySet<string> = new Set();

const HOLIDAYS_2026: ReadonlyMap<string, string> = new Map([
  ["2026-01-01", "元日"],
  ["2026-01-12", "成人の日"],
  ["2026-02-11", "建国記念の日"],
  ["2026-02-23", "天皇誕生日"],
  ["2026-03-20", "春分の日"],
  ["2026-04-29", "昭和の日"],
  ["2026-05-03", "憲法記念日"],
  ["2026-05-04", "みどりの日"],
  ["2026-05-05", "こどもの日"],
  ["2026-05-06", "休日"],
  ["2026-07-20", "海の日"],
  ["2026-08-11", "山の日"],
  ["2026-09-21", "敬老の日"],
  ["2026-09-22", "休日"],
  ["2026-09-23", "秋分の日"],
  ["2026-10-12", "スポーツの日"],
  ["2026-11-03", "文化の日"],
  ["2026-11-23", "勤労感謝の日"],
  ["2027-01-01", "元日"],
]);

describe("isBusinessDay / closureReason", () => {
  it("a plain weekday is a business day (null reason)", () => {
    expect(closureReason("2026-07-10", HOLIDAYS_2026, "standard", NO_EXTRA)).toBeNull();
    expect(isBusinessDay("2026-07-10", HOLIDAYS_2026, "standard", NO_EXTRA)).toBe(true);
  });

  it("weekends are closed, labelled by weekday", () => {
    expect(closureReason("2026-07-11", HOLIDAYS_2026, "standard", NO_EXTRA)).toBe("土曜日");
    expect(closureReason("2026-07-12", HOLIDAYS_2026, "standard", NO_EXTRA)).toBe("日曜日");
  });

  it("a national holiday is closed, labelled with its name", () => {
    expect(closureReason("2026-04-29", HOLIDAYS_2026, "standard", NO_EXTRA)).toBe("祝日: 昭和の日");
  });

  it("banking-only closures (12/31, 1/2, 1/3) are open under standard", () => {
    expect(isBusinessDay("2026-12-31", HOLIDAYS_2026, "standard", NO_EXTRA)).toBe(true);
  });

  it("banking-only closures are closed under banking", () => {
    expect(isBusinessDay("2026-12-31", HOLIDAYS_2026, "banking", NO_EXTRA)).toBe(false);
    expect(closureReason("2026-12-31", HOLIDAYS_2026, "banking", NO_EXTRA)).toContain("銀行休業日");
  });

  it("1/1 is already excluded as a national holiday under both calendars", () => {
    expect(isBusinessDay("2027-01-01", HOLIDAYS_2026, "standard", NO_EXTRA)).toBe(false);
    expect(isBusinessDay("2027-01-01", HOLIDAYS_2026, "banking", NO_EXTRA)).toBe(false);
  });

  it("extra_closed_dates closes an otherwise-business day", () => {
    expect(isBusinessDay("2026-12-29", HOLIDAYS_2026, "standard", NO_EXTRA)).toBe(true);
    expect(isBusinessDay("2026-12-29", HOLIDAYS_2026, "standard", new Set(["2026-12-29"]))).toBe(
      false,
    );
  });
});

describe("addBusinessDays — required case 1: Friday +1 / -1", () => {
  it("Friday + 1 business day => the following Monday", () => {
    const { result, skipped } = addBusinessDays(
      "2026-07-10",
      1,
      HOLIDAYS_2026,
      "standard",
      NO_EXTRA,
    );
    expect(result).toBe("2026-07-13");
    expect(skipped).toEqual([
      { date: "2026-07-11", reason: "土曜日" },
      { date: "2026-07-12", reason: "日曜日" },
    ]);
  });

  it("Friday - 1 business day (negative direction) => the previous Thursday", () => {
    const { result, skipped } = addBusinessDays(
      "2026-07-10",
      -1,
      HOLIDAYS_2026,
      "standard",
      NO_EXTRA,
    );
    expect(result).toBe("2026-07-09");
    expect(skipped).toEqual([]);
  });

  it("spec's worked example: 2026-07-10 + 3 business days => 2026-07-15", () => {
    const { result } = addBusinessDays("2026-07-10", 3, HOLIDAYS_2026, "standard", NO_EXTRA);
    expect(result).toBe("2026-07-15");
  });
});

describe("addBusinessDays — required case 2: crossing the 2026 Golden Week cluster", () => {
  it("4 business days from 2026-04-24 lands past 昭和の日 (04-29) at 05-01", () => {
    const { result, skipped } = addBusinessDays(
      "2026-04-24",
      4,
      HOLIDAYS_2026,
      "standard",
      NO_EXTRA,
    );
    expect(result).toBe("2026-05-01");
    expect(skipped).toEqual([
      { date: "2026-04-25", reason: "土曜日" },
      { date: "2026-04-26", reason: "日曜日" },
      { date: "2026-04-29", reason: "祝日: 昭和の日" },
    ]);
  });

  it("6 business days from 2026-04-24 crosses the ENTIRE GW cluster (04-29..05-06) to 05-08", () => {
    const { result, skipped } = addBusinessDays(
      "2026-04-24",
      6,
      HOLIDAYS_2026,
      "standard",
      NO_EXTRA,
    );
    expect(result).toBe("2026-05-08");
    expect(skipped.map((s) => s.date)).toEqual([
      "2026-04-25",
      "2026-04-26",
      "2026-04-29",
      "2026-05-02",
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
    ]);
  });
});

describe("addBusinessDays — required case 3: banking vs standard around year-end", () => {
  it("2026-12-30 + 1 under standard => 2026-12-31 (banking closures don't apply)", () => {
    const { result, skipped } = addBusinessDays(
      "2026-12-30",
      1,
      HOLIDAYS_2026,
      "standard",
      NO_EXTRA,
    );
    expect(result).toBe("2026-12-31");
    expect(skipped).toEqual([]);
  });

  it("2026-12-30 + 1 under banking => 2027-01-04 (12/31, 1/1, 1/2, 1/3 all closed)", () => {
    const { result, skipped } = addBusinessDays(
      "2026-12-30",
      1,
      HOLIDAYS_2026,
      "banking",
      NO_EXTRA,
    );
    expect(result).toBe("2027-01-04");
    expect(skipped.map((s) => s.date)).toEqual([
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });
});

describe("addBusinessDays — required case 4: extra_closed_dates for year-end shutdowns", () => {
  it("without extra_closed_dates, 2026-12-28 + 1 => 2026-12-29 (an ordinary Tuesday)", () => {
    const { result } = addBusinessDays("2026-12-28", 1, HOLIDAYS_2026, "standard", NO_EXTRA);
    expect(result).toBe("2026-12-29");
  });

  it("with extra_closed_dates=[12-29,12-30], 2026-12-28 + 1 => 2026-12-31", () => {
    const extra = new Set(["2026-12-29", "2026-12-30"]);
    const { result, skipped } = addBusinessDays("2026-12-28", 1, HOLIDAYS_2026, "standard", extra);
    expect(result).toBe("2026-12-31");
    expect(skipped).toEqual([
      { date: "2026-12-29", reason: "指定休業日(extra_closed_dates)" },
      { date: "2026-12-30", reason: "指定休業日(extra_closed_dates)" },
    ]);
  });
});

describe("addBusinessDays — required case 8: skipped list truncation", () => {
  it("a long walk (200 business days from New Year's Day) truncates skipped at 20 but keeps the true total", () => {
    const { result, skipped, skippedTotal } = addBusinessDays(
      "2026-01-01",
      200,
      HOLIDAYS_2026,
      "standard",
      NO_EXTRA,
    );
    expect(result).toBe("2026-10-28");
    expect(skipped).toHaveLength(20);
    expect(skippedTotal).toBeGreaterThan(20);
    // every listed entry really is a truncation prefix (in date order, no gaps skipped over)
    expect(skipped[0]).toEqual({ date: "2026-01-03", reason: "土曜日" });
  });
});

describe("addBusinessDays — required case 9: round-trip property", () => {
  it.each([
    ["2026-07-10", 3],
    ["2026-07-10", -3],
    ["2026-04-24", 6],
    ["2026-12-28", 5],
  ])("add(add(%s, %d), -%d) returns to the original date", (date, n) => {
    const forward = addBusinessDays(date, n, HOLIDAYS_2026, "standard", NO_EXTRA);
    const back = addBusinessDays(forward.result, -n, HOLIDAYS_2026, "standard", NO_EXTRA);
    expect(back.result).toBe(date);
  });
});

describe("countBusinessDays — required case 6: the four boundary combinations", () => {
  // 2026-07-10 (金) .. 2026-07-17 (金): a plain business week with a weekend
  // in the middle (07-11/07-12) and no holidays.
  it.each([
    [false, true, 5], // default: from除く・to含む
    [true, false, 5],
    [true, true, 6],
    [false, false, 4],
  ])("include_from=%s include_to=%s => %d business days", (includeFrom, includeTo, expected) => {
    expect(
      countBusinessDays(
        "2026-07-10",
        "2026-07-17",
        includeFrom,
        includeTo,
        HOLIDAYS_2026,
        "standard",
        NO_EXTRA,
      ),
    ).toBe(expected);
  });

  it("from === to under the default boundaries (exclude from, include to) is 0, never negative", () => {
    expect(
      countBusinessDays(
        "2026-07-10",
        "2026-07-10",
        false,
        true,
        HOLIDAYS_2026,
        "standard",
        NO_EXTRA,
      ),
    ).toBe(0);
  });

  it("from === to with both boundaries included counts that single business day", () => {
    expect(
      countBusinessDays(
        "2026-07-10",
        "2026-07-10",
        true,
        true,
        HOLIDAYS_2026,
        "standard",
        NO_EXTRA,
      ),
    ).toBe(1);
  });
});
