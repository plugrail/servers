// MCP server factory (1A-2).
//
// `defineMcpServer` turns a list of tool definitions into a Cloudflare Workers
// `fetch` handler. Adding a new server is one file:
//
//   import { defineMcpServer } from "@plugrail/core";
//   export default defineMcpServer({
//     name: "jp-calendar",
//     version: "0.1.0",
//     tools: [isHolidayTool, listHolidaysTool],
//   });
//
// The MCP transport is Cloudflare's `createMcpHandler` (agents/mcp) — the
// stateless, per-request Streamable HTTP handler Cloudflare recommends for new
// remote MCP servers (see docs/architecture/ADR-001-mcp-server-stack.md). Tool
// definitions use `@modelcontextprotocol/sdk`'s `McpServer`.
//
// 1A-6: every returned handler is wrapped with `@sentry/cloudflare`'s
// `withSentry` (official SDK — `toucan-js` is archived, see
// breakdown/mcp/tasks/phase1/1A-6-RESEARCH.md §A) and emits structured JSON
// logs via `./logging/log.js`. Both are silent no-ops when unconfigured
// (`env.SENTRY_DSN` unset → Sentry disabled; logging always runs — it's
// just `console.*`, which Workers Logs already picks up).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpServer as McpServerImpl } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as Sentry from "@sentry/cloudflare";
import { createMcpHandler } from "agents/mcp";
import type { z } from "zod";
import { err, formatText, type ToolResult, toWireEnvelope } from "./envelope.js";
import { errorMessage, genRequestId, log } from "./logging/log.js";

// ---------------------------------------------------------------------------
// Tool definition.
// ---------------------------------------------------------------------------

/**
 * Auth result populated by the 1A-3 `requireApiKey` middleware and threaded
 * through to every tool handler via {@link ToolContext.auth}. `plan` is a
 * plain `string` here (not a union) so `@plugrail/core` never has to know the
 * concrete plan names an adapter defines (`"anonymous" | "free" |
 * "pro"` today) — keeps this package free of deployment-specific semantics.
 * `keyHash` is the SHA-256 hash of the caller's API key, never the plaintext
 * key (1A-3 禁止事項) — present only for authenticated (non-anonymous) calls.
 * 1A-4 (usage metering) reads this to attribute a call to a plan/key.
 */
export type AuthInfo = {
  plan: string;
  keyHash?: string;
};

/** Runtime context handed to every tool handler. */
export type ToolContext = {
  request: Request;
  env: unknown;
  ctx: ExecutionContext;
  /** Absent only if no auth middleware ran at all (no `middleware` configured). */
  auth?: AuthInfo;
};

/**
 * A tool definition. `handler` MUST return a `ToolResult` built with `ok()` /
 * `err()` (packages/core/src/envelope.ts) — returning a raw payload does not
 * type-check, which is how 出典・免責 enforcement is guaranteed (§10.1).
 *
 * `Shape` is erased to the base `z.ZodRawShape` when stored; `defineTool`
 * preserves the precise input type for the handler author.
 */
export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  /**
   * Description AIが読んでツールを選ぶための文章。書き味の規約:
   *   - 何ができるかを動詞で始める（例:「指定日が日本の祝日かどうかを判定する」）
   *   - 入力の例を含める（例:「date は YYYY-MM-DD、例 2026-01-01」）
   *   - 日本の祝日・営業日という文脈を明示する（AIが「日本の」文脈で選べるように）
   * 長い法的説明は書かない（それは meta.disclaimer / 出典が担う）。
   */
  description: string;
  /** Zod raw shape, e.g. `{ date: z.string() }`. Validated by the SDK. */
  inputSchema: Shape;
  // Input is erased to `any` in the stored definition so tools with different
  // shapes share one array type; `defineTool` re-adds the precise input type for
  // the handler author. `ctx` stays typed.
  // biome-ignore lint/suspicious/noExplicitAny: erased handler input; see defineTool.
  handler: (input: any, ctx: ToolContext) => ToolResult<unknown> | Promise<ToolResult<unknown>>;
  annotations?: ToolAnnotations;
}

