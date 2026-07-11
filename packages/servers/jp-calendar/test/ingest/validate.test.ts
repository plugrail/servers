import { describe, expect, it } from "vitest";
import { validate } from "../../src/ingest/validate.js";

const NOW = new Date("2026-07-10T00:00:00Z");
const okRows = [
  { date: "2025-01-01", name: "元日" },
  { date: "2026-01-01", name: "元日" },
];

describe("validate", () => {
  it("passes for a normal row set with no prior data (first ingest)", () => {
    const result = validate({ rows: okRows, parseErrors: [], existingCount: 0, now: NOW });
    expect(result).toEqual({ ok: true });
  });

  it("fails when there are any parseErrors", () => {
    const result = validate({
      rows: okRows,
      parseErrors: ["bad,line"],
      existingCount: 0,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("fails when the parsed row count is zero", () => {
    const result = validate({ rows: [], parseErrors: [], existingCount: 0, now: NOW });
    expect(result.ok).toBe(false);
  });

  it("fails when a row's year is below the 1955 floor", () => {
    const result = validate({
      rows: [{ date: "1900-04-29", name: "天皇誕生日" }],
      parseErrors: [],
      existingCount: 0,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("年範囲外");
  });

  it("fails when a row's year is more than 2 years ahead of now", () => {
    const result = validate({
      rows: [{ date: "2029-01-01", name: "元日" }], // NOW is 2026 -> max allowed 2028
      parseErrors: [],
      existingCount: 0,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("allows a row exactly at now + 2 years", () => {
    const result = validate({
      rows: [{ date: "2028-01-01", name: "元日" }],
      parseErrors: [],
      existingCount: 0,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("fails when row count drops more than 5% from the existing count", () => {
    // existing 100 -> incoming 90 is a 10% decrease, over the 5% threshold.
    const rows = Array.from({ length: 90 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      name: `holiday-${i}`,
    }));
    const result = validate({ rows, parseErrors: [], existingCount: 100, now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("減少");
  });

  it("allows a decrease within the 5% threshold", () => {
    // existing 100 -> incoming 96 is a 4% decrease.
    const rows = Array.from({ length: 96 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      name: `holiday-${i}`,
    }));
    const result = validate({ rows, parseErrors: [], existingCount: 100, now: NOW });
    expect(result.ok).toBe(true);
  });

  it("allows any increase in row count regardless of magnitude", () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      name: `holiday-${i}`,
    }));
    const result = validate({ rows, parseErrors: [], existingCount: 10, now: NOW });
    expect(result.ok).toBe(true);
  });
});
