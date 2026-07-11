#!/usr/bin/env node
// Local initial-seed / manual re-run trigger (1B-1 Step 4-3, `pnpm ingest:local`).
//
// Triggers the ingest pipeline against a running `wrangler dev` instance by
// POSTing to its /admin/ingest route (the same route the production admin
// path uses — see src/ingest/admin-route.ts). This is how the local D1
// (miniflare, via `wrangler dev`) gets its first full seed during
// development.
//
// Usage:
//   1. Copy .dev.vars.example to .dev.vars and set ADMIN_TOKEN (and
//      optionally NOTIFY_WEBHOOK_URL) — `wrangler dev` reads secrets from
//      .dev.vars.
//   2. In one terminal: `pnpm dev` (wrangler dev; applies migrations to the
//      local D1 automatically on first run against a fresh .wrangler state,
//      or run `pnpm db:migrate:local` explicitly first).
//   3. In another terminal:
//        ADMIN_TOKEN=<same value as .dev.vars> pnpm ingest:local
//
// WRANGLER_DEV_URL overrides the default http://127.0.0.1:8787 if `wrangler
// dev` is bound to a different host/port.

const BASE_URL = process.env.WRANGLER_DEV_URL ?? "http://127.0.0.1:8787";
const token = process.env.ADMIN_TOKEN;

if (!token) {
  console.error(
    "ADMIN_TOKEN is not set. Set it to the same value as `.dev.vars`'s ADMIN_TOKEN, e.g.:\n" +
      "  ADMIN_TOKEN=<value> pnpm ingest:local",
  );
  process.exit(1);
}

const res = await fetch(`${BASE_URL}/admin/ingest`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
});
const body = await res.text();
console.log(`HTTP ${res.status}`);
console.log(body);
if (!res.ok) process.exit(1);
