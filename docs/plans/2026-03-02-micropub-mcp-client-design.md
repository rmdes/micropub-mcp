# Micropub MCP Client — Design Document

**Date:** 2026-03-02
**Status:** APPROVED
**Approach:** Monolithic MCP server (Approach A)

## Purpose

An MCP server that lets Claude Code talk to an Indiekit blog via the Micropub protocol. Create, update, delete posts and upload media — all from the terminal.

## Architecture

Three internal modules in a single process:

1. **Auth Module** (`auth.ts`) — Full IndieAuth with PKCE. Discovers endpoints from site URL, spins up a temporary localhost:19750 server for the OAuth callback, stores tokens at `~/.config/micropub-mcp/<domain>.json`. Handles token refresh automatically.

2. **Micropub Client** (`client.ts`) — Pure HTTP client speaking Micropub. JSON format for creates/updates, GET for queries, multipart for media. No MCP awareness.

3. **MCP Server** (`index.ts` + `tools.ts`) — Thin adapter using `@modelcontextprotocol/sdk` over stdio transport. Registers tools that map to client methods.

```
┌─────────────────────────────────────────────────┐
│              micropub-mcp (Bun + TS)            │
│                                                 │
│  ┌───────────┐  ┌──────────────┐  ┌──────────┐ │
│  │  Auth      │  │  Micropub    │  │  MCP     │ │
│  │  Module    │  │  Client      │  │  Server  │ │
│  │           │  │              │  │          │ │
│  │ - IndieAuth│  │ - create()   │  │ - tools  │ │
│  │ - PKCE     │  │ - update()   │  │ - stdio  │ │
│  │ - token    │  │ - delete()   │  │          │ │
│  │   storage  │  │ - query()    │  │          │ │
│  │ - temp HTTP│  │ - upload()   │  │          │ │
│  └─────┬─────┘  └──────┬───────┘  └────┬─────┘ │
│        │               │               │       │
│        └───────────────┼───────────────┘       │
│                        │                        │
└────────────────────────┼────────────────────────┘
                         │ HTTPS
                         ▼
              rmendes.net/micropub
```

## MCP Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `micropub_auth` | Trigger IndieAuth flow or show auth status | `site_url`, `scope` |
| `micropub_create` | Create a post | `type`, `content`, `name`, `category[]`, `syndicate_to[]`, `post_status`, `slug` |
| `micropub_update` | Update an existing post | `url`, `replace{}`, `add{}`, `delete{}` or `delete[]` |
| `micropub_delete` | Delete a post | `url` |
| `micropub_undelete` | Restore a deleted post | `url` |
| `micropub_query` | Query the Micropub endpoint | `query`, `url`, `properties[]`, `limit`, `offset` |
| `micropub_upload` | Upload media to the media endpoint | `file_path`, `alt_text` |

## Auth Flow

1. Fetch site URL, discover `indieauth-metadata` link relation
2. Fetch metadata JSON → `authorization_endpoint`, `token_endpoint`
3. Discover `micropub` and `media-endpoint` link relations
4. Generate PKCE `code_verifier` + `code_challenge` (S256)
5. Spin up temp HTTP server on `localhost:19750`
6. Open browser to authorization endpoint with required params
7. Receive callback with `code` + `state`, validate state
8. Exchange code for token at token endpoint (with `code_verifier`)
9. Store token + endpoints to `~/.config/micropub-mcp/<domain>.json`
10. Shut down temp server

**Token file format:**
```json
{
  "me": "https://rmendes.net/",
  "access_token": "...",
  "token_type": "Bearer",
  "scope": "create update delete media",
  "refresh_token": "...",
  "expires_at": 1741000000,
  "micropub_endpoint": "https://rmendes.net/micropub",
  "media_endpoint": "https://rmendes.net/media",
  "token_endpoint": "https://rmendes.net/auth/token",
  "authorization_endpoint": "https://rmendes.net/auth"
}
```

**Subsequent runs:** Read token file. If valid, use directly. If expired with refresh token, refresh silently. If refresh fails, re-trigger browser flow.

## Request Formats

**Create** — JSON body with mf2 structure:
```json
{
  "type": ["h-entry"],
  "properties": {
    "content": ["Hello from my terminal!"],
    "category": ["indieweb", "micropub"],
    "mp-syndicate-to": ["https://bsky.app"]
  }
}
```

**Update** — JSON with action + operations:
```json
{
  "action": "update",
  "url": "https://rmendes.net/notes/...",
  "replace": { "content": ["Updated"] },
  "add": { "category": ["new-tag"] }
}
```

**Delete/Undelete** — JSON with action + url.

**Queries** — GET with `?q=` parameter.

**Media** — multipart/form-data POST to media endpoint.

**Errors** — Micropub returns `{ "error": "...", "error_description": "..." }`. Auth errors (401) trigger automatic refresh/re-auth.

## Project Structure

```
indiekit-mcp-micropub/
├── src/
│   ├── index.ts          # Entry point — MCP server, tool registration
│   ├── auth.ts           # IndieAuth flow, PKCE, token storage/refresh
│   ├── client.ts         # Micropub HTTP client
│   ├── discovery.ts      # Endpoint discovery
│   └── tools.ts          # MCP tool definitions and handlers
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

**Dependencies:** `@modelcontextprotocol/sdk`, `open` (browser launcher). Everything else uses Bun built-ins.

**Claude Code integration:**
```json
{
  "mcpServers": {
    "micropub": {
      "command": "bun",
      "args": ["run", "/home/rick/code/indiekit-dev/indiekit-mcp-micropub/src/index.ts"]
    }
  }
}
```

## References

- [Micropub W3C Recommendation](https://www.w3.org/TR/micropub/)
- [IndieAuth Specification](https://indieauth.spec.indieweb.org/)
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
