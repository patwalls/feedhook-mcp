# feedhook-mcp

MCP server for [Feedhook](https://feedhook.walls.sh) — turn a YouTube channel into a
**webhook**: your endpoint gets a signed HTTP POST ~8 seconds after a new video is
published. No polling, no YouTube API quota. Feedhook does YouTube's WebSub plumbing
(hub subscription, verification handshake, ~5-day lease renewals, retries with backoff)
and resells it as a clean API; this package is the agent front door.

## Use it

```bash
claude mcp add feedhook -e FEEDHOOK_API_KEY=fh_your_key -- npx -y feedhook-mcp
```

Or in any MCP client config:

```json
{
  "mcpServers": {
    "feedhook": {
      "command": "npx",
      "args": ["-y", "feedhook-mcp"],
      "env": { "FEEDHOOK_API_KEY": "fh_your_key" }
    }
  }
}
```

No key yet? Add the server without the env var and ask your agent to call
`create_account` (free plan: 1 feed) — the key is returned once; save it as
`FEEDHOOK_API_KEY`.

## Tools

| Tool | Does |
|---|---|
| `create_account` | Free signup → API key (returned once) |
| `get_account` | Plan, feed limit, feeds in use |
| `create_subscription` | channel id + callback URL → webhook on every new video |
| `list_subscriptions` | All subscriptions with state + delivery counts |
| `get_subscription` | One subscription incl. recent delivery log (per-attempt HTTP results) |
| `test_subscription` | Send a signed test.ping through the real pipeline to verify your receiver |
| `upgrade_plan` | Free → Pro ($9/mo, 10 feeds): returns a Stripe Checkout URL to open in a browser |
| `delete_subscription` | Unsubscribe + stop deliveries |

## The webhook your endpoint receives

```
POST <your callbackUrl>
x-feedhook-event: video.published
x-feedhook-delivery: <uuid>
x-feedhook-signature: sha256=<hex HMAC-SHA256 of the raw body, keyed with your subscription secret>

{
  "event": "video.published",
  "subscriptionId": "…",
  "videoId": "dQw4w9WgXcQ",
  "channelId": "UC…",
  "title": "…",
  "author": "…",
  "publishedAt": "2026-06-11T15:54:18+00:00",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "receivedAt": "…"
}
```

Non-2xx responses are retried 5 times with backoff. Respond within 15 seconds.

## Environment

- `FEEDHOOK_API_KEY` — your account key (most tools need it)
- `FEEDHOOK_API_URL` — override the API base (default `https://feedhook.walls.sh`)

MIT · a [walls.sh](https://walls.sh) product
