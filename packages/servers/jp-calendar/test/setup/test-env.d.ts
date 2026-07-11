// Test-only ambient binding type. `TEST_MIGRATIONS` is injected via
// vitest.config.ts's `miniflare.bindings` (see apply-migrations.ts) — it never
// exists in production, so it's declared here rather than in src/env.d.ts.
//
// `TEST_SNAPSHOT_CSV_BASE64` (1B-4) is the same pattern: the real 内閣府
// syukujitsu.csv snapshot's raw bytes, base64-encoded on the Node side in
// vitest.config.ts and decoded back inside the worker by
// test/fixtures/snapshot.ts.
//

import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      TEST_SNAPSHOT_CSV_BASE64: string;
    }
  }
}
