// Operational metrics via Workers Analytics Engine (1A-6 Step 5). Separate
// from a separate billing-grade D1 usage recorder
// `usage_events`) — this is lightweight, best-effort "server/tool/status/
// duration" telemetry meant for Cloudflare's standard Analytics Engine
// SQL API / GraphQL dashboard, never a source of truth for billing.
//
// Wire alongside usage metering via composeInstrumentation() (factory.ts):
//   defineMcpServer({
//     instrumentation: composeInstrumentation(
//       usageInstrumentation(),
//       analyticsEngineInstrumentation(),
//     ),
//   })

import type { Instrumentation } from "../factory.js";
import { errorMessage, log } from "./log.js";

/**
 * Structural env shape this hook expects. A server opts in by declaring an
 * `analytics_engine_datasets` binding named `METRICS` in its wrangler.jsonc
 * (see packages/servers/jp-calendar/wrangler.jsonc). Absent binding = no-op,
 * same fail-open convention as a billing integration — a server
 * that hasn't wired `METRICS` yet still works, it just isn't metered.
 */
export type MetricsEnv = {
  METRICS?: AnalyticsEngineDataset;
};

/**
 * Writes one Analytics Engine data point per tool call — including
 * rate-limited short-circuits, where `event.tool` is `"(unknown)"` (same
 * convention as usage metering's `ToolCallEvent`, factory.ts). Never
 * throws: a metrics-write failure must never affect the tool/HTTP response
 * (same guarantee `usageInstrumentation()` gives 1A-4's D1 writes).
 *
 * `blobs: [server, tool, status]` / `doubles: [duration_ms]` /
 * `indexes: [server]` — well inside the `writeDataPoint` limits (20
 * blobs/20 doubles/1 index, 16KB blobs total, 96B index) documented in
 * breakdown/mcp/tasks/phase1/1A-6-RESEARCH.md §B.
 */
export function analyticsEngineInstrumentation(): Instrumentation {
  return (event, toolCtx, info) => {
    try {
      const env = toolCtx.env as MetricsEnv;
      if (!env.METRICS) return;
      env.METRICS.writeDataPoint({
        blobs: [info.name, event.tool, event.status],
        doubles: [event.durationMs],
        indexes: [info.name],
      });
    } catch (error) {
      log("error", "metrics_write_failed", {
        server: info.name,
        tool: event.tool,
        error: errorMessage(error),
      });
    }
  };
}
