import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { DATA_RANGE, SEED_DATA_AS_OF, seedHolidaysFixture } from "../setup/seed-holidays.js";

// 1B-2: is_holiday / list_holidays, exercised end-to-end through the real
// Streamable HTTP MCP endpoint (same style as ../smoke.test.ts) so every test
// also proves the 封筒 (structuredContent shape, citation, disclaimer) and the
// MCP protocol wiring, not just the tools' internal logic.
//
// The self-hosted worker accepts anonymous requests, so this suite exercises
// the MCP surface without authentication setup.

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

let nextId = 100;

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

beforeAll(async () => {
  await seedHolidaysFixture();
});

describe("tools/list — descriptions match the 1B-2 spec text exactly", () => {
  it("advertises is_holiday and list_holidays with the confirmed description wording", async () => {
    const res = await SELF.fetch(MCP_URL, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const msg = (await readMessage(res)) as {
      result: { tools: Array<{ name: string; description: string }> };
    };
    const byName = Object.fromEntries(msg.result.tools.map((t) => [t.name, t.description]));

    expect(byName.is_holiday).toBe(
      "指定した日付が日本の祝日（国民の祝日・休日）かどうかを判定します。内閣府公表データに基づきます。" +
        '入力例: {"date": "2026-01-01"}',
    );
    expect(byName.list_holidays).toBe(
      "指定した年または期間の日本の祝日一覧を返します。" +
        '入力例: {"year": 2026} または {"from": "2026-01-01", "to": "2026-06-30"}',
    );
  });
});

describe("is_holiday", () => {
  it("a holiday: 2026-01-01 → true, 元日, 木, not a weekend", async () => {
    const msg = await callTool("is_holiday", { date: "2026-01-01" });
    expect(msg.result?.isError).toBeFalsy();
    expect(msg.result?.structuredContent?.data).toEqual({
      date: "2026-01-01",
      is_holiday: true,
      holiday_name: "元日",
      weekday: "木",
      is_weekend: false,
    });
  });

  it("a plain weekday: 2026-01-05 (Mon) → false, holiday_name null", async () => {
    const msg = await callTool("is_holiday", { date: "2026-01-05" });
    expect(msg.result?.isError).toBeFalsy();
    expect(msg.result?.structuredContent?.data).toEqual({
      date: "2026-01-05",
      is_holiday: false,
      holiday_name: null,
      weekday: "月",
      is_weekend: false,
    });
  });

  it("a Saturday: 2026-01-10 → is_weekend true, is_holiday false", async () => {
    const msg = await callTool("is_holiday", { date: "2026-01-10" });
    expect(msg.result?.isError).toBeFalsy();
    expect(msg.result?.structuredContent?.data).toEqual({
      date: "2026-01-10",
      is_holiday: false,
      holiday_name: null,
      weekday: "土",
      is_weekend: true,
    });
  });

  it.each([
    ["2026/01/01"],
    ["2026-02-30"],
    [""],
  ])("input error %s → invalid_input", async (date) => {
    const msg = await callTool("is_holiday", { date });
    expect(msg.result?.isError).toBe(true);
    expect(msg.result?.structuredContent?.ok).toBe(false);
    expect(msg.result?.structuredContent?.error?.code).toBe("invalid_input");
  });

  it("out of data range: 1900-01-01 → out_of_data_range with min/max in the hint", async () => {
    const msg = await callTool("is_holiday", { date: "1900-01-01" });
    expect(msg.result?.isError).toBe(true);
    const error = msg.result?.structuredContent?.error;
    expect(error?.code).toBe("out_of_data_range");
    expect(error?.hint).toContain(DATA_RANGE.min);
    expect(error?.hint).toContain(DATA_RANGE.max);
  });

  it("envelope: sources / disclaimer / data_as_of are present on success", async () => {
    const msg = await callTool("is_holiday", { date: "2026-01-01" });
    const meta = msg.result?.structuredContent?.meta;
    expect(meta?.sources?.length).toBeGreaterThan(0);
    expect(meta?.disclaimer).toContain("https://plugrail.dev/legal/disclaimer");
    expect(meta?.data_as_of).toBe(SEED_DATA_AS_OF);
  });
});

describe("list_holidays", () => {
  it("year=2026 → 18 holidays, ordered, 元日 first and 勤労感謝の日 last", async () => {
    const msg = await callTool("list_holidays", { year: 2026 });
    expect(msg.result?.isError).toBeFalsy();
    const data = msg.result?.structuredContent?.data as {
      holidays: Array<{ date: string; name: string }>;
      count: number;
    };
    expect(data.count).toBe(18);
    expect(data.holidays).toHaveLength(18);
    expect(data.holidays[0]).toEqual({ date: "2026-01-01", name: "元日" });
    expect(data.holidays.at(-1)).toEqual({ date: "2026-11-23", name: "勤労感謝の日" });
  });

  it("from/to half-year (2026-01-01..2026-06-30) → 10 holidays", async () => {
    const msg = await callTool("list_holidays", { from: "2026-01-01", to: "2026-06-30" });
    expect(msg.result?.isError).toBeFalsy();
    const data = msg.result?.structuredContent?.data as { count: number };
    expect(data.count).toBe(10);
  });

  it("year AND from/to together → invalid_input", async () => {
    const msg = await callTool("list_holidays", {
      year: 2026,
      from: "2026-01-01",
      to: "2026-06-30",
    });
    expect(msg.result?.isError).toBe(true);
    expect(msg.result?.structuredContent?.error?.code).toBe("invalid_input");
  });

  it("neither year nor from/to → invalid_input", async () => {
    const msg = await callTool("list_holidays", {});
    expect(msg.result?.isError).toBe(true);
    expect(msg.result?.structuredContent?.error?.code).toBe("invalid_input");
  });

  it("a 6-year span → invalid_input with a hint to split the range", async () => {
    const msg = await callTool("list_holidays", { from: "2020-01-01", to: "2026-01-01" });
    expect(msg.result?.isError).toBe(true);
    const error = msg.result?.structuredContent?.error;
    expect(error?.code).toBe("invalid_input");
    expect(error?.hint).toContain("5年");
  });

  it("exactly a 5-year span is allowed (boundary)", async () => {
    const msg = await callTool("list_holidays", { from: "2020-01-01", to: "2025-01-01" });
    expect(msg.result?.isError).toBeFalsy();
    expect(msg.result?.structuredContent?.ok).toBe(true);
  });

  it("a holiday-free short period → count 0, ok:true (not an error)", async () => {
    const msg = await callTool("list_holidays", { from: "2026-01-02", to: "2026-01-11" });
    expect(msg.result?.isError).toBeFalsy();
    expect(msg.result?.structuredContent?.ok).toBe(true);
    const data = msg.result?.structuredContent?.data as {
      holidays: Array<{ date: string; name: string }>;
      count: number;
    };
    expect(data.count).toBe(0);
    expect(data.holidays).toEqual([]);
  });

  it("envelope: sources / disclaimer / data_as_of are present on success", async () => {
    const msg = await callTool("list_holidays", { year: 2026 });
    const meta = msg.result?.structuredContent?.meta;
    expect(meta?.sources?.length).toBeGreaterThan(0);
    expect(meta?.disclaimer).toContain("https://plugrail.dev/legal/disclaimer");
    expect(meta?.data_as_of).toBe(SEED_DATA_AS_OF);
  });
});
