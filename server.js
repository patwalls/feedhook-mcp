#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
// ─────────────────────────────────────────────────────────────────────────────
// Feedhook MCP server — turn a YouTube channel into a webhook from any MCP
// agent (Claude, Cursor…). Feedhook does YouTube's WebSub plumbing (hub
// subscription, lease renewal, retries) and POSTs signed JSON to a callback
// URL ~8 seconds after a video publishes. No polling, no API quota.
//
// Auth: most tools need FEEDHOOK_API_KEY in the environment. An agent without
// a key can call `create_account` once (free plan: 1 feed) and tell its human
// to save the returned key.  Override the API base with FEEDHOOK_API_URL.
//
// MCP travels over stdout/stdin, so all logging MUST go to stderr only.
// ─────────────────────────────────────────────────────────────────────────────
const BASE_URL = (process.env.FEEDHOOK_API_URL || "https://feedhook.walls.sh").replace(/\/+$/, "");
const API_KEY = (process.env.FEEDHOOK_API_KEY || "").trim();

const server = new Server({ name: "feedhook", version: "0.4.0" }, { capabilities: { tools: {} } });

const TOOLS = [
  {
    name: "create_account",
    description:
      "Create a free Feedhook account (1 feed). Returns the API key ONCE — surface it to the user " +
      "and have them save it as FEEDHOOK_API_KEY in this server's environment; it cannot be retrieved again. " +
      "Skip this tool if FEEDHOOK_API_KEY is already set.",
    inputSchema: {
      type: "object",
      properties: { email: { type: "string", description: "Account email address." } },
      required: ["email"],
    },
  },
  {
    name: "get_account",
    description: "Show the current account: email, plan, feed limit, and how many feeds are in use. Requires FEEDHOOK_API_KEY.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_subscription",
    description:
      "Turn a YouTube channel into a webhook: Feedhook will POST signed JSON " +
      "{event:'video.published', videoId, title, author, url, publishedAt, …} to callbackUrl ~8s after " +
      "every new video. The response includes a per-subscription `secret` (shown once) for verifying the " +
      "X-Feedhook-Signature header (sha256 HMAC of the raw body).",
    inputSchema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "The channel as an @handle (e.g. '@mkbhd'), a youtube.com channel URL, or a raw UC… id — resolved server-side.",
        },
        callbackUrl: { type: "string", description: "The http(s) URL that will receive the webhook POSTs." },
      },
      required: ["channel", "callbackUrl"],
    },
  },
  {
    name: "list_subscriptions",
    description: "List the account's channel→webhook subscriptions with state (pending/active/unsubscribed), lease expiry, and delivery counts.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_subscription",
    description:
      "Get one subscription including its recent delivery log — each delivery shows the videoId, status " +
      "(delivered/retrying/failed), and per-attempt HTTP results. Use this to check whether webhooks are arriving.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The subscription id (uuid)." } },
      required: ["id"],
    },
  },
  {
    name: "test_subscription",
    description:
      "Send a signed test.ping through the real delivery pipeline to a subscription's callback URL — verify the " +
      "receiver works without waiting for a real video. Check get_subscription afterwards for the delivery result.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The subscription id (uuid)." } },
      required: ["id"],
    },
  },
  {
    name: "upgrade_plan",
    description:
      "Upgrade the account from free (1 feed) to Pro ($9/mo, 10 feeds). Returns a Stripe Checkout URL — " +
      "give it to the user to open in a browser and pay; the plan flips automatically after checkout. " +
      "Call this when create_subscription returns a 402 feed-limit error.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "delete_subscription",
    description: "Delete a subscription — unsubscribes from YouTube's hub and stops all deliveries.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The subscription id (uuid)." } },
      required: ["id"],
    },
  },
];

async function api(method, path, body, { auth = true } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth) {
    if (!API_KEY)
      throw new Error(
        "FEEDHOOK_API_KEY is not set. Create an account with the create_account tool (free, 1 feed), " +
          "then save the returned key as FEEDHOOK_API_KEY in this MCP server's environment.",
      );
    headers.authorization = `Bearer ${API_KEY}`;
  }
  const res = await fetch(BASE_URL + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!res.ok) throw new Error(`Feedhook API ${res.status}: ${data.error || text.slice(0, 300)}`);
  return data;
}

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === "create_account") {
      const email = String(args?.email || "").trim();
      if (!email) throw new Error("`email` is required");
      const data = await api("POST", "/accounts", { email }, { auth: false });
      return ok(data);
    }
    if (name === "get_account") return ok(await api("GET", "/account"));
    if (name === "create_subscription") {
      const channel = String(args?.channel || args?.channelId || "").trim();
      const callbackUrl = String(args?.callbackUrl || "").trim();
      if (!channel || !callbackUrl) throw new Error("`channel` and `callbackUrl` are required");
      return ok(await api("POST", "/subscriptions", { channel, callbackUrl }));
    }
    if (name === "list_subscriptions") return ok(await api("GET", "/subscriptions"));
    if (name === "upgrade_plan") return ok(await api("POST", "/billing/checkout"));
    if (name === "test_subscription") {
      const id = String(args?.id || "").trim();
      if (!id) throw new Error("`id` is required");
      return ok(await api("POST", `/subscriptions/${id}/test`));
    }
    if (name === "get_subscription" || name === "delete_subscription") {
      const id = String(args?.id || "").trim();
      if (!id) throw new Error("`id` is required");
      return ok(await api(name === "get_subscription" ? "GET" : "DELETE", `/subscriptions/${id}`));
    }
    throw new Error(`unknown tool: ${name}`);
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`feedhook-mcp ready (${BASE_URL})`);
