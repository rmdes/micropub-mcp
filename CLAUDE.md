# CLAUDE.md — Micropub MCP Client

## Overview

MCP server that lets Claude Code create, update, delete, and query posts on an IndieAuth-enabled blog via the Micropub protocol. Built with Bun + TypeScript.

## Commands

```bash
bun run src/index.ts   # Start MCP server (stdio transport)
bun test               # Run all tests (22 tests across 3 files)
```

No build step — Bun runs TypeScript directly.

## Architecture

Single Bun process, five source modules:

```
index.ts          McpServer + StdioServerTransport wiring (15 LOC)
    └── tools.ts      7 MCP tool definitions with Zod schemas (291 LOC)
        ├── auth.ts       IndieAuth PKCE, token storage, callback server (384 LOC)
        ├── client.ts     Micropub HTTP client (222 LOC)
        └── discovery.ts  Endpoint discovery (91 LOC)
```

### Data Flow

```
User calls MCP tool
  → tools.ts validates params (Zod)
  → getClient() loads token from disk
  → client.ts makes HTTP request to blog's Micropub endpoint
  → returns result to MCP caller
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Process-level singleton callback server | Auth server must survive across MCP tool calls (each tool call is a separate request) |
| Non-blocking `startAuth()` | MCP tool calls have timeouts; auth flow requires user interaction in browser |
| Token storage on disk (`~/.config/`) | Persists across MCP server restarts without re-authentication |
| PKCE with S256 | Required by IndieAuth spec, prevents authorization code interception |
| Bun.serve for callback | Zero dependencies — no Express/Hono needed |
| Default site URL (rmendes.net) | Reduces friction for primary use case |

## MCP Tools (7 total)

| Tool | Description | Key Params |
|------|-------------|------------|
| `micropub_auth` | IndieAuth login (opens browser) | `site_url`, `scope` |
| `micropub_create` | Create post (note, article, etc.) | `content`, `name`, `category[]`, `syndicate_to[]` |
| `micropub_update` | Update post properties | `url`, `replace{}`, `add{}`, `delete_properties[]` |
| `micropub_delete` | Delete a post | `url` |
| `micropub_undelete` | Restore deleted post | `url` |
| `micropub_query` | Query config/posts/syndication | `q` (config, source, syndicate-to, post-types, category, channel) |
| `micropub_upload` | Upload media file | `file_path` |

## Authentication Flow

The auth flow is **non-blocking** — critical for MCP where tool calls can be aborted:

1. `micropub_auth` called → `startAuth()` runs
2. `discoverEndpoints(siteUrl)` finds authorization/token endpoints
3. PKCE verifier + challenge generated
4. Callback server starts on `localhost:19750` (process-level singleton)
5. Browser opens to authorization endpoint
6. `startAuth()` returns immediately with `{ authUrl }` — tool call completes
7. User approves in browser → redirect to `localhost:19750/callback?code=...&state=...`
8. Callback server exchanges code for token, saves to disk, shuts down
9. Next tool call loads token from `~/.config/micropub-mcp/<domain>.json`

**Module-level singletons** (in `auth.ts`):
- `activeServer`: The `Bun.serve()` instance (or null)
- `activeSession`: Current auth session state (or null)

**Token persistence**: `~/.config/micropub-mcp/<domain>.json` contains access_token, refresh_token, expiration, and discovered endpoints.

## Constants

```
CALLBACK_PORT = 19750
CLIENT_ID = http://localhost:19750/
REDIRECT_URI = http://localhost:19750/callback
DEFAULT_SCOPE = "create update delete media"
```

## Endpoint Discovery

`discovery.ts` finds Micropub + IndieAuth endpoints from a site URL:

1. Fetch site URL, follow redirects
2. Parse `Link` HTTP headers (highest priority)
3. Parse `<link rel="...">` tags from HTML
4. If `indieauth-metadata` found, fetch it for auth/token endpoints
5. Merge: HTTP headers override HTML links

Required: `micropub` endpoint. Optional: `media_endpoint`, `authorization_endpoint`, `token_endpoint`.

## Micropub Client

`client.ts` is a pure HTTP client — no MCP awareness:

- **create**: POST JSON with `type: ["h-entry"]` and mf2 properties
- **update**: POST JSON with `action: "update"`, `url`, `replace`/`add`/`delete`
- **delete/undelete**: POST JSON with `action: "delete"|"undelete"`, `url`
- **query**: GET with `?q=config|source|syndicate-to|...`
- **uploadMedia**: POST FormData to media endpoint, returns Location header

## Tests

```
src/discovery.test.ts    7 tests — Link header parsing, HTML parsing, indieauth-metadata
src/auth.test.ts         8 tests — PKCE generation, TokenStore persistence, expiration
src/client.test.ts       7 tests — create, update, delete, query, error handling
```

All tests mock `fetch` at the global level — no network calls.

## Known Gotchas

### Indiekit CSP blocks OAuth redirect

Indiekit's nginx CSP header (`form-action 'self' https:`) blocks the redirect from `/auth/consent` to `http://localhost:19750/callback` (HTTP, not HTTPS). The `/auth` location block must override CSP with `form-action *`. Without this fix, clicking "Allow" does nothing and logs show HTTP 499.

