# jp-calendar 接続手順

日本の祝日・営業日を判定する MCP サーバー（[plugrail](https://plugrail.dev)）。内閣府「国民の祝日について」データを加工して提供する。

- **サーバーURL**: `https://jp-calendar.plugrail.dev/mcp`（Streamable HTTP）
- **認証**: 不要（匿名利用可）。APIキーを持つ場合は `Authorization: Bearer <key>` を付けるとレート上限が上がる
- **ヘルスチェック**: `https://jp-calendar.plugrail.dev/healthz`

plugrail は「日本の公共データに接続するMCPサーバー群」であり、Railway（PaaS）等の同名サービスとは無関係。

## 提供ツール

| ツール名 | 説明 | 入力例 |
|---|---|---|
| `is_holiday` | 指定した日付が日本の祝日（国民の祝日・休日）かどうかを判定する。内閣府公表データに基づく。 | `{"date": "2026-01-01"}` |
| `list_holidays` | 指定した年または期間の日本の祝日一覧を返す。 | `{"year": 2026}` または `{"from": "2026-01-01", "to": "2026-06-30"}` |
| `add_business_days` | 指定した日付の翌日から数えてN営業日目の日付を返す（`days`が負なら過去方向）。土日・祝日を除外し、`calendar="banking"`で銀行休業日（12/31〜1/3）も除外。 | `{"date": "2026-07-10", "days": 3}` |
| `business_days_between` | `from`〜`to`間の営業日数を数える（既定: fromを含まずtoを含む）。 | `{"from": "2026-07-10", "to": "2026-07-20"}` |

各ツールのレスポンスには必ず出典（`出典: 内閣府「国民の祝日について」 https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html を加工して作成`）と免責文言が付く。

## クライアント別 接続手順

### Claude Code（実機確認済み — 2026-07-11）

```
claude mcp add --transport http jp-calendar https://jp-calendar.plugrail.dev/mcp
```

追加後、`claude mcp list` で `jp-calendar: ... - ✔ Connected` と表示される。会話内で「2026年1月の祝日を教えて」のように聞くと `list_holidays` が呼ばれる。

実機確認内容（2026-07-11）: 上記コマンドで接続（`✔ Connected`）し、`is_holiday` のツール呼び出しが本番サーバーに対して成功する（`mcp__jp-calendar__is_holiday` のtool_useと応答封筒）ことまで確認済み。

### Claude（web / desktop）— 2026-07時点の公式ドキュメントに基づく（実機未確認）

1. `Customize`（または `Settings`）→ `Connectors` を開く
2. `+` → `Add custom connector`
3. Remote MCP server URL に `https://jp-calendar.plugrail.dev/mcp` を入力し `Add`
4. Team/Enterpriseの場合は Owner が `Organization settings > Connectors` から追加し、メンバーは `Customize > Connectors` から Connect する

Free プランは custom connector を1個まで登録可能（beta機能）。Claudeのリモートコネクタ接続はAnthropicのクラウドから行われるため、サーバーはパブリック到達可能である必要がある（本サーバーは満たしている）。

出典: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp（確認日: 2026-07-11）

### Cursor — 2026-07時点の公式ドキュメントに基づく（実機未確認）

`mcp.json`（プロジェクトの `.cursor/mcp.json` またはグローバル設定）に以下を追加する。公式のリモートサーバー例は `url` と任意の `headers` のみを使い、`type`フィールドは書かない：

```json
{
  "mcpServers": {
    "jp-calendar": {
      "url": "https://jp-calendar.plugrail.dev/mcp"
    }
  }
}
```

APIキーを使う場合は `headers` に `Authorization` を追加する:

```json
{
  "mcpServers": {
    "jp-calendar": {
      "url": "https://jp-calendar.plugrail.dev/mcp",
      "headers": { "Authorization": "Bearer ${env:PLUGRAIL_API_KEY}" }
    }
  }
}
```

出典: https://cursor.com/docs/mcp.md（確認日: 2026-07-11）

### ChatGPT — 2026-07時点の公式ドキュメントに基づく（実機未確認）

2026-07時点の現行方式は Developer mode 経由での追加である（Pro/Plus/Business/Enterprise/Educationアカウント対象。Freeは対象外）:

1. ChatGPT の `Settings` → Developer mode を有効化
2. `Settings > Plugins`（開発者向け）で新規appを作成し、MCP server URL に `https://jp-calendar.plugrail.dev/mcp` を入力
3. 会話内で `+` または `@` からappを追加して利用する

一般ユーザー向けの `Settings > Apps` からのコネクタ追加は、現時点では審査済みのApps SDKアプリ（app directory掲載）が対象で、未審査の任意URLを直接貼り付ける一般ユーザー向け導線は2026-07時点の公式ドキュメントでは確認できなかった。

出典: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt（確認日: 2026-07-11） / https://developers.openai.com/api/docs/guides/developer-mode（確認日: 2026-07-11）

### VS Code（GitHub Copilot）— 2026-07時点の公式ドキュメントに基づく（実機未確認）

`.vscode/mcp.json`（プロジェクト）またはユーザープロファイルの `mcp.json` に以下を追加する:

```json
{
  "servers": {
    "jp-calendar": {
      "type": "http",
      "url": "https://jp-calendar.plugrail.dev/mcp"
    }
  }
}
```

VS Code 1.99以降・Copilotへのアクセスが前提。Business/Enterprise組織では管理者が "MCP servers in Copilot" ポリシーを有効化している必要がある。

出典: https://code.visualstudio.com/docs/agent-customization/mcp-servers（確認日: 2026-07-11） / https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp（確認日: 2026-07-11）

## 動作確認例

- 「2026年1月1日は祝日？」と聞くと `is_holiday` が呼ばれる
- 「2026年1月の祝日を教えて」と聞くと `list_holidays` が呼ばれる
- 「2026年7月10日から3営業日後は何日？」と聞くと `add_business_days` が呼ばれる
- 「2026年7月10日から7月20日まで何営業日ある？」と聞くと `business_days_between` が呼ばれる

## レート制限（無料・匿名利用）

匿名（APIキーなし）は **10 req/min**。認証済みAPIキーはより高い上限が適用される（プラン別上限は正式公開時に確定）。上限超過時は `rate_limited` エラーコードで応答する。

## 免責事項

> 本応答は公共データを基に作成した参考情報であり、提供元行政機関の公式見解を示すものではありません。詳細: https://plugrail.dev/legal/disclaimer

---

# jp-calendar — Connection Guide (English)

A MCP server for Japanese public holidays and business-day calculations, part of [plugrail](https://plugrail.dev) — remote MCP servers that connect to Japanese public data. (Unrelated to Railway the PaaS, despite the naming similarity.)

- **Server URL**: `https://jp-calendar.plugrail.dev/mcp` (Streamable HTTP)
- **Auth**: none required (anonymous use allowed). Pass `Authorization: Bearer <key>` for a higher rate limit if you have an API key.
- **Health check**: `https://jp-calendar.plugrail.dev/healthz`

## Tools

| Tool | Description | Example input |
|---|---|---|
| `is_holiday` | Checks whether a given date is a Japanese national holiday, based on the Cabinet Office's official data. | `{"date": "2026-01-01"}` |
| `list_holidays` | Lists Japanese holidays for a year or a date range. | `{"year": 2026}` or `{"from": "2026-01-01", "to": "2026-06-30"}` |
| `add_business_days` | Returns the date N business days after (or before, if `days` is negative) a given date, excluding weekends/holidays (and bank holidays if `calendar="banking"`). | `{"date": "2026-07-10", "days": 3}` |
| `business_days_between` | Counts business days between `from` and `to` (default boundary: excludes `from`, includes `to`). | `{"from": "2026-07-10", "to": "2026-07-20"}` |

Every response carries a source citation and a disclaimer.

## Client setup

### Claude Code (verified live — 2026-07-11)

```
claude mcp add --transport http jp-calendar https://jp-calendar.plugrail.dev/mcp
```

### Claude (web / desktop) — per official docs as of 2026-07 (not hands-on verified)

`Customize > Connectors > + > Add custom connector`, enter the server URL, `Add`. Free plan allows 1 custom connector (beta). Source: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp (checked 2026-07-11).

### Cursor — per official docs as of 2026-07 (not hands-on verified)

```json
{
  "mcpServers": {
    "jp-calendar": {
      "url": "https://jp-calendar.plugrail.dev/mcp"
    }
  }
}
```

Source: https://cursor.com/docs/mcp.md (checked 2026-07-11).

### ChatGPT — per official docs as of 2026-07 (not hands-on verified)

Currently requires Developer mode (Pro/Plus/Business/Enterprise/Education accounts; not available on Free): enable Developer mode, create a custom app under `Settings > Plugins` with the MCP server URL, then add it to a conversation via `@`/`+`. A general-user "paste any third-party URL" flow outside Developer mode was not found in current official docs. Sources: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt / https://developers.openai.com/api/docs/guides/developer-mode (checked 2026-07-11).

### VS Code (GitHub Copilot) — per official docs as of 2026-07 (not hands-on verified)

```json
{
  "servers": {
    "jp-calendar": {
      "type": "http",
      "url": "https://jp-calendar.plugrail.dev/mcp"
    }
  }
}
```

Requires VS Code 1.99+ and Copilot access. Sources: https://code.visualstudio.com/docs/agent-customization/mcp-servers / https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp (checked 2026-07-11).

## Try it

- "Is January 1, 2026 a holiday in Japan?" → calls `is_holiday`
- "What are the holidays in January 2026?" → calls `list_holidays`
- "What date is 3 business days after July 10, 2026?" → calls `add_business_days`
- "How many business days between July 10 and July 20, 2026?" → calls `business_days_between`

## Free / anonymous rate limit

Anonymous requests (no API key): **10 req/min**. Authenticated API keys get higher limits (per-plan limits to be finalized).

## Disclaimer

> This response is reference information generated from public data and does not represent the official position of the providing government agency. Details: https://plugrail.dev/legal/disclaimer
