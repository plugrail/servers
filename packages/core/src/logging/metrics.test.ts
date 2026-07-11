import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerInfo, ToolCallEvent, ToolContext } from "../factory.js";
import { analyticsEngineInstrumentation, type MetricsEnv } from "./metrics.js";

const info: ServerInfo = { name: "jp-calendar", version: "0.1.0" };

function toolCtx(env: MetricsEnv): ToolContext {
  return {
    request: new Request("https://example.com/mcp"),
    env,
    // Minimal stand-in — analyticsEngineInstrumentation() never touches `ctx`.
    ctx: {} as ExecutionContext,
  };
}

describe("analyticsEngineInstrumentation()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes one data point with the documented shape when METRICS is bound", () => {
    const writeDataPoint = vi.fn();
    const hook = analyticsEngineInstrumentation();
    const event: ToolCallEvent = { tool: "is_holiday", status: "ok", durationMs: 12 };

    hook(event, toolCtx({ METRICS: { writeDataPoint } }), info);

    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ["jp-calendar", "is_holiday", "ok"],
      doubles: [12],
      indexes: ["jp-calendar"],
    });
  });

  it("is a silent no-op when METRICS is not bound (fail-open)", () => {
    const hook = analyticsEngineInstrumentation();
    const event: ToolCallEvent = { tool: "is_holiday", status: "ok", durationMs: 1 };

    expect(() => hook(event, toolCtx({}), info)).not.toThrow();
  });

  it("never throws even if writeDataPoint itself throws — logs and swallows instead", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const writeDataPoint = vi.fn(() => {
      throw new Error("AE unavailable");
    });
    const hook = analyticsEngineInstrumentation();
    const event: ToolCallEvent = { tool: "list_holidays", status: "error", durationMs: 5 };

    expect(() => hook(event, toolCtx({ METRICS: { writeDataPoint } }), info)).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(errorSpy.mock.calls[0]?.[0] as string);
    expect(parsed.event).toBe("metrics_write_failed");
    expect(parsed.tool).toBe("list_holidays");
  });

  it("records rate_limited short-circuits with tool '(unknown)' (same as usage metering)", () => {
    const writeDataPoint = vi.fn();
    const hook = analyticsEngineInstrumentation();
    const event: ToolCallEvent = { tool: "(unknown)", status: "rate_limited", durationMs: 3 };

    hook(event, toolCtx({ METRICS: { writeDataPoint } }), info);

    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ["jp-calendar", "(unknown)", "rate_limited"],
      doubles: [3],
      indexes: ["jp-calendar"],
    });
  });
});
