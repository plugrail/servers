// Test helper: stubs the global `fetch` used by both fetch-source.ts (CSV
// download) and notify.ts (Slack webhook POST), routing by URL so a single
// mock can serve both calls inside one runIngest() invocation.
import { vi } from "vitest";
import { CAO_CSV_URL } from "../../src/ingest/fetch-source.js";

export interface WebhookCall {
  url: string;
  body: { text?: string } | undefined;
}

export interface FetchMockOptions {
  /** Bytes to return for the CSV URL. Omit to simulate an HTTP error. */
  csvBytes?: Uint8Array;
  /** HTTP status for the CSV response. Defaults to 200 when `csvBytes` is set. */
  csvStatus?: number;
}

/**
 * Installs a global fetch stub for the duration of the calling test file.
 * Returns the array webhook POSTs get appended to, plus a `restore()` to undo
 * the stub (call in `afterEach`).
 */
export function installFetchMock(opts: FetchMockOptions): {
  webhookCalls: WebhookCall[];
  restore: () => void;
} {
  const webhookCalls: WebhookCall[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === CAO_CSV_URL) {
      if (opts.csvBytes === undefined) {
        return new Response("", { status: opts.csvStatus ?? 500 });
      }
      return new Response(opts.csvBytes, { status: opts.csvStatus ?? 200 });
    }

    // Anything else is treated as the notify() webhook.
    const bodyText = typeof init?.body === "string" ? init.body : undefined;
    webhookCalls.push({ url, body: bodyText ? JSON.parse(bodyText) : undefined });
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  return {
    webhookCalls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
