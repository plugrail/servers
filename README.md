# plugrail

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-blue.svg)](https://modelcontextprotocol.io/)

A collection of MCP servers that connect to Japanese public data. The name alone does not describe the project, so plugrail is not related to railways or railway services.

## Live servers

| Server | MCP endpoint | Tools | Status |
| --- | --- | --- | --- |
| jp-calendar | `https://jp-calendar.plugrail.dev/mcp` | `is_holiday`, `list_holidays`, `business_days_between`, `add_business_days` | Live |

## Connect

See [the jp-calendar connection guide](docs/servers/jp-calendar/CONNECT.md).

## Self-hosting

1. In `packages/servers/jp-calendar/`, copy `wrangler.example.jsonc` to `wrangler.jsonc` and fill in your Cloudflare resource IDs.
2. Create the D1 database and KV namespace referenced by that configuration.
3. Run `pnpm --filter @plugrail/jp-calendar deploy`.

The self-hosted server runs independently. Authentication, rate limiting, and usage metering are features of the hosted service only.

## Architecture

```text
MCP client
    |
    v
jp-calendar Worker --> Cloudflare D1 (holiday data)
                   --> Cloudflare KV (cached data)
```

## Sources and disclaimer

This is not an official service of the National Tax Agency, the Digital Agency, or any other Japanese government body. Information provided does not represent their official views and is not guaranteed by them.

Source: Adapted from the Cabinet Office "National Holidays" page (https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html)

## Contributing

Issues and pull requests are welcome. Please include enough context to reproduce a problem or explain a proposed change.

## License

MIT. See [LICENSE](LICENSE).
