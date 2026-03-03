# micropub-mcp

MCP server that lets AI agents (Claude Code, Cursor, etc.) create, update, delete, and query posts on any [Micropub](https://www.w3.org/TR/micropub/)-compatible blog. Authenticates via [IndieAuth](https://indieauth.spec.indieweb.org/) with PKCE.

Built with [Bun](https://bun.sh) + TypeScript.

## Quick Start

### 1. Install

```bash
git clone https://github.com/rmdes/micropub-mcp.git
cd micropub-mcp
bun install
```

### 2. Add to Claude Code

Add to your `.mcp.json` (project or global):

```json
{
  "mcpServers": {
    "micropub": {
      "command": "bun",
      "args": ["run", "/path/to/micropub-mcp/src/index.ts"]
    }
  }
}
```

### 3. Authenticate

Tell Claude: *"Authenticate with my blog at https://yourblog.com"*

This calls `micropub_auth`, which:
1. Discovers your blog's IndieAuth endpoints
2. Opens your browser to the authorization page
3. You approve access, the callback server catches the token
4. Token is saved to `~/.config/micropub-mcp/<domain>.json`

Authentication persists across sessions. You only need to do this once.

### 4. Start Posting

```
"Create a note saying Hello from my MCP client!"
"Write an article titled 'My Setup' about my development environment"
"Syndicate a note to Bluesky and Mastodon about the IndieWeb"
```

## Tools

### micropub_auth

Authenticate with a Micropub-compatible blog via IndieAuth + PKCE.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `site_url` | string | Yes | Your blog URL (e.g., `https://yourblog.com`) |
| `scope` | string | No | OAuth scopes (default: `create update delete media`) |

### micropub_create

Create a new post (note, article, photo, bookmark, etc.).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | No | Post content (text or HTML) |
| `type` | string | No | Post type: `entry` (default), `event` |
| `name` | string | No | Title (makes it an article) |
| `summary` | string | No | Post summary |
| `category` | string[] | No | Tags/categories |
| `syndicate_to` | string[] | No | Syndication target UIDs |
| `in_reply_to` | string | No | URL being replied to |
| `like_of` | string | No | URL being liked |
| `repost_of` | string | No | URL being reposted |
| `photo` | string[] | No | Photo URLs |
| `slug` | string | No | URL slug |
| `post_status` | string | No | `published` or `draft` |
| `published` | string | No | ISO 8601 date |
| `ai_text_level` | string | No | AI text involvement: `0` (None), `1` (Editorial), `2` (Co-drafting), `3` (AI-generated) |
| `ai_code_level` | string | No | AI code involvement: `0` (Human), `1` (AI-assisted), `2` (Primarily AI) |
| `ai_tools` | string | No | AI tools used (e.g. `"Claude"`, `"ChatGPT, Copilot"`) |
| `ai_description` | string | No | Free-text description of AI usage |

**Examples:**

```
Create a note: { content: "Hello world" }
Create an article: { name: "My Title", content: "Article body..." }
Create a bookmark: { like_of: "https://example.com/post" }
Create a reply: { in_reply_to: "https://example.com/post", content: "Great post!" }
Syndicate: { content: "Cross-posted!", syndicate_to: ["https://brid.gy/publish/bluesky"] }
With AI metadata: { content: "AI-assisted post", ai_text_level: "2", ai_tools: "Claude" }
```

### micropub_update

Update an existing post.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | URL of the post to update |
| `replace` | object | No | Properties to replace (values are arrays) |
| `add` | object | No | Properties to add |
| `delete_properties` | string[] | No | Property names to remove |

**Example:** `{ url: "https://blog.com/notes/abc", replace: { content: ["Updated text"] }, add: { category: ["new-tag"] } }`

### micropub_delete

Delete a post.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | URL of the post to delete |

### micropub_undelete

Restore a previously deleted post.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | URL of the post to restore |

### micropub_query

Query the Micropub server for configuration, posts, or metadata.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Query type (see below) |
| `url` | string | No | Post URL (for `source` queries) |
| `properties` | string[] | No | Properties to return |
| `limit` | number | No | Max results |
| `offset` | number | No | Pagination offset |

**Query types:**
- `config` — Server capabilities, syndication targets, post types
- `source` — Get a post's properties (requires `url`)
- `syndicate-to` — Available syndication targets
- `post-types` — Supported post types
- `category` — Available categories/tags
- `channel` — Available channels

### micropub_upload

Upload a media file to the server's media endpoint.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_path` | string | Yes | Absolute path to the file |

Returns the uploaded file's URL, which can be used in `photo`, `video`, or `audio` parameters of `micropub_create`.

## AI Transparency Metadata

Posts can optionally carry metadata disclosing AI involvement. These fields are sent as standard Micropub mf2 properties (`ai-text-level`, `ai-code-level`, `ai-tools`, `ai-description`).

**All fields are optional.** If your Micropub server doesn't know about them, it will simply store them as extra properties or ignore them — no special server-side support is required. This works with any standard Micropub endpoint.

| Level | `ai_text_level` | `ai_code_level` |
|-------|-----------------|-----------------|
| 0 | None — human wrote everything | Human-written |
| 1 | Editorial assistance (grammar, spelling) | AI-assisted |
| 2 | Co-drafting (human directed, AI wrote) | Primarily AI-generated |
| 3 | AI-generated (human reviewed) | — |

If your server does support these fields (e.g., [Indiekit](https://getindiekit.com) with `@rmdes/indiekit-endpoint-posts`), they can be displayed in the post form UI and used for filtering or labeling posts.

## How Authentication Works

```
┌─────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────┐
│  Claude  │────>│  MCP Server  │────>│   Browser    │────>│   Blog   │
│  Code    │     │  (this tool) │     │              │     │  Server  │
└─────────┘     └──────────────┘     └─────────────┘     └──────────┘
     │                │                     │                    │
     │  micropub_auth │                     │                    │
     │───────────────>│                     │                    │
     │                │  discover endpoints │                    │
     │                │────────────────────────────────────────>│
     │                │  start callback     │                    │
     │                │  server :19750      │                    │
     │                │  open browser ──────>│                    │
     │                │                     │  authorize ────────>│
     │  "open browser"│                     │                    │
     │<───────────────│                     │<── redirect with   │
     │                │                     │    auth code       │
     │                │<── callback ────────│                    │
     │                │  exchange code ─────────────────────────>│
     │                │<── access token ────────────────────────│
     │                │  save token         │                    │
     │                │  ~/.config/...      │                    │
```

The callback server runs on `localhost:19750` and is a process-level singleton — it persists across MCP tool calls and shuts down after receiving the callback.

## Token Storage

Tokens are saved to `~/.config/micropub-mcp/<domain>.json` and include:
- Access token
- Refresh token (if provided)
- Expiration time
- Discovered endpoints (micropub, media, token)

Expired tokens are automatically refreshed if a refresh token is available.

## Requirements

- [Bun](https://bun.sh) 1.0+
- A blog with Micropub + IndieAuth support (e.g., [Indiekit](https://getindiekit.com), [WordPress with IndieWeb plugins](https://indieweb.org/WordPress), [micro.blog](https://micro.blog))

### Indiekit-Specific Notes

If your blog runs Indiekit behind nginx, ensure:

1. **CSP `form-action`**: The `/auth` location must allow `form-action *` (or at minimum `http://localhost:*`) so the OAuth consent form can redirect to the local callback server. Without this, clicking "Allow" does nothing (HTTP 499 in logs).

2. **Redirect validation**: Indiekit's upstream redirect regex (`/^\/[\w&/=?]*$/`) rejects hyphens in paths like `/auth/new-password`. If you hit `ForbiddenError: Invalid redirect attempted`, patch `lib/indieauth.js` with an expanded regex.

## Development

```bash
# Run tests
bun test

# Start the MCP server (stdio)
bun run src/index.ts
```

## Architecture

```
src/
├── index.ts        Entry point — creates MCP server, connects stdio transport
├── tools.ts        7 MCP tool definitions with Zod schemas
├── auth.ts         IndieAuth + PKCE flow, token storage, non-blocking callback server
├── client.ts       Micropub HTTP client (create/update/delete/query/upload)
└── discovery.ts    Endpoint discovery from Link headers + HTML + indieauth-metadata
```

## License

MIT
