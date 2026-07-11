import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { notify } from "../../src/ingest/notify.js";

describe("notify", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("skips the HTTP call (logs only) when NOTIFY_WEBHOOK_URL is unset", async () => {
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await notify(
      { ...env, NOTIFY_WEBHOOK_URL: undefined },
      { status: "ok", source: "s", ts: "2026-07-10T00:00:00Z" },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs a Slack-shaped payload when NOTIFY_WEBHOOK_URL is set", async () => {
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok", { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await notify(
      { ...env, NOTIFY_WEBHOOK_URL: "https://hooks.slack.example/abc" },
      {
        status: "ok",
        source: "cao_syukujitsu_csv",
        ts: "2026-07-10T00:00:00Z",
        diff: {
          added: [{ date: "2028-01-01", name: "元日" }],
          removed: [],
          changed: [],
        },
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://hooks.slack.example/abc");
    const body = JSON.parse((init?.body as string) ?? "{}") as { text: string };
    expect(body.text).toContain("追加1件");
  });

  it("does not throw when the webhook POST itself fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(
      notify(
        { ...env, NOTIFY_WEBHOOK_URL: "https://hooks.slack.example/abc" },
        { status: "failed", source: "s", ts: "2026-07-10T00:00:00Z", error: "boom" },
      ),
    ).resolves.toBeUndefined();
  });
});
