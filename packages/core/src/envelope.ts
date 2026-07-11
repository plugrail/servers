// Response envelope — code realisation of the 1A-7 design
// (docs/architecture/response-format.md §2–§10).
//
// Every MCP tool in this monorepo MUST return its result through the `ok()` /
// `err()` builders defined here. The builders are the ONLY sanctioned way to
// produce a tool result: they auto-inject the disclaimer, resolve citation keys
// into full source entries, and brand the value so hand-constructed "raw"
// results do not type-check (§10.1/§10.2). This is the technical guarantee for
// the 出典・免責 compliance conditions of P0-1/P0-2/P0-6 — 規約遵守を人間の
// レビューに頼らない、が設計目標。

import { resolveSources, type Source, type SourceKey } from "./sources.js";

export type { Source, SourceKey };

// ---------------------------------------------------------------------------
// Disclaimer (1A-7 §4) — single source of truth.
// ---------------------------------------------------------------------------

/**
 * Permanent link to the full 免責 / 非保証 text (§1-1〜§1-4). Confirmed by
 * 1C-1 / 2C-4; a placeholder until then. Changing the disclaimer URL is a
 * ONE-LINE edit here that propagates to every tool (§10.5).
 */
export const DISCLAIMER_URL = "https://plugrail.dev/legal/disclaimer";

/**
 * The short, per-response disclaimer (§4). Compresses P0-6 §1-1 (公式見解の否認)
 * and §1-2 (非保証) and defers the full text to {@link DISCLAIMER_URL}. It names
 * no specific agency — the機関名 lives in `meta.sources[].name` — so a single
 * neutral string is reused across every server (jp-calendar / jp-corporate / …)
 * with no risk of showing the wrong ministry.
 */
export const DISCLAIMER_TEXT = `本応答は公共データを基に作成した参考情報であり、提供元行政機関の公式見解を示すものではありません。詳細: ${DISCLAIMER_URL}`;

// ---------------------------------------------------------------------------
// Envelope types (1A-7 §2) — the on-the-wire shape (structuredContent).
// ---------------------------------------------------------------------------

export type CacheStatus = "hit" | "miss" | "stale" | "stale-fallback";

/** Machine-readable masking notice (P0-2 案B'). See §9. */
export type Masking = {
  applied: boolean;
  masked_fields?: readonly string[];
  reason: string;
  policy_url: string;
};

export type EnvelopeMeta = {
  /** 出典（§1-3準拠）。1件以上必須 — 空配列は型エラー。 */
  sources: readonly [Source, ...Source[]];
  /** このレスポンスを生成した時刻（ISO8601）。 */
  fetched_at: string;
  /** データ自体の基準日（例: 祝日CSVの取込日）。該当ソースのみ設定。 */
  data_as_of?: string;
  /** 1A-5（SWRキャッシュ層）連動。該当ツールのみ。 */
  cache?: CacheStatus;
  /** 個人事業者マスキング通知（案B'採用時）。§9。 */
  masking?: Masking;
  /** 短文免責 + 詳細URL（§1-1/§1-2の圧縮）。必須。 */
  disclaimer: string;
};

/** 成功レスポンス — on-the-wire shape placed in `structuredContent`. */
export type Envelope<T> = {
  ok: true;
  data: T;
  meta: EnvelopeMeta;
};

export type ErrorCode =
  | "invalid_input"
  | "not_found"
  | "out_of_data_range"
  | "rate_limited"
  // API キー認証の失敗（未指定/不正形式/存在しない/失効済み — 一律同じ code。
  // 理由を区別する情報は返さない。1A-3 の `requireApiKey` middleware が使用）。
  | "unauthorized"
  | "upstream_unavailable"
  | "internal"
  // 予約語彙。2A-2 で案D採用時のみ有効化（§5/§10.6）。テンプレートが
  // デフォルト挙動として返してはならない。
  | "unsupported_subject";

/** 失敗レスポンス（§2）。`meta.disclaimer` はエラー時も必須。 */
export type EnvelopeError = {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    /** 「AIエージェントが次に取るべき行動」を一文で（§5）。 */
    hint?: string;
  };
  meta: {
    disclaimer: string;
  };
};

// ---------------------------------------------------------------------------
// Branded tool results — what a handler is forced to return.
// ---------------------------------------------------------------------------

