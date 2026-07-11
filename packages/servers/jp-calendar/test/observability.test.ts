import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import jpCalendarWorker from "../src/index.js";
import { seedHolidaysFixture } from "./setup/seed-holidays.js";

// 1A-6: structured logging (req_id / X-Request-Id) + the Sentry notification
// smoke-test route (/__debug/error). Drives the REAL wired jp-calendar worker
// (same `defineMcpServer` factory every server uses), same SELF.fetch pattern
// as smoke.test.ts / auth-rate-limit.test.ts.

const PROTOCOL_VERSION = "2025-06-18";

const dummyCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

async function readMessage(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (ct.includes("text/event-stream")) {
    const dataLines = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice("data:".length).trim());
    return JSON.parse(dataLines[dataLines.length - 1] ?? "null");
  }
  return text ? JSON.parse(text) : null;
}

function parsedLogLines(spy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return spy.mock.calls.map((call) => JSON.parse(call[0] as string));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("1A-6: X-Request-Id + structured logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /healthz returns a unique X-Request-Id header per request", async () => {
    const res1 = await SELF.fetch("https://example.com/healthz");
    const res2 = await SELF.fetch("https://example.com/healthz");
    const id1 = res1.headers.get("X-Request-Id");
    const id2 = res2.headers.get("X-Request-Id");
    expect(id1).toMatch(UUID_RE);
    expect(id2).toMatch(UUID_RE);
    expect(id1).not.toBe(id2);
  });

  it("GET / (landing page) also carries X-Request-Id", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(res.headers.get("X-Request-Id")).toMatch(UUID_RE);
  });

  it("404 responses also carry X-Request-Id", async () => {
    const res = await SELF.fetch("https://example.com/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Request-Id")).toMatch(UUID_RE);
  });

  it("emits one http_request log line per request, with req_id matching the response header", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const res = await SELF.fetch("https://example.com/healthz");
    const reqId = res.headers.get("X-Request-Id");

    const httpRequestLines = parsedLogLines(logSpy).filter((l) => l.event === "http_request");
    expect(httpRequestLines).toHaveLength(1);
    expect(httpRequestLines[0]).toMatchObject({
      level: "info",
      server: "jp-calendar",
      method: "GET",
      path: "/healthz",
      status: 200,
      req_id: reqId,
    });
    expect(typeof httpRequestLines[0]?.duration_ms).toBe("number");
  });

  describe("tool call logging (no PII/args)", () => {
    beforeAll(async () => {
      await seedHolidaysFixture();
    });

    it("emits a tool_call log line with server/tool/status/duration_ms/req_id but never the raw arguments", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

      const res = await SELF.fetch("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": PROTOCOL_VERSION,
          "CF-Connecting-IP": "203.0.113.77",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "is_holiday", arguments: { date: "2026-01-01" } },
        }),
      });
      const reqId = res.headers.get("X-Request-Id");
      const msg = (await readMessage(res)) as { result?: { isError?: boolean } };
      expect(msg.result?.isError).toBeFalsy();

      const toolCallLines = parsedLogLines(logSpy).filter((l) => l.event === "tool_call");
      expect(toolCallLines).toHaveLength(1);
      expect(toolCallLines[0]).toMatchObject({
        level: "info",
        server: "jp-calendar",
        tool: "is_holiday",
        status: "ok",
        req_id: reqId,
      });
      expect(typeof toolCallLines[0]?.duration_ms).toBe("number");
      // 禁止事項 (1A-6): no tool arguments, no raw IP anywhere in any log line
      // emitted for this request.
      for (const line of parsedLogLines(logSpy)) {
        const raw = JSON.stringify(line);
        expect(raw).not.toContain("2026-01-01");
        expect(raw).not.toContain("203.0.113.77");
      }
    });
  });
});

describe("1A-6: GET /__debug/error (Sentry notification smoke test)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("404s (indistinguishable from an unknown route) when DEBUG_ERROR_TOKEN is not configured", async () => {
    // wrangler.jsonc never sets DEBUG_ERROR_TOKEN as a var (it's secret-only,
    // opt-in) — the real deployed default, and the default in this test env.
    const res = await SELF.fetch("https://example.com/__debug/error", {
      headers: { "x-debug-token": "anything" },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("404s when a token IS configured but the caller's header doesn't match", async () => {
    const res = await jpCalendarWorker.fetch(
      new Request("https://example.com/__debug/error", {
        headers: { "x-debug-token": "wrong" },
      }),
      { ...env, DEBUG_ERROR_TOKEN: "correct-token" },
      dummyCtx,
    );
    expect(res.status).toBe(404);
  });

  it("throws intentionally and surfaces as a 500 + unhandled_exception log line when the token matches", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await jpCalendarWorker.fetch(
      new Request("https://example.com/__debug/error", {
        headers: { "x-debug-token": "correct-token" },
      }),
      { ...env, DEBUG_ERROR_TOKEN: "correct-token" },
      dummyCtx,
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("internal");
    expect(res.headers.get("X-Request-Id")).toMatch(UUID_RE);

    const errorLines = parsedLogLines(errorSpy).filter((l) => l.event === "unhandled_exception");
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]).toMatchObject({
      level: "error",
      server: "jp-calendar",
      path: "/__debug/error",
    });
    expect(String(errorLines[0]?.error)).toContain("Sentry notification smoke test");
  });
});
