// runIngest() — orchestrates fetch → validate → diff → apply → notify
// (1B-1 Step 3). All three launch points (Cron / POST /admin/ingest / local
// seed via the admin route) call this one function, so there is exactly one
// code path that ever writes to `holidays`.

import { parseCsv } from "./csv.js";
import { diffHolidays, isEmptyDiff } from "./diff.js";
import { fetchSource, SourceFetchError } from "./fetch-source.js";
import { notify } from "./notify.js";
import { applyDiff, fetchCurrentHolidays, recordIngestRun } from "./store.js";
import { INGEST_SOURCE, type IngestRunSummary } from "./types.js";
import { validate } from "./validate.js";

export interface RunIngestOptions {
  /** Override the CSV URL (tests only). */
  url?: string;
  /** Override "now" for year-range validation (tests only). */
  now?: Date;
}

export async function runIngest(env: Env, opts: RunIngestOptions = {}): Promise<IngestRunSummary> {
  const ts = (opts.now ?? new Date()).toISOString();
  const source = INGEST_SOURCE;

  let sourceHash: string | undefined;
  let csvText: string;
  try {
    const fetched = await fetchSource(opts.url);
    csvText = fetched.text;
    sourceHash = fetched.sourceHash;
  } catch (cause) {
    const error =
      cause instanceof SourceFetchError || cause instanceof Error ? cause.message : String(cause);
    await recordIngestRun(env.DB, { ts, source, status: "failed", error });
    await notify(env, { status: "failed", source, ts, error });
    return { status: "failed", error };
  }

  const { rows, parseErrors } = parseCsv(csvText);
  const existing = await fetchCurrentHolidays(env.DB);

  const validation = validate({
    rows,
    parseErrors,
    existingCount: existing.length,
    now: opts.now,
  });
  if (!validation.ok) {
    await recordIngestRun(env.DB, {
      ts,
      source,
      status: "failed",
      sourceHash,
      error: validation.reason,
    });
    await notify(env, { status: "failed", source, ts, error: validation.reason });
    return { status: "failed", error: validation.reason, sourceHash };
  }

  const diff = diffHolidays(existing, rows);

  if (isEmptyDiff(diff)) {
    await recordIngestRun(env.DB, {
      ts,
      source,
      status: "no_change",
      sourceHash,
      rowsAdded: 0,
      rowsRemoved: 0,
      rowsChanged: 0,
    });
    // no_change is recorded but not notified (仕様通り — 差分ゼロは通知しない).
    return { status: "no_change", diff, sourceHash };
  }

  await applyDiff(env.DB, diff);
  await recordIngestRun(env.DB, {
    ts,
    source,
    status: "ok",
    sourceHash,
    rowsAdded: diff.added.length,
    rowsRemoved: diff.removed.length,
    rowsChanged: diff.changed.length,
  });
  await notify(env, { status: "ok", source, ts, diff });

  return { status: "ok", diff, sourceHash };
}
