# PlugRail JP Corporate

[English](#english) | [日本語](#japanese)

<a id="english"></a>
## English

MCP server for searching Japanese corporations and verifying invoice registration numbers, built on official Japan National Tax Agency (NTA) public data.

### What it can do

| Tool | What it does |
|---|---|
| `search_corporate_by_number` | Find one corporation by its 13-digit corporate number. |
| `search_corporate_by_name` | Search by 2-digit prefecture code + company-name prefix (up to 20 results). |
| `search_corporate_by_address` | Search by 2-digit prefecture code + address prefix (up to 20 results). |
| `lookup_corporate` | Exact lookup by corporate number, or candidate search by name/address. A name alone never resolves to a single company; candidates are returned with per-evidence scores. |
| `verify_invoice_number` | Check a qualified invoice issuer number (T + 13 digits): registered / cancelled / expired with dates. A "not found" result is reported as "not published or not yet recorded" — never as "invalid" or "non-existent". |
| `company_profile` | Company profile (basic info, subsidies, certifications, finance) by 13-digit corporate number. Each section carries its source, freshness, and missing-reason; partial failures return what was fetched plus what is missing. |

Every successful response carries its data source and a disclaimer; error responses carry the disclaimer. This service is not an official service of the NTA or any other government body, and its responses do not represent their official views.

### Usage

The server is a hosted Streamable HTTP endpoint. You can connect without an API key and use the free tier; a Pro plan API key removes the monthly cap.

```sh
# Free tier (no key)
claude mcp add --transport http jp-corporate https://jp-corporate.plugrail.dev/mcp

# Pro plan
claude mcp add --transport http jp-corporate https://jp-corporate.plugrail.dev/mcp \
  --header "Authorization: Bearer <YOUR_PRO_KEY>"
```

Then ask things like "look up corporate number 7000012050002" or "find companies in Tokyo starting with 渋谷".

### Limits

- Free tier: all tools, up to 100 tool calls per calendar month (JST), no credit card. Counted per IP address without a key. `tools/list` is not counted. The 101st call returns an error pointing to https://plugrail.dev/pricing.
- Rate limits per minute: 10 without a key, 600 on Pro. Exceeding it returns `rate_limited` (HTTP 429) with a retry hint.
- Name/address search is prefix match only (no nationwide fuzzy search), max 20 results per call with cursor pagination.
- Some `company_profile` sections from gBizINFO may be returned as `missing` with a reason; the response always states what is missing.

### Pricing

- **Free: 100 tool calls / month (calendar month, JST), no API key or credit card required.**
- **Pro: ¥9,800 / month, tax-inclusive (total display including consumption-tax equivalent; tax-exempt operator). No monthly cap.**
- No free trial of Pro (billing starts in the first month). Details: https://plugrail.dev/pricing

### Sources and disclaimer

This is not an official service of the National Tax Agency or any other Japanese government body. Information provided does not represent their official views and is not guaranteed by them.

- 国税庁法人番号公表サイト (https://www.houjin-bangou.nta.go.jp/) を加工して作成
- 国税庁インボイス制度適格請求書発行事業者公表サイト (https://www.invoice-kohyo.nta.go.jp/) を加工して作成

### Support

Contact: support@plugrail.dev (email only; replies within 2 business days, Japanese or English; best effort, no SLA). Terms: https://plugrail.dev/legal/terms. Privacy: see [PRIVACY.md](PRIVACY.md).

### License

MIT. See [LICENSE](../LICENSE).

<a id="japanese"></a>
## 日本語

国税庁の公式公開データを基に、日本の法人検索とインボイス登録番号の照合を行う MCP サーバーです。

### できること

| ツール | 内容 |
|---|---|
| `search_corporate_by_number` | 法人番号 (13桁) で1件検索 |
| `search_corporate_by_name` | 都道府県コード2桁 + 法人名の接頭辞で検索 (最大20件) |
| `search_corporate_by_address` | 都道府県コード2桁 + 所在地の接頭辞で検索 (最大20件) |
| `lookup_corporate` | 法人番号の確定照会と名称・所在地の候補探索を分離。名称だけでは断定せず複数候補と根拠別スコアを返す |
| `verify_invoice_number` | 適格請求書発行事業者番号 (T+13桁) の登録・取消・失効を日付付きで照合。未発見は「非掲載または未収録」と明示し「無効」「不存在」と断定しない |
| `company_profile` | 法人番号 (13桁) で基本情報・補助金・届出・財務のプロファイル。各領域の出典・鮮度・欠損を保持し、部分障害時は取得済みと欠損を同時に返す |

成功レスポンスには必ず出典と免責文言が付きます。本サービスは国税庁その他の行政機関の公式サービスではなく、応答はそれらの公式見解を示すものではありません。

### 使い方

ホスト型 Streamable HTTP エンドポイントです。API キーなしで接続して無料枠を使えます。Pro プランの API キーを付けると月間上限がなくなります。

```sh
# 無料枠（キーなし）
claude mcp add --transport http jp-corporate https://jp-corporate.plugrail.dev/mcp

# Pro プラン
claude mcp add --transport http jp-corporate https://jp-corporate.plugrail.dev/mcp \
  --header "Authorization: Bearer <proキー>"
```

「法人番号 7000012050002 の会社を調べて」「東京都で『渋谷』から始まる会社を探して」のように話しかけると対応するツールが呼ばれます。

### 制限

- 無料枠: 全ツール利用可・月100回まで（暦月・日本時間）・カード不要。キーなしは IP アドレス単位で数えます。`tools/list` は数えません。101回目は https://plugrail.dev/pricing への案内付きエラーになります。
- 分間レート制限: キーなし 10回/分、Pro 600回/分。超えると `rate_limited`（HTTP 429）と再試行の目安を返します。
- 名称・所在地検索は接頭辞一致のみ (全国ファジー検索なし)。1回最大20件、カーソルページング。
- `company_profile` の gBizINFO 由来の領域は、取得できない場合に理由付きで `missing` を返します。

### 料金

- **無料: 月100回まで（暦月・日本時間）。API キー・カード不要。**
- **Pro: 月額 9,800円（税込。消費税相当額を含む総額表示。免税事業者）。月間上限なし。**
- Pro の無料トライアルはありません（初月から課金）。詳細: https://plugrail.dev/pricing

### 出典・免責

本サービスは国税庁その他の行政機関の公式サービスではありません。提供情報はそれらの公式見解を示すものではなく、正確性を保証するものでもありません。

- 国税庁法人番号公表サイト (https://www.houjin-bangou.nta.go.jp/) を加工して作成
- 国税庁インボイス制度適格請求書発行事業者公表サイト (https://www.invoice-kohyo.nta.go.jp/) を加工して作成

### サポート

連絡先: support@plugrail.dev（メールのみ・営業日48時間以内・日英対応・ベストエフォートで SLA なし）。利用規約: https://plugrail.dev/legal/terms 。プライバシー: [PRIVACY.md](PRIVACY.md)。

### ライセンス

MIT。[LICENSE](../LICENSE) 参照。
