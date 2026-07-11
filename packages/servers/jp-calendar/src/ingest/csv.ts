// CSV parsing for the 内閣府 syukujitsu.csv format (1B-1 Step 2/3).
//
// Format (confirmed against the live file, 2026-07-10):
//   国民の祝日・休日月日,国民の祝日・休日名称\r\n
//   1955/1/1,元日\r\n
//   ...
// No quoting, no embedded commas in names, CRLF line endings, no trailing note
// rows. We still parse defensively (comma-split rather than assuming column
// position) since the source is out of our control.

import type { HolidayRow } from "./types.js";

export interface ParsedCsv {
  rows: HolidayRow[];
  /** Raw lines that failed to parse into a valid (date, name) pair. */
  parseErrors: string[];
}

/**
 * Parse decoded (UTF-8) CSV text into holiday rows. Never throws — unparsable
 * lines are collected into `parseErrors` so `validate()` can fail loudly
 * instead of silently dropping rows.
 */
export function parseCsv(text: string): ParsedCsv {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { rows: [], parseErrors: ["empty CSV (no lines)"] };
  }

  // First non-empty line is the header; skip it regardless of its exact
  // wording (validate() checks row count / dates, not header text — the
  // header format is documented but not a contract we depend on for parsing).
  const dataLines = lines.slice(1);

  const rows: HolidayRow[] = [];
  const parseErrors: string[] = [];

  for (const line of dataLines) {
    const commaIndex = line.indexOf(",");
    if (commaIndex === -1) {
      parseErrors.push(line);
      continue;
    }
    const rawDate = line.slice(0, commaIndex).trim();
    const name = line.slice(commaIndex + 1).trim();
    const isoDate = toIsoDate(rawDate);
    if (!isoDate || !name) {
      parseErrors.push(line);
      continue;
    }
    rows.push({ date: isoDate, name });
  }

  return { rows, parseErrors };
}

/**
 * Convert a "YYYY/M/D" (or "YYYY/MM/DD") date token to ISO "YYYY-MM-DD".
 * Returns `null` for anything that isn't a real calendar date — e.g.
 * "2026/2/30" is rejected (JS `Date` would silently roll it over to March 2).
 */
export function toIsoDate(raw: string): string | null {
  const match = /^(\d{3,4})\/(\d{1,2})\/(\d{1,2})$/.exec(raw);
  if (!match) return null;

  const yearStr = match[1];
  const monthStr = match[2];
  const dayStr = match[3];
  if (!yearStr || !monthStr || !dayStr) return null;

  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  const rolledOver =
    date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day;
  if (rolledOver) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
