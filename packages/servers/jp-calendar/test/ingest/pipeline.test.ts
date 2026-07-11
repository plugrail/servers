import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { runIngest } from "../../src/ingest/pipeline.js";
import { fixtureBytes } from "../fixtures/holiday-csv.js";
import { getHolidays, getIngestRuns, latestIngestRun, resetDb } from "./db-helpers.js";
import { installFetchMock } from "./fetch-mock.js";

const NOW = new Date("2026-07-10T00:00:00Z");
// Set NOTIFY_WEBHOOK_URL so notify() actually attempts the webhook POST
// (installFetchMock treats any non-CSV URL as the webhook) — production env
// doesn't set this until the secret is provisioned (see notify.test.ts for
// the "unset" behaviour).
const TEST_ENV = { ...env, NOTIFY_WEBHOOK_URL: "https://hooks.slack.example/webhook" };

describe("runIngest — full lifecycle", () => {
  afterEach(async () => {
    await resetDb();
  });

  it("first run: full seed from an empty table", async () => {
    await resetDb();
    const mock = installFetchMock({ csvBytes: fixtureBytes("validBase") });

    const result = await runIngest(TEST_ENV, { now: NOW });

    expect(result.status).toBe("ok");
    expect(result.diff?.added).toHaveLength(93);
    expect(result.diff?.removed).toHaveLength(0);
    expect(result.diff?.changed).toHaveLength(0);

    const holidays = await getHolidays();
    expect(holidays).toHaveLength(93);
    expect(holidays.find((h) => h.date === "1955-01-01")).toEqual({
      date: "1955-01-01",
      name: "元日",
    });

    const run = await latestIngestRun();
    expect(run?.status).toBe("ok");
    expect(run?.rows_added).toBe(93);
    expect(run?.rows_removed).toBe(0);
    expect(run?.rows_changed).toBe(0);
    expect(run?.source).toBe("cao_syukujitsu_csv");
    expect(run?.source_hash).toBeTruthy();

    // A non-empty diff notifies.
    expect(mock.webhookCalls).toHaveLength(1);
    expect(mock.webhookCalls[0]?.body?.text).toContain("追加93件");

    mock.restore();
  });

  it("re-running the same CSV detects no_change, does not notify, and leaves D1 untouched", async () => {
    await resetDb();
    const seedMock = installFetchMock({ csvBytes: fixtureBytes("validBase") });
    await runIngest(TEST_ENV, { now: NOW });
    seedMock.restore();

    const holidaysBefore = await getHolidays();

    const mock = installFetchMock({ csvBytes: fixtureBytes("validBase") });
    const result = await runIngest(TEST_ENV, { now: NOW });
    mock.restore();

    expect(result.status).toBe("no_change");
    const holidaysAfter = await getHolidays();
    expect(holidaysAfter).toEqual(holidaysBefore);

    const runs = await getIngestRuns();
    expect(runs).toHaveLength(2);
    expect(runs[1]?.status).toBe("no_change");

    // no_change must NOT notify.
    expect(mock.webhookCalls).toHaveLength(0);
  });

  it("an updated CSV (added + removed + changed) is diffed, applied, and notified", async () => {
    await resetDb();
    const seedMock = installFetchMock({ csvBytes: fixtureBytes("validBase") });
    await runIngest(TEST_ENV, { now: NOW });
    seedMock.restore();

    const mock = installFetchMock({ csvBytes: fixtureBytes("validUpdated") });
    const result = await runIngest(TEST_ENV, { now: NOW });

    expect(result.status).toBe("ok");
    expect(result.diff?.added).toEqual([{ date: "2028-01-01", name: "元日" }]);
    expect(result.diff?.removed).toEqual([{ date: "2027-11-23", name: "勤労感謝の日" }]);
    expect(result.diff?.changed).toEqual([
      { date: "2026-02-11", from: "建国記念の日", to: "建国記念の日(改称)" },
    ]);

    const holidays = await getHolidays();
    expect(holidays).toHaveLength(93); // net unchanged: +1 -1
    expect(holidays.find((h) => h.date === "2028-01-01")).toEqual({
      date: "2028-01-01",
      name: "元日",
    });
    expect(holidays.find((h) => h.date === "2027-11-23")).toBeUndefined();
    expect(holidays.find((h) => h.date === "2026-02-11")).toEqual({
      date: "2026-02-11",
      name: "建国記念の日(改称)",
    });

    const run = await latestIngestRun();
    expect(run?.status).toBe("ok");
    expect(run?.rows_added).toBe(1);
    expect(run?.rows_removed).toBe(1);
    expect(run?.rows_changed).toBe(1);

    expect(mock.webhookCalls).toHaveLength(1);
    expect(mock.webhookCalls[0]?.body?.text).toContain("追加1件 / 削除1件 / 変更1件");

    mock.restore();
  });
});

