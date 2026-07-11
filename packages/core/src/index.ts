// @plugrail/core — future OSS home for the response envelope (1A-7) and the
// MCP server factory (1A-2).

export {
  type AnyToolResult,
  type CacheStatus,
  DISCLAIMER_TEXT,
  DISCLAIMER_URL,
  type Envelope,
  type EnvelopeError,
  type EnvelopeMeta,
  type ErrorCode,
  err,
  type FailureResult,
  formatSourceLine,
  formatText,
  type Masking,
  type OkMetaInput,
  ok,
  type SuccessResult,
  type ToolResult,
  toWireEnvelope,
} from "./envelope.js";
export {
  type AuthInfo,
  composeInstrumentation,
  type DefineMcpServerConfig,
  defineMcpServer,
  defineTool,
  type Instrumentation,
  type Middleware,
  type MiddlewareState,
  type ServerInfo,
  type ToolCallEvent,
  type ToolContext,
  type ToolDefinition,
} from "./factory.js";
export {
  analyticsEngineInstrumentation,
  errorMessage,
  genRequestId,
  type LogFields,
  type LogLevel,
  log,
  type MetricsEnv,
} from "./logging/index.js";
export { resolveSources, SOURCES, type Source, type SourceKey } from "./sources.js";
