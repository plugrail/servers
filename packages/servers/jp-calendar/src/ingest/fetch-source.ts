// Step 1: fetchSource() — download + decode the 内閣府 holiday CSV (1B-1 Step 3-1).

/** 内閣府 祝日CSV。概要ページ: https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html */
export const CAO_CSV_URL = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";

export class SourceFetchError extends Error {}

export interface FetchedSource {
  /** UTF-8 decoded CSV text (source bytes are Shift_JIS — see below). */
  text: string;
  /** sha256 (hex) of the raw response bytes, for change detection. */
  sourceHash: string;
}

/**
 * Fetch the CSV and decode it. The 内閣府 file is Shift_JIS-encoded (confirmed
 * against the live file, 2026-07-10). Cloudflare Workers' `TextDecoder` is
 * backed by full ICU data (unlike Node's default build), so
 * `new TextDecoder("shift_jis")` works without a userland conversion library
 * — verified in test/ingest/shift-jis.test.ts against a real byte fixture.
 *
 * HTTP errors and empty bodies fail immediately (never silently proceed with
 * no data — the caller records this as an ingest_runs "failed" row).
 */
export async function fetchSource(url: string = CAO_CSV_URL): Promise<FetchedSource> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "plugrail-jp-calendar-ingest/1.0 (+https://plugrail.dev)" },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new SourceFetchError(`fetch failed for ${url}: ${message}`);
  }

  if (!res.ok) {
    throw new SourceFetchError(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new SourceFetchError(`empty response body from ${url}`);
  }

  const text = new TextDecoder("shift_jis").decode(bytes);
  const sourceHash = await sha256Hex(bytes);
  return { text, sourceHash };
}

/** sha256 of raw bytes, hex-encoded. Used as ingest_runs.source_hash. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
