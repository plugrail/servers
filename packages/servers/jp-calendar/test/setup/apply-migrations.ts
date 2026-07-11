// Runs INSIDE the worker test runtime before each test file. Applies the real
// migrations/*.sql files (read on the Node side in vitest.config.ts and passed
// in as the TEST_MIGRATIONS binding) to the local D1 (miniflare), so tests
// exercise the same schema production uses — no duplicated inline SQL.
// test-env.d.ts augments Cloudflare.Env with TEST_MIGRATIONS for the type
// checker; being a pure ambient .d.ts it's picked up via tsconfig `include`
// and needs no runtime import here (it has no JS output to import).
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