describe("runIngest — validation failures leave D1 untouched (禁止事項)", () => {
  afterEach(async () => {
    await resetDb();
  });

  it("a >5% row-count decrease fails validation without writing to D1", async () => {
    await resetDb();
    const seedMock = installFetchMock({ csvBytes: fixtureBytes("validBase") });
    await runIngest(TEST_ENV, { now: NOW });
    seedMock.restore();
    const before = await getHolidays();

    const mock = installFetchMock({ csvBytes: fixtureBytes("truncated") });
    const result = await runIngest(TEST_ENV, { now: NOW });
    mock.restore();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("減少");

    const after = await getHolidays();
    expect(after).toEqual(before); // untouched

    const run = await latestIngestRun();
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("減少");
    expect(run?.rows_added).toBeNull();

    expect(mock.webhookCalls).toHaveLength(1); // failed always notifies
  });

  it("an invalid date format in one row fails validation without writing to D1", async () => {
    await resetDb();
    const seedMock = installFetchMock({ csvBytes: fixtureBytes("validBase") });
    await runIngest(TEST_ENV, { now: NOW });
    seedMock.restore();
    const before = await getHolidays();

    const mock = installFetchMock({ csvBytes: fixtureBytes("invalidDateFormat") });
    const result = await runIngest(TEST_ENV, { now: NOW });
    mock.restore();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("不正");

    const after = await getHolidays();
    expect(after).toEqual(before);

    const run = await latestIngestRun();
    expect(run?.status).toBe("failed");
    expect(mock.webhookCalls).toHaveLength(1);
  });

  it("a year outside 1955..now+2 fails validation without writing to D1", async () => {
    await resetDb();
    const seedMock = installFetchMock({ csvBytes: fixtureBytes("validBase") });
    await runIngest(TEST_ENV, { now: NOW });
    seedMock.restore();
    const before = await getHolidays();

    const mock = installFetchMock({ csvBytes: fixtureBytes("yearOutOfRange") });
    const result = await runIngest(TEST_ENV, { now: NOW });
    mock.restore();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("年範囲外");

    const after = await getHolidays();
    expect(after).toEqual(before);
  });

  it("an HTTP error fetching the CSV fails immediately without writing to D1", async () => {
    await resetDb();
    const seedMock = installFetchMock({ csvBytes: fixtureBytes("validBase") });
    await runIngest(TEST_ENV, { now: NOW });
    seedMock.restore();
    const before = await getHolidays();

    const mock = installFetchMock({ csvStatus: 500 });
    const result = await runIngest(TEST_ENV, { now: NOW });
    mock.restore();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("500");

    const after = await getHolidays();
    expect(after).toEqual(before);

    const run = await latestIngestRun();
    expect(run?.status).toBe("failed");
    expect(run?.source_hash).toBeNull(); // never got far enough to hash bytes
    expect(mock.webhookCalls).toHaveLength(1);
  });

  it("an empty response body fails immediately without writing to D1", async () => {
    await resetDb();
    const seedMock = installFetchMock({ csvBytes: fixtureBytes("validBase") });
    await runIngest(TEST_ENV, { now: NOW });
    seedMock.restore();
    const before = await getHolidays();

    const mock = installFetchMock({ csvBytes: new Uint8Array(0) });
    const result = await runIngest(TEST_ENV, { now: NOW });
    mock.restore();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("empty");

    const after = await getHolidays();
    expect(after).toEqual(before);
  });
});
