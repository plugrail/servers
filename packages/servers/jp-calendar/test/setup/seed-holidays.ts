// Shared test helper: seed `holidays` via the REAL ingest pipeline (1B-1's
// `runIngest`) using the fixture CSV, rather than hand-inserting rows — so
// tool tests (1B-2) exercise the same data shape production ingestion
// produces, and so `ingest_runs` gets a real "ok" row for `data_as_of`
// (../ingest/store.ts `latestOkRunTimestamp`).
//
// `validBase` (test/fixtures/holiday-csv.ts) covers 1955-01-01..2027-11-23
// (93 rows: 1955, 1956, 2024-2027) — used as the fixed data-range floor/ceiling
// in 1B-2's tool tests.
import { env } from "cloudflare:test";
import { runIngest } from "../../src/ingest/pipeline.js";
import { fixtureBytes } from "../fixtures/holiday-csv.js";
import { snapshotCsvBytes } from "../fixtures/snapshot.js";
import { installFetchMock } from "../ingest/fetch-mock.js";

export const SEED_NOW = new Date("2026-07-10T00:00:00Z");
/** `ingest_runs.ts` of the seed run — the `data_as_of` tools should report. */
export const SEED_DATA_AS_OF = SEED_NOW.toISOString();

export const DATA_RANGE = { min: "1955-01-01", max: "2027-11-23" } as const;

export async function seedHolidaysFixture(): Promise<void> {
  const mock = installFetchMock({ csvBytes: fixtureBytes("validBase") });
  await runIngest(env, { now: SEED_NOW });
  mock.restore();
}

// 1B-4: seeds from the REAL full 内閣府CSV snapshot (../fixtures/
// syukujitsu-snapshot-2026-07-10.csv, ~1067 rows spanning 1955-01-01 to
// 2027-11-23) instead of the 93-row validBase subset above, run through the
// same real runIngest() pipeline — so edge-cases.test.ts's data-driven
// assertions also exercise fetch→decode→parse→validate→diff→apply on
// production-shaped data, not just a curated fixture.
export const SNAPSHOT_DATA_RANGE = { min: "1955-01-01", max: "2027-11-23" } as const;
export const SNAPSHOT_DATA_AS_OF = SEED_NOW.toISOString();

export async function seedFullSnapshot(): Promise<void> {
  const mock = installFetchMock({ csvBytes: snapshotCsvBytes() });
  await runIngest(env, { now: SEED_NOW });
  mock.restore();
}
