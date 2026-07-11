// Step 5: notify() — Slack Incoming Webhook on diff-or-failed (1B-1 Step 3-5).
//
// no_change is NOT notified (recorded in ingest_runs only). When
// NOTIFY_WEBHOOK_URL isn't configured, this logs and returns — it never
// throws, so a missing secret can't fail the ingest run itself.

import type { HolidayDiff } from "./types.js";

export interface NotifyPayload {
  status: "ok" | "failed";
  source: string;
  ts: string;
  diff?: HolidayDiff;
  error?: string;
}

export async function notify(env: Env, payload: NotifyPayload): Promise<void> {
  const url = env.NOTIFY_WEBHOOK_URL;
  if (!url) {
    console.log(
      `[jp-calendar/ingest] NOTIFY_WEBHOOK_URL is not set — skipping notify. ${JSON.stringify(payload)}`,
    );
    return;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: formatSlackText(payload) }),
    });
    if (!res.ok) {
      console.error(`[jp-calendar/ingest] notify webhook returned HTTP ${res.status}`);
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[jp-calendar/ingest] notify webhook request failed: ${message}`);
  }
}

function formatSlackText(payload: NotifyPayload): string {
  if (payload.status === "failed") {
    return (
      `:rotating_light: [jp-calendar] 祝日CSV取込失敗 (${payload.ts})\n` +
      `source: ${payload.source}\nerror: ${payload.error ?? "unknown"}`
    );
  }
  const diff = payload.diff;
  const summary = diff
    ? `追加${diff.added.length}件 / 削除${diff.removed.length}件 / 変更${diff.changed.length}件`
    : "(差分なし)";
  return `:calendar: [jp-calendar] 祝日CSV取込完了 (${payload.ts})\n${summary}`;
}
