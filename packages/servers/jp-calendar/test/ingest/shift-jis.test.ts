import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/ingest/csv.js";
import { fixtureBytes } from "../fixtures/holiday-csv.js";

// De-risks the key assumption behind fetch-source.ts: Cloudflare Workers'
// `TextDecoder` is backed by full ICU data (unlike Node's default build,
// which only ships utf-8/utf-16/latin1 without --icu=full), so legacy
// encodings like Shift_JIS decode without a userland conversion library. If
// this ever regresses, this test fails loudly rather than corrupting holiday
// names silently in production.
describe("TextDecoder('shift_jis') in the Workers runtime", () => {
  it("decodes real Shift_JIS-encoded holiday CSV bytes into correct Japanese text", () => {
    const bytes = fixtureBytes("validBase");
    const text = new TextDecoder("shift_jis").decode(bytes);

    expect(text.startsWith("国民の祝日・休日月日,国民の祝日・休日名称")).toBe(true);
    expect(text).toContain("1955/1/1,元日");
    expect(text).toContain("2026/2/11,建国記念の日");
    expect(text).toContain("2027/11/23,勤労感謝の日");
  });

  it("round-trips through parseCsv() end to end from raw Shift_JIS bytes", () => {
    const bytes = fixtureBytes("validBase");
    const text = new TextDecoder("shift_jis").decode(bytes);
    const { rows, parseErrors } = parseCsv(text);

    expect(parseErrors).toEqual([]);
    expect(rows.length).toBe(93);
    expect(rows[0]).toEqual({ date: "1955-01-01", name: "元日" });
    expect(rows.find((r) => r.date === "2026-02-11")).toEqual({
      date: "2026-02-11",
      name: "建国記念の日",
    });
  });
});
