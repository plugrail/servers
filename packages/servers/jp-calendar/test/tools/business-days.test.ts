import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { DATA_RANGE, SEED_DATA_AS_OF, seedHolidaysFixture } from "../setup/seed-holidays.js";

// 1B-3: add_business_days / business_days_between, exercised end-to-end
// through the real Streamable HTTP MCP endpoint (same style as
// ../tools/holidays.test.ts / ../smoke.test.ts) so every test also proves the
// 封筒 (structuredContent shape, citations, disclaimer) and the MCP protocol
// wiring — not just calendar.ts's internal logic (covered in isolation by
// ../calendar.test.ts).
//
// The self-hosted worker accepts anonymous requests, so this suite needs no
// authentication setup.

const MCP_URL = "https://example.com/mcp";
const PROTOCOL_VERSION = "2025-06-18";

function requestHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL_VERSION,
  };
}

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

interface CallToolMessage {
  result?: {
    content: Array<{ type: string; text: string }>;
    structuredContent?: {
      ok: boolean;
      data?: unknown;
      error?: { code: string; message: string; hint?: string };
      meta: {
        sources?: Array<{ name: string; url: string }>;
        disclaimer: string;
        data_as_of?: string;
      };
    };
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

let nextId = 1000;

async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolMessage> {
  const res = await SELF.fetch(MCP_URL, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return (await readMessage(res)) as CallToolMessage;
}

interface AddResultData {
  result: string;
  input_date: string;
  days: number;
  calendar: string;
  skipped: Array<{ date: string; reason: string }>;
  skipped_total: number;
}

interface BetweenResultData {
  business_days: number;
  from: string;
  to: string;
  include_from: boolean;
  include_to: boolean;
  calendar: string;
}

beforeAll(async () => {
  await seedHolidaysFixture();
});

describe("tools/list — advertises both 1B-3 tools", () => {
  it("lists add_business_days and business_days_between", async () => {
    const res = await SELF.fetch(MCP_URL, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const msg = (await readMessage(res)) as { result: { tools: Array<{ name: string }> } };
    const names = msg.result.tools.map((t) => t.name);
    expect(names).toContain("add_business_days");
    expect(names).toContain("business_days_between");
  });
});

describe("add_business_days", () => {
  it("required case 1: Friday + 1 business day => the following Monday", async () => {
    const msg = await callTool("add_business_days", { date: "2026-07-10", days: 1 });
    expect(msg.result?.isError).toBeFalsy();
    const data = msg.result?.structuredContent?.data as AddResultData;
    expect(data.result).toBe("2026-07-13");
    expect(data.calendar).toBe("standard");
    expect(data.skipped).toEqual([
      { date: "2026-07-11", reason: "土曜日" },
      { date: "2026-07-12", reason: "日曜日" },
    ]);
    expect(data.skipped_total).toBe(2);
  });

  it("required case 1 (negative direction): Friday - 1 business day => the previous Thursday", async () => {
    const msg = await callTool("add_business_days", { date: "2026-07-10", days: -1 });
    expect(msg.result?.isError).toBeFalsy();
    const data = msg.result?.structuredContent?.data as AddResultData;
    expect(data.result).toBe("2026-07-09");
    expect(data.skipped).toEqual([]);
  });

  it("spec's worked example: 2026-07-10 + 3 business days => 2026-07-15", async () => {
    const msg = await callTool("add_business_days", { date: "2026-07-10", days: 3 });
    const data = msg.result?.structuredContent?.data as AddResultData;
    expect(data.result).toBe("2026-07-15");
  });

  it("required case 2: 6 business days from 2026-04-24 crosses the entire GW cluster to 05-08", async () => {
    const msg = await callTool("add_business_days", { date: "2026-04-24", days: 6 });
    const data = msg.result?.structuredContent?.data as AddResultData;
    expect(data.result).toBe("2026-05-08");
    expect(data.skipped.map((s) => s.date)).toEqual([
      "2026-04-25",
      "2026-04-26",
      "2026-04-29",
      "2026-05-02",
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
    ]);
  });

  it("required case 3: 2026-12-30 + 1 differs between standard (12/31) and banking (1/4)", async () => {
    const standard = await callTool("add_business_days", {
      date: "2026-12-30",
      days: 1,
      calendar: "standard",
    });
    const banking = await callTool("add_business_days", {
      date: "2026-12-30",
      days: 1,
      calendar: "banking",
    });
    const standardData = standard.result?.structuredContent?.data as AddResultData;
    const bankingData = banking.result?.structuredContent?.data as AddResultData;
    expect(standardData.result).toBe("2026-12-31");
    expect(bankingData.result).toBe("2027-01-04");
  });

  it("banking calendar cites the legal basis alongside 内閣府", async () => {
    const msg = await callTool("add_business_days", {
      date: "2026-12-30",
      days: 1,
      calendar: "banking",
    });
    const sources = msg.result?.structuredContent?.meta.sources ?? [];
    expect(sources.some((s) => s.url.includes("e-gov"))).toBe(true);
    expect(sources.length).toBeGreaterThanOrEqual(2);
  });

  it("required case 4: extra_closed_dates=[12-29,12-30] pushes 2026-12-28 + 1 to 2026-12-31", async () => {
    const msg = await callTool("add_business_days", {
      date: "2026-12-28",
      days: 1,
      extra_closed_dates: ["2026-12-29", "2026-12-30"],
    });
    const data = msg.result?.structuredContent?.data as AddResultData;
    expect(data.result).toBe("2026-12-31");
    expect(data.skipped.map((s) => s.date)).toEqual(["2026-12-29", "2026-12-30"]);
  });

  it("required case 5: days=0 => invalid_input with a hint pointing to is_holiday / days=1", async () => {
    const msg = await callTool("add_business_days", { date: "2026-07-10", days: 0 });
    expect(msg.result?.isError).toBe(true);
    const error = msg.result?.structuredContent?.error;
    expect(error?.code).toBe("invalid_input");
    expect(error?.hint).toContain("is_holiday");
    expect(error?.hint).toContain("days=1");
  });

  it("non-integer days => invalid_input", async () => {
    const msg = await callTool("add_business_days", { date: "2026-07-10", days: 1.5 });
    expect(msg.result?.isError).toBe(true);
    expect(msg.result?.structuredContent?.error?.code).toBe("invalid_input");
  });

  it("malformed date => invalid_input", async () => {
    const msg = await callTool("add_business_days", { date: "2026/07/10", days: 1 });
    expect(msg.result?.isError).toBe(true);
    expect(msg.result?.structuredContent?.error?.code).toBe("invalid_input");
  });

  it("invalid calendar value => invalid_input", async () => {
    const msg = await callTool("add_business_days", {
      date: "2026-07-10",
      days: 1,
      calendar: "lunar",
    });
    expect(msg.result?.isError).toBe(true);
    expect(msg.result?.structuredContent?.error?.code).toBe("invalid_input");
  });

  it("invalid extra_closed_dates entry => invalid_input", async () => {
    const msg = await callTool("add_business_days", {
      date: "2026-07-10",
      days: 1,
      extra_closed_dates: ["2026-13-01"],
    });
    expect(msg.result?.isError).toBe(true);
    expect(msg.result?.structuredContent?.error?.code).toBe("invalid_input");
  });

  it("required case 7: date itself out of the data range => out_of_data_range", async () => {
    const msg = await callTool("add_business_days", { date: "2030-01-01", days: 1 });
    expect(msg.result?.isError).toBe(true);
    const error = msg.result?.structuredContent?.error;
    expect(error?.code).toBe("out_of_data_range");
    expect(error?.hint).toContain(DATA_RANGE.min);
    expect(error?.hint).toContain(DATA_RANGE.max);
  });

  it("required case 7 (calculation-span variant): date is in range but the walk could reach past it", async () => {
    // 2027-11-01 is inside DATA_RANGE, but the generous span estimate for a
    // 5-business-day walk reaches 2027-12-09 — past DATA_RANGE.max
    // (2027-11-23) — so this must refuse rather than guess.
    const msg = await callTool("add_business_days", { date: "2027-11-01", days: 5 });
    expect(msg.result?.isError).toBe(true);
    expect(msg.result?.structuredContent?.error?.code).toBe("out_of_data_range");
  });

  it("required case 8: skipped is truncated at 20 entries but skipped_total carries the real count", async () => {
    const msg = await callTool("add_business_days", { date: "2026-01-01", days: 200 });
    expect(msg.result?.isError).toBeFalsy();
    const data = msg.result?.structuredContent?.data as AddResultData;
    expect(data.result).toBe("2026-10-28");
    expect(data.skipped).toHaveLength(20);
    expect(data.skipped_total).toBeGreaterThan(20);
  });

  it("required case 9: round-trip — add(add(date, n), -n) returns to the original date", async () => {
    const forward = await callTool("add_business_days", { date: "2026-04-24", days: 6 });
    const forwardData = forward.result?.structuredContent?.data as AddResultData;
    const back = await callTool("add_business_days", { date: forwardData.result, days: -6 });
    const backData = back.result?.structuredContent?.data as AddResultData;
    expect(backData.result).toBe("2026-04-24");
  });

  it("envelope: sources / disclaimer / data_as_of present on success (standard calendar)", async () => {
    const msg = await callTool("add_business_days", { date: "2026-07-10", days: 1 });
    const meta = msg.result?.structuredContent?.meta;
    expect(meta?.sources?.length).toBe(1);
    expect(meta?.disclaimer).toContain("https://plugrail.dev/legal/disclaimer");
    expect(meta?.data_as_of).toBe(SEED_DATA_AS_OF);
  });
});

describe("business_days_between", () => {
  it("required case 6: the four boundary combinations over 2026-07-10..2026-07-17", async () => {
    const cases: Array<[boolean, boolean, number]> = [
      [false, true, 5],
      [true, false, 5],
      [true, true, 6],
      [false, false, 4],
    ];
    for (const [includeFrom, includeTo, expected] of cases) {
      const msg = await callTool("business_days_between", {
        from: "2026-07-10",
        to: "2026-07-17",
        include_from: includeFrom,
        include_to: includeTo,
      });
      const data = msg.result?.structuredContent?.data as BetweenResultData;
      expect(data.business_days).toBe(expected);
      expect(data.include_from).toBe(includeFrom);
      expect(data.include_to).toBe(includeTo);
    }
  });

  it("default boundaries (include_from=false, include_to=true) are used when omitted, and echoed back", async () => {
    const msg = await callTool("business_days_between", { from: "2026-07-10", to: "2026-07-17" });
    const data = msg.result?.structuredContent?.data as BetweenResultData;
    expect(data.business_days).toBe(5);
    expect(data.include_from).toBe(false);
    expect(data.include_to).toBe(true);
  });

  it("from === to under default boundaries is 0 business days (not negative, not an error)", async () => {
    const msg = await callTool("business_days_between", { from: "2026-07-10", to: "2026-07-10" });
    expect(msg.result?.isError).toBeFalsy();
    const data = msg.result?.structuredContent?.data as BetweenResultData;
    expect(data.business_days).toBe(0);
  });

  it("banking calendar excludes 12/31-1/3 from the count, unlike standard", async () => {
    const standard = await callTool("business_days_between", {
      from: "2026-12-28",
      to: "2027-01-05",
      calendar: "standard",
    });
    const banking = await callTool("business_days_between", {
      from: "2026-12-28",
      to: "2027-01-05",
      calendar: "banking",
    });
    const standardData = standard.result?.structuredContent?.data as BetweenResultData;
    const bankingData = banking.result?.structuredContent?.data as BetweenResultData;
    expect(standardData.business_days).toBeGreaterThan(bankingData.business_days);
  });

  it("required case 5: from > to => invalid_input", async () => {
    const msg = await callTool("business_days_between", { from: "2026-07-17", to: "2026-07-10" });
    expect(msg.result?.isError).toBe(true);
    expect(msg.result?.structuredContent?.error?.code).toBe("invalid_input");
  });

  it("malformed from/to => invalid_input", async () => {
    const msg = await callTool("business_days_between", { from: "2026-07-10", to: "not-a-date" });
    expect(msg.result?.isError).toBe(true);
    expect(msg.result?.structuredContent?.error?.code).toBe("invalid_input");
  });

  it("required case 7: to beyond the data range => out_of_data_range", async () => {
    const msg = await callTool("business_days_between", {
      from: "2027-11-20",
      to: "2028-01-05",
    });
    expect(msg.result?.isError).toBe(true);
    const error = msg.result?.structuredContent?.error;
    expect(error?.code).toBe("out_of_data_range");
    expect(error?.hint).toContain(DATA_RANGE.max);
  });

  it("envelope: sources / disclaimer / data_as_of present on success", async () => {
    const msg = await callTool("business_days_between", { from: "2026-07-10", to: "2026-07-17" });
    const meta = msg.result?.structuredContent?.meta;
    expect(meta?.sources?.length).toBe(1);
    expect(meta?.disclaimer).toContain("https://plugrail.dev/legal/disclaimer");
    expect(meta?.data_as_of).toBe(SEED_DATA_AS_OF);
  });
});