### Indiekit redirect validation regex

Upstream Indiekit's redirect regex (`/^\/[\w&/=?]*$/`) rejects hyphens in paths like `/auth/new-password`. This causes `ForbiddenError: Invalid redirect attempted`. Fixed by patching `lib/indieauth.js` with `/^\/[\w&/=?.\-~:%+@#]*$/`.

### MCP tool call timeouts

MCP tool calls have a timeout. If auth were blocking (wait for browser callback), the tool call would be aborted, killing the callback server before the user can approve. The non-blocking pattern (return auth URL immediately, callback server persists at process level) solves this.

### Token refresh

If the token has a `refresh_token` and is expired, `getToken()` automatically attempts refresh. If refresh fails, returns null and the user must re-authenticate.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP server primitives (McpServer, StdioServerTransport) |
| `open` | Opens browser for IndieAuth authorization |
| `zod` | Schema validation for MCP tool parameters |

No Express, no Hono — uses Bun's built-in `fetch()` and `Bun.serve()`.

## MANDATORY: AI Metadata on Every Post

**When creating posts via `micropub_create`, ALWAYS include AI metadata fields.** This is not optional — every post created by an AI agent must carry transparency disclosure.

| Field | Value to use | Description |
|-------|-------------|-------------|
| `ai_text_level` | `"2"` (Co-drafting) or `"3"` (AI-generated, human reviewed) | `"2"` when user provides the idea and AI drafts; `"3"` when AI generates with minimal input |
| `ai_code_level` | `"0"` (omit for non-code posts) | Only set for posts containing code |
| `ai_tools` | `"Claude"` | The AI tool used |
| `ai_description` | `"Co-drafted with Claude Code via Micropub MCP client"` | Brief description of AI involvement |

### Level Guide

**ai_text_level:**
- `"0"` — No AI (human wrote everything)
- `"1"` — Editorial assistance (AI fixed grammar/spelling)
- `"2"` — Co-drafting (user provided idea/direction, AI wrote the text)
- `"3"` — AI-generated (AI wrote it, human reviewed before publishing)

**ai_code_level:**
- `"0"` — Human-written
- `"1"` — AI-assisted
- `"2"` — Primarily AI-generated

### Example

Every `micropub_create` call should look like this:

```
micropub_create(
  content: "...",
  category: [...],
  syndicate_to: [...],
  ai_text_level: "2",
  ai_tools: "Claude",
  ai_description: "Co-drafted with Claude Code via Micropub MCP client"
)
```

## Syndication Target UIDs (rmendes.net)

When using `syndicate_to` in `micropub_create`, use the exact UIDs from the server — not Bridgy or guessed URLs.

| Target | UID |
|--------|-----|
| Bluesky | `https://bsky.app/profile/rmendes.net` |
| ActivityPub | `https://rmendes.net/` |
| Mastodon | `https://indieweb.social/@rmdes` |
| LinkedIn | `https://www.linkedin.com/in/mendesr/` |
| IndieNews (EN) | `https://news.indieweb.org/en` |
| IndieNews (FR) | `https://news.indieweb.org/fr` |

Query `micropub_query` with `q: "syndicate-to"` to get the current list from any site.

## Workspace Context

This repo is part of the Indiekit development workspace at `/home/rick/code/indiekit-dev/`. The primary blog it targets is https://rmendes.net, deployed via the `indiekit-cloudron` repo. See `/home/rick/code/indiekit-dev/CLAUDE.md` for the full workspace map.
