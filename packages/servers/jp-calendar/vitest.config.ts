import { readFileSync } from "node:fs";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// D1 migrations can only be *read* from disk on the Node side (fs isn't
// available inside the workerd test runtime). We read them here and pass the
// parsed migrations in as a plain-data test-only binding (`TEST_MIGRATIONS`);
// test/setup/apply-migrations.ts (a setupFile that runs INSIDE the worker)
// applies them to the local D1 (miniflare) before each test file runs. See
// docs/architecture/data-ingestion-pattern.md.
const migrationsPath = path.join(__dirname, "migrations");
const migrations = await readD1Migrations(migrationsPath);

// 1B-4: the real 内閣府 syukujitsu.csv snapshot (test/fixtures/
// syukujitsu-snapshot-2026-07-10.csv, Shift_JIS bytes as downloaded) is
// checked in so edge-cases.test.ts is self-contained under CI without
// network access. Same "fs on the Node side, pass in as a binding" pattern
// as TEST_MIGRATIONS above — base64 here since D1Migration is structured
// data but this is raw bytes. test/fixtures/snapshot.ts decodes it back
// inside the worker.
const snapshotPath = path.join(__dirname, "test/fixtures/syukujitsu-snapshot-2026-07-10.csv");
const snapshotCsvBase64 = readFileSync(snapshotPath).toString("base64");

export default defineConfig({
  test: {
    setupFiles: ["./test/setup/apply-migrations.ts"],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.example.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          TEST_SNAPSHOT_CSV_BASE64: snapshotCsvBase64,
        },
      },
    }),
  ],
});
