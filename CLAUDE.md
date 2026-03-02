# CLAUDE.md — Micropub MCP Client

## Overview

MCP server that lets Claude Code create, update, delete, and query posts on an IndieAuth-enabled blog via the Micropub protocol. Built with Bun + TypeScript.

## Commands

```bash
bun run src/index.ts    # Start MCP server (stdio)
bun test                # Run tests
```

## Architecture

Single process with three internal modules:

- **discovery.ts** — Discovers micropub/auth endpoints from a site URL (Link headers + HTML + indieauth-metadata)
- **auth.ts** — IndieAuth with PKCE, token storage at `~/.config/micropub-mcp/<domain>.json`, refresh
- **client.ts** — Micropub HTTP client (create/update/delete/undelete/query/upload)
- **tools.ts** — MCP tool definitions mapping to client methods
- **index.ts** — Entry point, wires McpServer to StdioServerTransport

## MCP Tools

| Tool | Purpose |
|------|---------|
| `micropub_auth` | Authenticate via IndieAuth (opens browser) |
| `micropub_create` | Create a post (note, article, photo, etc.) |
| `micropub_update` | Update a post (replace/add/delete properties) |
| `micropub_delete` | Delete a post |
| `micropub_undelete` | Restore a deleted post |
| `micropub_query` | Query config, posts, syndication targets, post types |
| `micropub_upload` | Upload media files |

## First Use

1. Call `micropub_auth` with your site URL (e.g., `https://rmendes.net`)
2. Approve in the browser that opens
3. Start creating posts with `micropub_create`

Token is stored at `~/.config/micropub-mcp/<domain>.json` and reused across sessions.

## Default Site

When no site URL is provided to tools (other than `micropub_auth`), the default is `https://rmendes.net`.
