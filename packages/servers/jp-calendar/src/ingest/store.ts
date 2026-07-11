// Step 4 (D1 side): read current holidays, apply a diff, and record ingest_runs
// (1B-1 Step 3-4). All D1 access for the ingest pipeline lives here.

import type { HolidayDiff, HolidayRow, IngestRunRecord } from "./types.js";

export async function fetchCurrentHolidays(db: D1Database): Promise<HolidayRow[]> {
  const { results } = await db
    .prepare("SELECT date, name FROM holidays ORDER BY date")
    .all<HolidayRow>();
  return results;
}

export async function countHolidays(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM holidays").first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Apply a diff as a single D1 batch (added + changed → UPSERT, removed →
 * DELETE). `db.batch()` runs all statements in one implicit transaction, so a
 * partial failure never leaves `holidays` in a half-applied state.
 */
export async function applyDiff(db: D1Database, diff: HolidayDiff): Promise<void> {
  const statements: D1PreparedStatement[] = [];

  const upsert = db.prepare(
    "INSERT INTO holidays (date, name) VALUES (?1, ?2) " +
      "ON CONFLICT(date) DO UPDATE SET name = excluded.name",
  );
  for (const row of diff.added) {
    statements.push(upsert.bind(row.date, row.name));
  }
  for (const change of diff.changed) {
    statements.push(upsert.bind(change.date, change.to));
  }

  const del = db.prepare("DELETE FROM holidays WHERE date = ?1");
  for (const row of diff.removed) {
    statements.push(del.bind(row.date));
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

export async function recordIngestRun(db: D1Database, run: IngestRunRecord): Promise<void> {
  await db
    .prepare(
      "INSERT INTO ingest_runs (ts, source, status, source_hash, rows_added, rows_removed, rows_changed, error) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
    .bind(
      run.ts,
      run.source,
      run.status,
      run.sourceHash ?? null,
      run.rowsAdded ?? null,
      run.rowsRemoved ?? null,
      run.rowsChanged ?? null,
      run.error ?? null,
    )
    .run();
}

/** Latest status="ok" ingest_runs.ts — the `data_as_of` value for 1B-2's tools. */
export async function latestOkRunTimestamp(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("SELECT ts FROM ingest_runs WHERE status = 'ok' ORDER BY ts DESC LIMIT 1")
    .first<{ ts: string }>();
  return row?.ts ?? null;
}
