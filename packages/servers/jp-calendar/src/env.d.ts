/// <reference path="../node_modules/@cloudflare/workers-types/index.d.ts" />

// Secrets set via `wrangler secret put` (ADMIN_TOKEN, NOTIFY_WEBHOOK_URL) do NOT
// appear in wrangler.jsonc, so `wrangler types` (which regenerates
// worker-configuration.d.ts on every `pnpm typecheck`/`pnpm dev`) cannot see
// them. Declare them here instead; these merge (declaration merging) with the
// generated `Env` / `Cloudflare.Env` interfaces.
//
// Keep this file in sync by hand whenever a new secret is introduced.
//
// This file is NOT generated and NOT gitignored (unlike worker-configuration.d.ts).

interface Env {
  /**
   * Bearer token protecting `POST /admin/ingest` (1B-1 Step 4-2).
   *
   * This is the only guard on the admin route in the self-hosted worker.
   */
  ADMIN_TOKEN?: string;
  /** Slack Incoming Webhook URL. When unset, notify() logs and skips the POST. */
  NOTIFY_WEBHOOK_URL?: string;
  /**
   * 1A-6 (error monitoring). Read by @plugrail/core's `defineMcpServer()`
   * (factory.ts, `Sentry.withSentry`). Unset = Sentry stays disabled and
   * exceptions are only visible via structured logs (Workers Logs) — see
   * docs/ops/observability.md for the human `wrangler secret put` step.
   */
  SENTRY_DSN?: string;
  /**
   * 1A-6. Gates `GET /__debug/error` (@plugrail/core factory.ts) — an
   * intentional-error route used to smoke-test the Sentry notification
   * pipeline end to end. Unset = the route always 404s, indistinguishable
   * from not existing. See docs/ops/observability.md §通知テスト手順.
   */
  DEBUG_ERROR_TOKEN?: string;
}

declare namespace Cloudflare {
  interface Env {
    ADMIN_TOKEN?: string;
    NOTIFY_WEBHOOK_URL?: string;
    SENTRY_DSN?: string;
    DEBUG_ERROR_TOKEN?: string;
  }
}