declare const RESULT_BRAND: unique symbol;

/**
 * A branded success result. Carries the wire {@link Envelope} plus the one-line
 * human/AI-readable `summary` the factory appends citations + disclaimer to
 * (§7/§10.3). The brand is a non-exported symbol, so this type can only be
 * produced by {@link ok} — hand-written `{ ok: true, ... }` literals do NOT
 * satisfy it, closing the "raw response" bypass (§10.1, 禁止事項).
 */
export type SuccessResult<T> = Envelope<T> & {
  /** データの人間可読要約（一文）。structuredContent には含めない。 */
  readonly summary: string;
  readonly [RESULT_BRAND]: true;
};

/** A branded failure result. Only {@link err} can produce it. */
export type FailureResult = EnvelopeError & {
  readonly [RESULT_BRAND]: true;
};

/** The union a tool handler must return — success or failure, never raw data. */
export type ToolResult<T> = SuccessResult<T> | FailureResult;

/** Structural (un-branded) view, for narrowing after the brand is stripped. */
export type AnyToolResult = Envelope<unknown> | EnvelopeError;

// ---------------------------------------------------------------------------
// Builders.
// ---------------------------------------------------------------------------

/**
 * Metadata a tool supplies to {@link ok}. Note the absence of `disclaimer`:
 * it is auto-injected and cannot be passed (§10.2). `sources` accepts only
 * {@link SourceKey} values, never `{name, url}` literals (§10.4).
 */
export type OkMetaInput = {
  sources: readonly [SourceKey, ...SourceKey[]];
  fetched_at: string;
  data_as_of?: string;
  cache?: CacheStatus;
  masking?: Masking;
};

/**
 * Build a success result.
 *
 * @param data    machine-readable payload → `structuredContent.data`.
 * @param meta    citations (by key) + timing. Disclaimer is injected here.
 * @param summary one-line human/AI summary of `data`; the factory appends the
 *                citation line and disclaimer to form `content[0].text` (§7).
 */
export function ok<T>(data: T, meta: OkMetaInput, summary: string): SuccessResult<T> {
  return {
    ok: true,
    data,
    meta: {
      sources: resolveSources(meta.sources),
      fetched_at: meta.fetched_at,
      ...(meta.data_as_of !== undefined ? { data_as_of: meta.data_as_of } : {}),
      ...(meta.cache !== undefined ? { cache: meta.cache } : {}),
      ...(meta.masking !== undefined ? { masking: meta.masking } : {}),
      disclaimer: DISCLAIMER_TEXT,
    },
    summary,
  } as SuccessResult<T>;
}

/** The error payload a tool supplies to {@link err} (disclaimer is injected). */
export type ErrInput = {
  code: ErrorCode;
  message: string;
  hint?: string;
};

/** Build a failure result. Disclaimer is injected; never passed by the caller. */
export function err(error: ErrInput): FailureResult {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.hint !== undefined ? { hint: error.hint } : {}),
    },
    meta: { disclaimer: DISCLAIMER_TEXT },
  } as FailureResult;
}

// ---------------------------------------------------------------------------
// Wire helpers (used by the factory to build MCP responses — §7).
// ---------------------------------------------------------------------------

/** The `structuredContent` object for a result: the wire envelope, no `summary`. */
export function toWireEnvelope<T>(result: ToolResult<T>): Envelope<T> | EnvelopeError {
  if (result.ok) {
    const { summary: _summary, ...envelope } = result;
    return envelope as Envelope<T>;
  }
  return result as EnvelopeError;
}

/** Citation line: `出典: name url / … を加工して作成` (§7/§8). */
export function formatSourceLine(sources: readonly [Source, ...Source[]]): string {
  return `出典: ${sources.map((s) => `${s.name} ${s.url}`).join(" / ")} を加工して作成`;
}

/**
 * Build `content[0].text` from a result (§7). The tool supplies only the data
 * summary; the citation line and disclaimer are appended here so no tool can
 * omit or alter them.
 */
export function formatText<T>(result: ToolResult<T>): string {
  if (result.ok) {
    return `${result.summary}\n\n${formatSourceLine(result.meta.sources)}\n${result.meta.disclaimer}`;
  }
  const { message, hint } = result.error;
  return `エラー: ${message}${hint ? `\n${hint}` : ""}\n${result.meta.disclaimer}`;
}
