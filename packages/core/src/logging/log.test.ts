import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorMessage, genRequestId, log } from "./log.js";

describe("log()", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a single JSON line with ts/level/event + the given fields", () => {
    log("info", "http_request", { req_id: "abc123", server: "jp-calendar", status: 200 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      level: "info",
      event: "http_request",
      req_id: "abc123",
      server: "jp-calendar",
      status: 200,
    });
    expect(typeof parsed.ts).toBe("string");
    // ISO8601
    expect(new Date(parsed.ts).toISOString()).toBe(parsed.ts);
  });

  it("routes debug/info to console.log, warn to console.warn, error to console.error", () => {
    log("debug", "e1");
    log("info", "e2");
    log("warn", "e3");
    log("error", "e4");

    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("defaults fields to {} — no crash when omitted", () => {
    expect(() => log("info", "no_fields")).not.toThrow();
    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(parsed.event).toBe("no_fields");
  });
});

describe("genRequestId()", () => {
  it("returns a unique string each call (UUID-shaped)", () => {
    const a = genRequestId();
    const b = genRequestId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("errorMessage()", () => {
  it("extracts .message from an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies non-Error values without throwing", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
