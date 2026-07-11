// Structured logging (1A-6). One JSON line per `log()` call, matching the
// shape `{ ts, level, event, req_id, server, tool, key_hash?, duration_ms?,
// ...fields }` (see docs/ops/observability.md). Workers Logs
// (`observability.enabled`, wrangler.jsonc) picks up every `console.*` call
// automatically — this file is the ONLY place in `@plugrail/core` /
// billing integrations allowed to call `console.*` directly; a Biome
// override (biome.json) enforces that outside CLI scripts and tests, so a
// stray `console.log` elsewhere in src/ is a lint error, not a convention.
//
// 禁止事項 (1A-6): never pass an API key (plaintext or masked-but-derivable),
// a tool's raw input arguments, or a raw IP address into `fields`. Callers
// that need to attribute a log line to an identity use `key_hash` (SHA-256,
// same convention as 1A-3/1A-4), never the plaintext key or an IP.

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

/**
 * Write one structured JSON line at the given level. `fields` is merged
 * after `ts`/`level`/`event` — pass `req_id`, `server`, `tool`, `key_hash`,
 * `duration_ms` etc. as needed for the event being logged (not every event
 * has every field; e.g. a non-tool request has no `tool`).
 */
export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/** Per-request correlation id. Also sent back as the `X-Request-Id` response header (support 突合用). */
export function genRequestId(): string {
  return crypto.randomUUID();
}

/** Normalize a caught `unknown` into a loggable string without ever throwing itself. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
