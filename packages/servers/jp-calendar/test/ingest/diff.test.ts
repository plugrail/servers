import { describe, expect, it } from "vitest";
import { diffHolidays, isEmptyDiff } from "../../src/ingest/diff.js";

describe("diffHolidays", () => {
  it("detects no diff when current and incoming are identical", () => {
    const rows = [
      { date: "2026-01-01", name: "元日" },
      { date: "2026-02-11", name: "建国記念の日" },
    ];
    const diff = diffHolidays(rows, [...rows]);
    expect(diff).toEqual({ added: [], removed: [], changed: [] });
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it("detects an added row", () => {
    const current = [{ date: "2026-01-01", name: "元日" }];
    const incoming = [...current, { date: "2026-02-11", name: "建国記念の日" }];
    const diff = diffHolidays(current, incoming);
    expect(diff.added).toEqual([{ date: "2026-02-11", name: "建国記念の日" }]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(isEmptyDiff(diff)).toBe(false);
  });

  it("detects a removed row", () => {
    const current = [
      { date: "2026-01-01", name: "元日" },
      { date: "2026-02-11", name: "建国記念の日" },
    ];
    const incoming = [{ date: "2026-01-01", name: "元日" }];
    const diff = diffHolidays(current, incoming);
    expect(diff.removed).toEqual([{ date: "2026-02-11", name: "建国記念の日" }]);
    expect(diff.added).toEqual([]);
  });

  it("detects a changed name for the same date", () => {
    const current = [{ date: "2026-02-11", name: "建国記念の日" }];
    const incoming = [{ date: "2026-02-11", name: "建国記念の日(改称)" }];
    const diff = diffHolidays(current, incoming);
    expect(diff.changed).toEqual([
      { date: "2026-02-11", from: "建国記念の日", to: "建国記念の日(改称)" },
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("detects added + removed + changed together and sorts each by date", () => {
    const current = [
      { date: "2026-01-01", name: "元日" },
      { date: "2026-02-11", name: "建国記念の日" },
      { date: "2027-11-23", name: "勤労感謝の日" },
    ];
    const incoming = [
      { date: "2026-01-01", name: "元日" },
      { date: "2026-02-11", name: "建国記念の日(改称)" },
      { date: "2028-01-01", name: "元日" },
    ];
    const diff = diffHolidays(current, incoming);
    expect(diff.added).toEqual([{ date: "2028-01-01", name: "元日" }]);
    expect(diff.removed).toEqual([{ date: "2027-11-23", name: "勤労感謝の日" }]);
    expect(diff.changed).toEqual([
      { date: "2026-02-11", from: "建国記念の日", to: "建国記念の日(改称)" },
    ]);
  });
});
