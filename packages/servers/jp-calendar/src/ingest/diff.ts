// Step 3: diff() — compute added/removed/changed against D1's current state
// (1B-1 Step 3-3).
//
// Because this always diffs the FULL incoming CSV against the FULL current
// table, re-running it (e.g. via the admin route) IS the "full rebuild"
// mechanism — there is no separate rebuild code path (see
// docs/architecture/data-ingestion-pattern.md).

import type { HolidayDiff, HolidayRow } from "./types.js";

export function diffHolidays(current: HolidayRow[], incoming: HolidayRow[]): HolidayDiff {
  const currentByDate = new Map(current.map((row) => [row.date, row.name]));
  const incomingByDate = new Map(incoming.map((row) => [row.date, row.name]));

  const added: HolidayRow[] = [];
  const changed: HolidayDiff["changed"] = [];
  for (const [date, name] of incomingByDate) {
    const existingName = currentByDate.get(date);
    if (existingName === undefined) {
      added.push({ date, name });
    } else if (existingName !== name) {
      changed.push({ date, from: existingName, to: name });
    }
  }

  const removed: HolidayRow[] = [];
  for (const [date, name] of currentByDate) {
    if (!incomingByDate.has(date)) {
      removed.push({ date, name });
    }
  }

  // Deterministic ordering keeps diffs stable in tests/notify text.
  added.sort((a, b) => a.date.localeCompare(b.date));
  removed.sort((a, b) => a.date.localeCompare(b.date));
  changed.sort((a, b) => a.date.localeCompare(b.date));

  return { added, removed, changed };
}

export function isEmptyDiff(diff: HolidayDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}
