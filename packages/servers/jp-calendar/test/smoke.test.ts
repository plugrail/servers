import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { SEED_DATA_AS_OF, seedHolidaysFixture } from "./setup/seed-holidays.js";

// Integration tests for the 1A-2 factory as wired into jp-calendar. They drive
// the real Streamable HTTP MCP endpoint through SELF.fetch (Workers runtime).
//
// The endpoint is STATELESS (Cloudflare `createMcpHandler` with no session
// store — see ADR-001): every request builds a fresh McpServer, so each
// JSON-RPC call is a self-contained POST with no `mcp-session-id` / handshake
// carried between requests.

const MCP_URL = "https://example.com/mcp";
const PROTOCOL_VERSION = "2025-06-18";

/** Parse a Streamable HTTP response (either application/json or SSE) into its JSON-RPC message. */
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

/** POST a single JSON-RPC message to /mcp. */
function rpc(body: unknown): Promise<Response> {
  return SELF.fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
    },
    body: JSON.stringify(body),
  });
}

describe("jp-calendar HTTP surface", () => {
  it("GET /healthz returns status + name + version", async () => {
    const res = await SELF.fetch("https://example.com/healthz");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      name: "jp-calendar",
      version: "0.1.0",
    });
  });

  it("GET / returns a landing document with connect instructions", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      name: string;
      endpoint: string;
      transport: string;
      connect: { config: { url: string } };
    };
    expect(body.name).toBe("jp-calendar");
    expect(body.endpoint).toBe("/mcp");
    expect(body.transport).toBe("streamable-http");
    expect(body.connect.config.url).toBe("https://example.com/mcp");
  });

  it("unknown paths return 404 JSON", async () => {
    const res = await SELF.fetch("https://example.com/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("not_found");
  });
});

describe("jp-calendar MCP protocol", () => {
  beforeAll(async () => {
    await seedHolidaysFixture();
  });

  it("initialize returns serverInfo for jp-calendar", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "vitest", version: "0.0.0" },
      },
    });
    expect(res.status).toBe(200);
    const msg = (await readMessage(res)) as {
      result?: { serverInfo?: { name?: string; version?: string } };
    };
    expect(msg.result?.serverInfo?.name).toBe("jp-calendar");
    expect(msg.result?.serverInfo?.version).toBe("0.1.0");
  });

  it("tools/list advertises is_holiday and list_holidays", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const msg = (await readMessage(res)) as {
      result: { tools: Array<{ name: string; description: string }> };
    };
    const names = msg.result.tools.map((t) => t.name);
    expect(names).toContain("is_holiday");
    expect(names).toContain("list_holidays");
  });

  it("tools/call(is_holiday) returns an envelope with sources + disclaimer + data_as_of", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "is_holiday", arguments: { date: "2026-01-01" } },
    });
    const msg = (await readMessage(res)) as {
      result: {
        content: Array<{ type: string; text: string }>;
        structuredContent: {
          ok: boolean;
          data: { date: string; is_holiday: boolean; holiday_name: string | null };
          meta: {
            sources: Array<{ name: string; url: string }>;
            disclaimer: string;
            data_as_of?: string;
          };
        };
        isError?: boolean;
      };
    };
    const { result } = msg;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.data).toEqual({
      date: "2026-01-01",
      is_holiday: true,
      holiday_name: "元日",
      weekday: "木",
      is_weekend: false,
    });
    expect(result.structuredContent.meta.sources.length).toBeGreaterThan(0);
    expect(result.structuredContent.meta.data_as_of).toBe(SEED_DATA_AS_OF);
    expect(result.structuredContent.meta.disclaimer).toContain(
      "https://plugrail.dev/legal/disclaimer",
    );
    // text-only clients still see the citation + disclaimer (1A-7 §7)
    const text = result.content.find((c) => c.type === "text")?.text ?? "";
    expect(text).toContain("元日");
    expect(text).toContain("出典:");
    expect(text).toContain("公式見解を示すものではありません");
  });

  it("tools/call with schema-invalid input (wrong type) is surfaced as an error, never a success", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "is_holiday", arguments: { date: 123 } },
    });
    const msg = (await readMessage(res)) as {
      result?: { isError?: boolean };
      error?: { code: number };
    };
    const errored = msg.result?.isError === true || typeof msg.error?.code === "number";
    expect(errored).toBe(true);
  });

  it("an unknown JSON-RPC method returns a -32601 error", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 5, method: "does/not/exist", params: {} });
    const msg = (await readMessage(res)) as { error?: { code: number } };
    expect(msg.error?.code).toBe(-32601);
  });
});
