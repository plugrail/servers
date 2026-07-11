import { defineMcpServer, type Instrumentation, type Middleware } from "@plugrail/core";
import { handleAdminIngest } from "./ingest/admin-route.js";
import { runIngest } from "./ingest/pipeline.js";
import { addBusinessDaysTool, businessDaysBetweenTool } from "./tools/business-days.js";
import { isHolidayTool, listHolidaysTool } from "./tools/holidays.js";

type JpCalendarWorker = ExportedHandler<Env> & Required<Pick<ExportedHandler<Env>, "fetch">>;

/** Builds the self-hostable Worker; deployments may inject optional hooks. */
export function createJpCalendarWorker(
  options: { middleware?: Middleware[]; instrumentation?: Instrumentation } = {},
): JpCalendarWorker {
  const mcpHandler = defineMcpServer({
    name: "jp-calendar",
    version: "0.1.0",
    description: "日本の祝日・営業日を判定する MCP サーバー（plugrail / 内閣府データを加工）",
    docsUrl: "https://plugrail.dev/servers/jp-calendar",
    tools: [isHolidayTool, listHolidaysTool, addBusinessDaysTool, businessDaysBetweenTool],
    ...options,
  });
  const mcpFetch = mcpHandler.fetch;
  if (!mcpFetch) throw new Error("defineMcpServer() did not return a fetch handler");
  return {
    async fetch(request, env, ctx) {
      if (new URL(request.url).pathname === "/admin/ingest")
        return handleAdminIngest(request, env, ctx);
      return mcpFetch(request, env, ctx);
    },
    async scheduled(_event, env, ctx) {
      ctx.waitUntil(runIngest(env));
    },
  };
}
