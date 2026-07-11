// Step 2: validate() — refuse to write broken data to D1 (1B-1 Step 3-2, 禁止事項).
//
// Any failure here means apply() is never called: the caller records a
// "failed" ingest_runs row and notifies, but `holidays` is left untouched.

import type { HolidayRow } from "./types.js";

/** 内閣府CSVの収録範囲の下限。1955年より前の行が来たら明らかにパースミスか別データ。 */
const MIN_YEAR = 1955;
/**
 * 収録範囲は「翌年 or 翌々年」までなので、現在年+2年を上限とする。それを超える行が
 * あれば year/month/day の桁ズレ等のパース事故を疑う。
 */
const MAX_YEAR_AHEAD = 2;
/** 既存件数からの許容減少率。これを超えたら壊れたCSV/取得失敗を疑い書き込まない。 */
const MAX_DECREASE_RATIO = 0.05;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export interface ValidationInput {
  rows: HolidayRow[];
  parseErrors: string[];
  /** Current row count in D1's `holidays` table (0 on the very first ingest). */
  existingCount: number;
  /** Injectable for tests; defaults to the real current time. */
  now?: Date;
}

export function validate(input: ValidationInput): ValidationResult {
  const { rows, parseErrors, existingCount, now = new Date() } = input;

  if (parseErrors.length > 0) {
    const sample = parseErrors.slice(0, 3).join(" | ");
    return {
      ok: false,
      reason: `${parseErrors.length}行が日付として不正、またはカンマ区切りでパースできませんでした: ${sample}`,
    };
  }

  if (rows.length === 0) {
    return { ok: false, reason: "パース後の行数が0でした（CSVが空、またはヘッダのみ）" };
  }

  const maxYear = now.getUTCFullYear() + MAX_YEAR_AHEAD;
  for (const row of rows) {
    const year = Number(row.date.slice(0, 4));
    if (year < MIN_YEAR || year > maxYear) {
      return {
        ok: false,
        reason: `年範囲外の行があります: ${row.date} ${row.name}（許容範囲 ${MIN_YEAR}〜${maxYear}）`,
      };
    }
  }

  if (existingCount > 0 && rows.length < existingCount) {
    const decreaseRatio = (existingCount - rows.length) / existingCount;
    if (decreaseRatio > MAX_DECREASE_RATIO) {
      return {
        ok: false,
        reason:
          `行数が既存(${existingCount}件)から${rows.length}件へ${(decreaseRatio * 100).toFixed(1)}%減少しました` +
          `（許容閾値${(MAX_DECREASE_RATIO * 100).toFixed(0)}%を超過）。取得元の異常を疑い書き込みを中止します。`,
      };
    }
  }

  return { ok: true };
}
