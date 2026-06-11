#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Re-publish this server to the official MCP registry
# (registry.modelcontextprotocol.io) — run after every npm publish so the
# registry listing tracks the npm version.
#
# Auth: the registry's `github-at` endpoint exchanges a plain GitHub access
# token for a publish-scoped registry JWT, and the local `gh` CLI already
# holds one for the io.github.patwalls namespace. No device flow needed.
#
#   bash publish-registry.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

REGISTRY="https://registry.modelcontextprotocol.io"

GHT="$(gh auth token)" || { echo "✗ gh CLI not logged in (gh auth login)"; exit 1; }

RT="$(curl -sf -X POST "$REGISTRY/v0/auth/github-at" \
  -H "Content-Type: application/json" \
  -d "{\"github_token\":\"$GHT\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["registry_token"])')"
[ -n "$RT" ] || { echo "✗ token exchange failed"; exit 1; }

RESP="$(curl -sf -X POST "$REGISTRY/v0/publish" \
  -H "Authorization: Bearer $RT" \
  -H "Content-Type: application/json" \
  --data-binary @server.json)"

echo "$RESP" | python3 -c '
import json, sys
d = json.load(sys.stdin)
s = d["server"]; m = d.get("_meta", {}).get("io.modelcontextprotocol.registry/official", {})
print("v" + s["version"] + " -> status " + str(m.get("status")))'