/**
 * Identity helper that pins the precise `Shape` so a handler's `input` is fully
 * typed while the returned value is a plain `ToolDefinition` the factory stores.
 * Defining tools in their own files + this helper is the "1ファイル追加で量産"
 * ergonomics target.
 */
export function defineTool<Shape extends z.ZodRawShape, T>(def: {
  name: string;
  description: string;
  inputSchema: Shape;
  handler: (
    input: z.infer<z.ZodObject<Shape>>,
    ctx: ToolContext,
  ) => ToolResult<T> | Promise<ToolResult<T>>;
  annotations?: ToolAnnotations;
}): ToolDefinition<Shape> {
  return def as unknown as ToolDefinition<Shape>;
}

// ---------------------------------------------------------------------------
// Middleware — auth / rate-limit insertion point for 1A-3.
// ---------------------------------------------------------------------------

export type ServerInfo = { name: string; version: string };

/**
 * Mutable bag threaded through the middleware chain for one request. A
 * middleware that resolves an identity (e.g. `requireApiKey`) writes to
 * `state.auth` so a LATER middleware in the same chain (e.g. `rateLimit`,
 * which needs to know the plan) and the tool handler (via
 * `ToolContext.auth`) can read it — middleware has no other way to pass data
 * forward since it can only return `Response | undefined` (1A-3).
 */
export type MiddlewareState = {
  auth?: AuthInfo;
};

/**
 * A middleware runs on the `/mcp` route BEFORE the MCP handler. Return a
 * `Response` to short-circuit (e.g. 401 unauthenticated, 429 rate-limited);
 * return `undefined` to continue to the next middleware / the handler. Mutate
 * `state.auth` to hand identity/plan information to later middleware and the
 * tool handler (see {@link MiddlewareState}).
 *
 * 1A-3 plugs API-key auth and plan-based rate limiting in here as
 * `middleware: [requireApiKey(...), rateLimit(...)]`. `/healthz` and `/` are
 * NOT run through middleware so monitoring (1A-6) and the human landing page
 * stay reachable without a key.
 */
export type Middleware = (
  request: Request,
  env: unknown,
  ctx: ExecutionContext,
  info: ServerInfo,
  state: MiddlewareState,
) => Response | undefined | Promise<Response | undefined>;

// ---------------------------------------------------------------------------
// Instrumentation — usage-metering insertion point for 1A-4.
// ---------------------------------------------------------------------------

/**
 * Outcome of one tool call, handed to `instrumentation` after the call
 * resolves. `"rate_limited"` is reported separately, from the middleware
 * short-circuit path (see `fetch()` below) — a rate-limited request never
 * reaches a tool handler, so there is no real `tool` name for it; `tool` is
 * `"(unknown)"` in that case.
 */
export type ToolCallEvent = {
  tool: string;
  status: "ok" | "error" | "rate_limited";
  /** Wall-clock ms spent in the tool handler (or, for `rate_limited`, in the middleware chain). */
  durationMs: number;
};

/**
 * Optional usage-metering hook (1A-4). Called once per tool call
 * (`status: "ok" | "error"`) and once per middleware short-circuit that
 * returns HTTP 429 (`status: "rate_limited"`) — never for other
 * short-circuits (e.g. a 401 isn't a "call" to attribute usage to). A tool
 * handler never knows this exists — that's the point (1A-4 設計方針: "各ツール
 * 実装側は計測を一切意識しない"). A hosted adapter's usage instrumentation
 * is the concrete implementation; `@plugrail/core` only defines the shape so
 * it stays free of deployment-specific (D1, billing) semantics, same split as
 * `AuthInfo`/`Middleware` above for 1A-3.
 *
 * MUST NOT let a throw escape in a way that breaks the response — the
 * factory wraps every call in `try/catch` as defense in depth, but
 * the concrete recorder already swallows its own write failures too.
 */
export type Instrumentation = (event: ToolCallEvent, ctx: ToolContext, info: ServerInfo) => void;

