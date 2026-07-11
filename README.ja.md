# plugrail

[![ライセンス: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-blue.svg)](https://modelcontextprotocol.io/)

日本の公共データに接続するMCPサーバー群です。plugrailという名前だけでは内容が伝わりにくいため明記すると、鉄道・鉄道サービスとは関係ありません。

## 稼働中のサーバー

| サーバー | MCPエンドポイント | ツール | ステータス |
| --- | --- | --- | --- |
| jp-calendar | `https://jp-calendar.plugrail.dev/mcp` | `is_holiday`、`list_holidays`、`business_days_between`、`add_business_days` | 稼働中 |

## 接続方法

[jp-calendarの接続ガイド](docs/servers/jp-calendar/CONNECT.md)を参照してください。

## セルフホスト

1. `packages/servers/jp-calendar/` 内で `wrangler.example.jsonc` を `wrangler.jsonc` にコピーし、CloudflareリソースIDを設定します。
2. 設定で参照するD1データベースとKV名前空間を作成します。
3. `pnpm --filter @plugrail/jp-calendar deploy` を実行します。

セルフホスト版は単独で動作します。認証、レート制限、使用量計測はホスト版のみの機能です。

## アーキテクチャ

```text
MCPクライアント
    |
    v
jp-calendar Worker --> Cloudflare D1（祝日データ）
                   --> Cloudflare KV（キャッシュデータ）
```

## 出典・免責

本サービスは、国税庁・デジタル庁その他いかなる行政機関が提供する公式サービスでもなく、本サービスが提供する情報は、これらの機関の公式見解を示すものではありません。本サービスの内容は国税庁によって保証されたものではありません。

出典: 内閣府「国民の祝日について」https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html を加工して作成

## Contributing

IssueとPull Requestを歓迎します。問題の再現に必要な情報、または提案する変更の背景を添えてください。

## License

MITライセンスです。[LICENSE](LICENSE)を参照してください。
