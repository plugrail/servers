// Decoder for the real 内閣府 syukujitsu.csv snapshot (1B-4).
//
// The actual CSV bytes live at ./syukujitsu-snapshot-2026-07-10.csv
// (Shift_JIS, byte-for-byte as downloaded from
// https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv on 2026-07-10) so
// the edge-case tests exercise the REAL production data through the REAL
// ingest pipeline (fetch mock → parseCsv → validate → diff → apply), rather
// than the hand-picked 93-row subset ../setup/seed-holidays.ts uses for
// 1B-2/1B-3's tests — this is what lets 1B-4 double-check ingest correctness,
// not just do a data lookup (1B-4.md 設計原則 1).
//
// fs isn't available inside the workerd test runtime, so the file is read on
// the Node side in ../../vitest.config.ts (same pattern as TEST_MIGRATIONS
// for migrations/*.sql) and passed in as a base64 test-only binding
// (TEST_SNAPSHOT_CSV_BASE64, declared in ../setup/test-env.d.ts). This
// function decodes it back to the exact original bytes — same atob() +
// charCodeAt() technique as ./holiday-csv.ts's `fixtureBytes()`.
import { env } from "cloudflare:test";

export function snapshotCsvBytes(): Uint8Array {
  const binary = atob(env.TEST_SNAPSHOT_CSV_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
