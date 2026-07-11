// Small D1 helpers shared by the ingest integration tests. Talks directly to
// the same `holidays` / `ingest_runs` tables the pipeline writes, so tests can
// assert on ground truth rather than trusting the pipeline's own return value.
import { env } from "cloudflare:test";

export async function resetDb(): Promise<void> {
  await env.DB.prepare("DELETE FROM ingest_runs").run();
  await env.DB.prepare("DELETE FROM holidays").run();
}

export interface HolidayRecord {
  date: string;
  name: string;
}

export async function getHolidays(): Promise<HolidayRecord[]> {
  const { results } = await env.DB.prepare(
    "SELECT date, name FROM holidays ORDER BY date",
  ).all<HolidayRecord>();
  return results;
}

export interface IngestRunRow {
  id: number;
  ts: string;
  source: string;
  status: string;
  source_hash: string | null;
  rows_added: number | null;
  rows_removed: number | null;
  rows_changed: number | null;
  error: string | null;
}

export async function getIngestRuns(): Promise<IngestRunRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM ingest_runs ORDER BY id",
  ).all<IngestRunRow>();
  return results;
}

export async function latestIngestRun(): Promise<IngestRunRow | undefined> {
  const runs = await getIngestRuns();
  return runs.at(-1);
}
