// Shared types for the ingest pipeline (1B-1).
//
// This step-split (fetch → validate → diff → apply → notify) is the template
// Phase 2's "official file DL → validate → diff → apply to D1 → notify → full
// rebuild" pipeline for 法人番号/インボイス data is meant to copy — see
// docs/architecture/data-ingestion-pattern.md for the write-up and the
// changes that copy will need.

/** One row of the holidays table, normalised to ISO dates. */
export interface HolidayRow {
  /** ISO "YYYY-MM-DD". */
  date: string;
  name: string;
}

/** A single ingest_runs row (see migrations/0001_init.sql). */
export type IngestStatus = "ok" | "no_change" | "failed";

export interface HolidayDiff {
  added: HolidayRow[];
  removed: HolidayRow[];
  changed: Array<{ date: string; from: string; to: string }>;
}

export interface IngestRunRecord {
  ts: string;
  source: string;
  status: IngestStatus;
  sourceHash?: string;
  rowsAdded?: number;
  rowsRemoved?: number;
  rowsChanged?: number;
  error?: string;
}

/** What `runIngest()` returns to its three callers (cron / admin route / local seed). */
export interface IngestRunSummary {
  status: IngestStatus;
  diff?: HolidayDiff;
  error?: string;
  sourceHash?: string;
}

/** Source identifier stored in ingest_runs.source. Only one source exists in Phase 1. */
export const INGEST_SOURCE = "cao_syukujitsu_csv";
