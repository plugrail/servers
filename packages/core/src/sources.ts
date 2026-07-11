// Data-source registry (1A-7 §6).
//
// The `{name, url, license}` string for every upstream data source lives here
// and NOWHERE else. Tools reference a source by its KEY (see `SourceKey`) and
// never write `{name, url}` literals — this is enforced at the type level by the
// `ok()` builder (packages/core/src/envelope.ts), which only accepts `SourceKey`
// values. Centralising the strings keeps the citation wording aligned with the
// フォーマット確定形式 in P0-6 §1-3 ("出典: ◯◯（提供機関）URL を加工して作成") and
// removes the表記揺れ/誤記 risk of per-tool hand-written strings.

/** A resolved citation entry as it appears on the wire (1A-7 §2). */
export type Source = {
  /** 提供機関を含む正式名称。例: `内閣府「国民の祝日について」` */
  name: string;
  url: string;
  /** 適用される利用条件。例: `公共データ利用規約(第1.0版)` */
  license?: string;
};

/**
 * The single source of truth for citation strings.
 *
 * Phase 2 (jp-corporate) keys are pre-declared but unused in Phase 1 — reserving
 * them here keeps the wording review in one place when those servers ship.
 */
export const SOURCES = {
  cabinet_office_holidays: {
    name: "内閣府「国民の祝日について」",
    url: "https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html",
    license: "公共データ利用規約(第1.0版)",
  },
  // 1B-3 `calendar: "banking"` の根拠法令（銀行の休日 = 銀行法第15条・銀行法施行令
  // 第5条）。cabinet_office_holidays と併用し、banking 計算時のみ追加する
  // （docs/architecture/business-day-semantics.md）。
  banking_holiday_law: {
    name: "銀行法・銀行法施行令（銀行の休日）— e-Gov法令検索",
    url: "https://laws.e-gov.go.jp/law/357CO0000000040",
  },
  // Phase 2 (jp-corporate) 用。1A-7時点では未使用だがキーを予約しておく。
  nta_houjin_bangou: {
    name: "国税庁法人番号公表サイト",
    url: "https://www.houjin-bangou.nta.go.jp/",
    license: "公共データ利用規約(第1.0版)",
  },
  nta_invoice_kohyo: {
    name: "国税庁適格請求書発行事業者公表サイト",
    url: "https://www.invoice-kohyo.nta.go.jp/",
    license: "公共データ利用規約(第1.0版)",
  },
} as const satisfies Record<string, Source>;

/** Key into {@link SOURCES}. The only way a tool may name a data source. */
export type SourceKey = keyof typeof SOURCES;

/** Resolve one or more source keys into their wire `Source` entries. */
export function resolveSources(
  keys: readonly [SourceKey, ...SourceKey[]],
): readonly [Source, ...Source[]] {
  const [first, ...rest] = keys;
  return [SOURCES[first], ...rest.map((k) => SOURCES[k])];
}