function runInstrumentation(
  instrumentation: Instrumentation | undefined,
  event: ToolCallEvent,
  ctx: ToolContext,
  info: ServerInfo,
): void {
  if (!instrumentation) return;
  try {
    instrumentation(event, ctx, info);
  } catch {
    // Usage metering must never affect the tool/HTTP response (1A-4 禁止事項).
    // The concrete implementation is responsible for its own error logging;
    // this catch only guards against it throwing synchronously.
  }
}

/**
 * Combine multiple instrumentation hooks into the single slot
 * `DefineMcpServerConfig.instrumentation` accepts. Each hook is isolated by
 * its own `try/catch` so one hook throwing never skips the others (or the
 * response) — same guarantee `runInstrumentation()` gives a single hook.
 *
 * 1A-6 wires a hosted adapter's usage instrumentation (D1, billing)
 * and `@plugrail/core`'s own `analyticsEngineInstrumentation()`
 * (logging/metrics.ts; Workers Analytics Engine, operational) side by side:
 *
 *   instrumentation: composeInstrumentation(usageInstrumentation(), analyticsEngineInstrumentation())
 */
export function composeInstrumentation(...hooks: Instrumentation[]): Instrumentation {
  return (event, ctx, info) => {
    for (const hook of hooks) {
      try {
        hook(event, ctx, info);
      } catch {
        // Defense in depth — each hook is also expected to guard its own
        // errors (same contract as the single-hook case, see Instrumentation
        // doc comment above).
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Server factory.
// ---------------------------------------------------------------------------

export interface DefineMcpServerConfig {
  name: string;
  version: string;
  tools: ToolDefinition[];
  /** Human-readable one-liner for the `/` landing page. */
  description?: string;
  /** Docs URL surfaced on the `/` landing page. */
  docsUrl?: string;
  /** Auth / rate-limit chain for `/mcp` (1A-3). Runs in order. */
  middleware?: Middleware[];
  /** Usage-metering hook (1A-4). See {@link Instrumentation}. */
  instrumentation?: Instrumentation;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Map a branded tool result to an MCP `CallToolResult` (1A-7 §7). */
function toCallToolResult(result: ToolResult<unknown>): CallToolResult {
  const base = {
    content: [{ type: "text" as const, text: formatText(result) }],
    structuredContent: toWireEnvelope(result) as { [k: string]: unknown },
  };
  return result.ok ? base : { ...base, isError: true };
}

/** Build a fresh `McpServer` with all tools registered (stateless, per-request). */
function buildServer(
  config: DefineMcpServerConfig,
  toolCtx: ToolContext,
  info: ServerInfo,
  reqId: string,
): McpServer {
  const server = new McpServerImpl({ name: config.name, version: config.version });
  for (const tool of config.tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      // The SDK validates `args` against `inputSchema` before calling this.
      // Any handler throw is funnelled into a封筒 error — a tool can never
      // return a raw / uncaught response.
      (async (args: unknown) => {
        const startedAt = Date.now();
        let result: ToolResult<unknown>;
        try {
          result = await tool.handler(args as never, toolCtx);
        } catch (error) {
          // 1A-6: a tool handler throwing is exactly the kind of "broke and
          // nobody noticed" event this task exists to surface — report it to
          // Sentry (no-op if SENTRY_DSN is unset) and emit a structured log
          // line, THEN fall back to the same generic 封筒 error as before.
          // Never include the tool's raw arguments (禁止事項) — only the
          // error itself and identifiers already safe to log (server/tool/
          // req_id/key_hash).
          Sentry.captureException(error);
          log("error", "tool_handler_exception", {
            req_id: reqId,
            server: info.name,
            tool: tool.name,
            ...(toolCtx.auth?.keyHash ? { key_hash: toolCtx.auth.keyHash } : {}),
            error: errorMessage(error),
          });
          result = err({
            code: "internal",
            message: "内部エラーが発生しました。",
            hint: "時間をおいて再試行してください。解決しない場合はサポートへご連絡ください。",
          });
        }
        const durationMs = Date.now() - startedAt;
        runInstrumentation(
          config.instrumentation,
          {
            tool: tool.name,
            status: result.ok ? "ok" : "error",
            durationMs,
          },
          toolCtx,
          info,
        );
        log(result.ok ? "info" : "warn", "tool_call", {
          req_id: reqId,
          server: info.name,
          tool: tool.name,
          status: result.ok ? "ok" : "error",
          duration_ms: durationMs,
          ...(toolCtx.auth?.keyHash ? { key_hash: toolCtx.auth.keyHash } : {}),
        });
        return toCallToolResult(result);
        // biome-ignore lint/suspicious/noExplicitAny: SDK ToolCallback generic boundary.
      }) as any,
    );
  }
  return server;
}

/**
 * Constant-time-ish string comparison for the `/__debug/error` gate below.
 * Not a cryptographic primitive (the length check short-circuits) — adequate
 * for gating an intentional-test-error route, not a real secret. Real
 * secrets (ADMIN_TOKEN) use `node:crypto`'s `timingSafeEqual` at the server
 * level (see packages/servers/jp-calendar/src/ingest/timing-safe-equal.ts);
 * `@plugrail/core` avoids a `node:crypto` dependency for this low-stakes case.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  }
  return diff === 0;
}

/**
 * `GET /__debug/error` — 1A-6 Sentry notification smoke test. Throws an
 * intentional error so an operator can confirm the whole pipeline (factory
 * catch → `Sentry.captureException` → Sentry alert) actually delivers,
 * without waiting for a real bug. Fails CLOSED and indistinguishable from a
 * 404 unless `env.DEBUG_ERROR_TOKEN` (a `wrangler secret`, opt-in per
 * server) is set AND the caller presents it via the `X-Debug-Token` header —
 * this route does not exist (observably) on a server that never configured
 * the secret. See docs/ops/observability.md for the human-facing procedure.
 */
function handleDebugError(request: Request, env: unknown): Response {
  const token = (env as { DEBUG_ERROR_TOKEN?: string } | undefined)?.DEBUG_ERROR_TOKEN;
  const provided = request.headers.get("x-debug-token");
  if (!token || !provided || !constantTimeEquals(token, provided)) {
    return jsonResponse(
      { ok: false, error: { code: "not_found", message: "Not found: /__debug/error" } },
      404,
    );
  }
  throw new Error("[debug] intentional test error (1A-6 Sentry notification smoke test)");
}

/** Everything `fetch()` needs to route one request, minus the req_id/logging/Sentry wrapping around it. */
async function routeRequest(
  config: DefineMcpServerConfig,
  info: ServerInfo,
  middleware: Middleware[],
  request: Request,
  env: unknown,
  ctx: ExecutionContext,
  url: URL,
  reqId: string,
): Promise<Response> {
  const path = url.pathname;

  if (request.method === "GET" && path === "/healthz") {
    return jsonResponse({ status: "ok", name: config.name, version: config.version });
  }

  if (request.method === "GET" && path === "/__debug/error") {
    return handleDebugError(request, env);
  }

  if (request.method === "GET" && (path === "/" || path === "")) {
    return jsonResponse({
      name: config.name,
      version: config.version,
      ...(config.description ? { description: config.description } : {}),
      transport: "streamable-http",
      endpoint: "/mcp",
      ...(config.docsUrl ? { docs: config.docsUrl } : {}),
      connect: {
        claude_code: `claude mcp add --transport http ${config.name} ${url.origin}/mcp`,
        config: {
          type: "streamable-http",
          url: `${url.origin}/mcp`,
        },
      },
    });
  }

  if (path === "/mcp") {
    const state: MiddlewareState = {};
    const middlewareStartedAt = Date.now();
    for (const mw of middleware) {
      const short = await mw(request, env, ctx, info, state);
      if (short) {
        // Only a rate-limit short-circuit (429) is metered as a "call"
        // (1A-4) — no tool was ever selected/dispatched, so there is no
        // real tool name to attribute it to.
        if (short.status === 429) {
          runInstrumentation(
            config.instrumentation,
            {
              tool: "(unknown)",
              status: "rate_limited",
              durationMs: Date.now() - middlewareStartedAt,
            },
            { request, env, ctx, auth: state.auth },
            info,
          );
          log("warn", "tool_call", {
            req_id: reqId,
            server: info.name,
            tool: "(unknown)",
            status: "rate_limited",
            duration_ms: Date.now() - middlewareStartedAt,
            ...(state.auth?.keyHash ? { key_hash: state.auth.keyHash } : {}),
          });
        }
        return short;
      }
    }
    const server = buildServer(config, { request, env, ctx, auth: state.auth }, info, reqId);
    const handler = createMcpHandler(server, { route: "/mcp" });
    return handler(request, env, ctx);
  }

  return jsonResponse(
    { ok: false, error: { code: "not_found", message: `Not found: ${path}` } },
    404,
  );
}

/**
 * Build a Cloudflare Workers `fetch` handler for an MCP server.
 *
 * Routes:
 *   - `POST/GET /mcp`     → Streamable HTTP MCP endpoint (after `middleware`).
 *   - `GET /healthz`      → `{ status, name, version }` (1A-6 monitoring / 1B-5 smoke).
 *   - `GET /`             → JSON landing page (name, connect instructions, docs).
 *   - `GET /__debug/error` → intentional test error, gated by `DEBUG_ERROR_TOKEN` (1A-6).
 *   - everything else     → 404 JSON.
 *
 * 1A-6: every request gets a fresh `req_id` (also returned as the
 * `X-Request-Id` response header — サポート問い合わせ時の突合用) and one
 * structured `http_request` log line. The whole handler is wrapped with
 * `@sentry/cloudflare`'s `withSentry`, which is a silent no-op when
 * `env.SENTRY_DSN` is unset (see breakdown/mcp/tasks/phase1/1A-6-RESEARCH.md).
 */
export function defineMcpServer(config: DefineMcpServerConfig): ExportedHandler {
  const info: ServerInfo = { name: config.name, version: config.version };
  const middleware = config.middleware ?? [];

  const rawHandler: ExportedHandler = {
    async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
      const reqId = genRequestId();
      const startedAt = Date.now();
      const url = new URL(request.url);

      let response: Response;
      try {
        response = await routeRequest(config, info, middleware, request, env, ctx, url, reqId);
      } catch (error) {
        // Anything that escapes routeRequest() is unexpected (tool-handler
        // throws are already caught inside buildServer() and turned into a
        // 封筒 error — this catch is for bugs in the routing/middleware/MCP
        // transport layer itself, plus /__debug/error's intentional throw).
        Sentry.captureException(error);
        log("error", "unhandled_exception", {
          req_id: reqId,
          server: info.name,
          path: url.pathname,
          error: errorMessage(error),
        });
        response = jsonResponse(
          { ok: false, error: { code: "internal", message: "内部エラーが発生しました。" } },
          500,
        );
      }

      // Re-wrap so header mutation is safe even if `response` came back with
      // immutable headers (e.g. certain SDK-constructed Response objects).
      const final = new Response(response.body, response);
      final.headers.set("X-Request-Id", reqId);

      log("info", "http_request", {
        req_id: reqId,
        server: info.name,
        method: request.method,
        path: url.pathname,
        status: final.status,
        duration_ms: Date.now() - startedAt,
      });

      return final;
    },
  };

  return Sentry.withSentry((env) => {
    const dsn = (env as { SENTRY_DSN?: string } | undefined)?.SENTRY_DSN;
    // No DSN → SDK stays disabled (Sentry's documented behavior); we still
    // return an options object rather than `undefined` so tracesSampleRate
    // stays pinned to 0 regardless (see 1A-6-RESEARCH.md — error monitoring
    // only, no paid-tier performance tracing).
    return { dsn, tracesSampleRate: 0, sendDefaultPii: false };
  }, rawHandler);
}
