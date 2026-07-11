import { describe, expect, it } from "vitest";
import { parseCsv, toIsoDate } from "../../src/ingest/csv.js";

describe("toIsoDate", () => {
  it("converts a normal YYYY/M/D token to ISO", () => {
    expect(toIsoDate("2026/1/1")).toBe("2026-01-01");
    expect(toIsoDate("1955/11/23")).toBe("1955-11-23");
  });

  it("pads single-digit month/day", () => {
    expect(toIsoDate("2026/2/3")).toBe("2026-02-03");
  });

  it("rejects a month out of range", () => {
    expect(toIsoDate("2026/13/1")).toBeNull();
    expect(toIsoDate("2026/0/1")).toBeNull();
  });

  it("rejects a day that doesn't exist in the given month (no silent rollover)", () => {
    // JS `new Date(2026, 1, 30)` would silently roll over to March 2 — toIsoDate
    // must reject this instead of accepting a wrong date.
    expect(toIsoDate("2026/2/30")).toBeNull();
    expect(toIsoDate("1955/13/99")).toBeNull();
  });

  it("rejects tokens that aren't in YYYY/M/D shape", () => {
    expect(toIsoDate("2026-01-01")).toBeNull();
    expect(toIsoDate("not-a-date")).toBeNull();
    expect(toIsoDate("")).toBeNull();
  });
});

describe("parseCsv", () => {
  it("parses a well-formed CSV, skipping the header row", () => {
    const text =
      "国民の祝日・休日月日,国民の祝日・休日名称\r\n1955/1/1,元日\r\n1955/1/15,成人の日\r\n";
    const { rows, parseErrors } = parseCsv(text);
    expect(parseErrors).toEqual([]);
    expect(rows).toEqual([
      { date: "1955-01-01", name: "元日" },
      { date: "1955-01-15", name: "成人の日" },
    ]);
  });

  it("tolerates LF-only and CR-only line endings", () => {
    const lf = parseCsv("h,h\n1955/1/1,元日\n");
    expect(lf.rows).toEqual([{ date: "1955-01-01", name: "元日" }]);
    const cr = parseCsv("h,h\r1955/1/1,元日\r");
    expect(cr.rows).toEqual([{ date: "1955-01-01", name: "元日" }]);
  });

  it("collects unparsable lines into parseErrors instead of silently dropping them", () => {
    const text = "h,h\r\n1955/1/1,元日\r\n1955/13/99,不正\r\nno-comma-here\r\n";
    const { rows, parseErrors } = parseCsv(text);
    expect(rows).toEqual([{ date: "1955-01-01", name: "元日" }]);
    expect(parseErrors).toHaveLength(2);
  });

  it("returns an error for an empty CSV", () => {
    const { rows, parseErrors } = parseCsv("");
    expect(rows).toEqual([]);
    expect(parseErrors.length).toBeGreaterThan(0);
  });
});
