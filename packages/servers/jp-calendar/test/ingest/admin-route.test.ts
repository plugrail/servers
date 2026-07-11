import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleAdminIngest } from "../../src/ingest/admin-route.js";
import { fixtureBytes } from "../fixtures/holiday-csv.js";
import { getIngestRuns, resetDb } from "./db-helpers.js";
import { installFetchMock } from "./fetch-mock.js";

// TODO(1A-3): once plan="admin" API-key verification lands, these tests should
// be extended (or replaced) to cover that path; the ADMIN_TOKEN Bearer check
// below is the interim guard (see src/ingest/admin-route.ts).

const dummyCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function req(init?: RequestInit): Request {
  return new Request("https://example.com/admin/ingest", { method: "POST", ...init });
}

describe("POST /admin/ingest", () => {
  it("rejects non-POST methods", async () => {
    const res = await handleAdminIngest(
      new Request("https://example.com/admin/ingest", { method: "GET" }),
      { ...env, ADMIN_TOKEN: "secret" },
      dummyCtx,
    );
    expect(res.status).toBe(405);
  });

  it("returns 503 when ADMIN_TOKEN is not configured", async () => {
    const res = await handleAdminIngest(req(), { ...env, ADMIN_TOKEN: undefined }, dummyCtx);
    expect(res.status).toBe(503);
  });

  it("returns 401 when no Authorization header is present", async () => {
    const res = await handleAdminIngest(req(), { ...env, ADMIN_TOKEN: "secret" }, dummyCtx);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the Bearer token doesn't match ADMIN_TOKEN", async () => {
    const res = await handleAdminIngest(
      req({ headers: { authorization: "Bearer wrong-token" } }),
      { ...env, ADMIN_TOKEN: "secret" },
      dummyCtx,
    );
    expect(res.status).toBe(401);
  });

  it("runs the ingest pipeline and returns 200 when the Bearer token matches", async () => {
    await resetDb();
    const mock = installFetchMock({ csvBytes: fixtureBytes("validBase") });

    const res = await handleAdminIngest(
      req({ headers: { authorization: "Bearer secret" } }),
      { ...env, ADMIN_TOKEN: "secret" },
      dummyCtx,
    );
    mock.restore();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result: { status: string } };
    expect(body.ok).toBe(true);
    expect(body.result.status).toBe("ok");

    const runs = await getIngestRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("ok");

    await resetDb();
  });
});
