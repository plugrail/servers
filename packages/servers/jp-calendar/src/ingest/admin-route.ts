// POST /admin/ingest — manual re-run / full rebuild trigger (1B-1 Step 4-2).
//
// TODO(1A-3): once API-key auth ships a plan="admin" key type, replace this
// ADMIN_TOKEN Bearer check with plan="admin" API-key verification (the
// middleware chain 1A-3 wires into defineMcpServer for `/mcp`; this route sits
// outside that factory so it will need its own call into whatever 1A-3
// exports, e.g. `verifyApiKey(request, env, { plan: "admin" })`). Until 1A-3
// lands, this route is intentionally NOT gated by anything 1A-3 owns — it
// only depends on the ADMIN_TOKEN secret compared here.
//
// This is deliberately the SAME pipeline the Cron trigger uses
// (ingest/pipeline.ts `runIngest`): because diffHolidays() always compares the
// full incoming CSV against the full current table, calling this route IS the
// "full rebuild" mechanism — there's no separate rebuild code path.

import { runIngest } from "./pipeline.js";
import { timingSafeEqualStrings } from "./timing-safe-equal.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handleAdminIngest(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, error: { code: "method_not_allowed" } }, 405);
  }

  if (!env.ADMIN_TOKEN) {
    return json(
      { ok: false, error: { code: "not_configured", message: "ADMIN_TOKEN secret is not set" } },
      503,
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!provided || !timingSafeEqualStrings(provided, env.ADMIN_TOKEN)) {
    return json({ ok: false, error: { code: "unauthorized" } }, 401);
  }

  const result = await runIngest(env);
  return json({ ok: true, result }, 200);
}
