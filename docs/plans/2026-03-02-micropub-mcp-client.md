# Micropub MCP Client — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MCP server that lets Claude Code create, update, delete, and query posts on an Indiekit blog via the Micropub protocol, with full IndieAuth authentication.

**Architecture:** Single Bun + TypeScript process with three modules — auth (IndieAuth/PKCE/token storage), client (Micropub HTTP), and MCP server (tool definitions over stdio). Token persisted to disk so auth happens once per site.

**Tech Stack:** Bun 1.3.2, TypeScript, `@modelcontextprotocol/sdk`, `open` (browser launcher), Zod

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Step 1: Initialize git repo**

```bash
cd /home/rick/code/indiekit-dev/indiekit-mcp-micropub
git init
```

**Step 2: Create package.json**

```json
{
  "name": "micropub-mcp",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "open": "^10.1.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun"]
  },
  "include": ["src"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
.env
```

**Step 5: Install dependencies**

```bash
bun install
```

**Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore bun.lock
git commit -m "chore: project scaffold with bun, typescript, mcp sdk"
```

---

### Task 2: Endpoint Discovery

**Files:**
- Create: `src/discovery.ts`
- Create: `src/discovery.test.ts`

**Context:** The discovery module fetches a site URL and extracts `micropub`, `media-endpoint`, `authorization_endpoint`, `token_endpoint`, and `indieauth-metadata` link relations from both HTML `<link>` tags and HTTP `Link` headers. See the Micropub spec discovery section and IndieAuth metadata spec.

**Step 1: Write failing tests**

```typescript
// src/discovery.test.ts
import { describe, it, expect, mock } from "bun:test";
import { discoverEndpoints, parseLinkHeaders } from "./discovery";

describe("parseLinkHeaders", () => {
  it("should parse single link header", () => {
    const header = '<https://example.com/micropub>; rel="micropub"';
    const result = parseLinkHeaders(header);
    expect(result.micropub).toBe("https://example.com/micropub");
  });

  it("should parse multiple link headers", () => {
    const header =
      '<https://example.com/micropub>; rel="micropub", ' +
      '<https://example.com/auth>; rel="authorization_endpoint"';
    const result = parseLinkHeaders(header);
    expect(result.micropub).toBe("https://example.com/micropub");
    expect(result.authorization_endpoint).toBe("https://example.com/auth");
  });

  it("should return empty object for null header", () => {
    const result = parseLinkHeaders(null);
    expect(result).toEqual({});
  });
});

describe("discoverEndpoints", () => {
  it("should discover endpoints from Link headers", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response("<html></html>", {
          headers: {
            Link: '<https://example.com/micropub>; rel="micropub", <https://example.com/auth>; rel="authorization_endpoint", <https://example.com/token>; rel="token_endpoint"',
          },
        })
      )
    );
    globalThis.fetch = mockFetch as typeof fetch;

    const endpoints = await discoverEndpoints("https://example.com");
    expect(endpoints.micropub).toBe("https://example.com/micropub");
    expect(endpoints.authorization_endpoint).toBe("https://example.com/auth");
    expect(endpoints.token_endpoint).toBe("https://example.com/token");
  });

  it("should discover endpoints from HTML link tags", async () => {
    const html = `<html><head>
      <link rel="micropub" href="https://example.com/micropub">
      <link rel="authorization_endpoint" href="https://example.com/auth">
      <link rel="token_endpoint" href="https://example.com/token">
    </head></html>`;
    const mockFetch = mock(() =>
      Promise.resolve(new Response(html, { headers: {} }))
    );
    globalThis.fetch = mockFetch as typeof fetch;

    const endpoints = await discoverEndpoints("https://example.com");
    expect(endpoints.micropub).toBe("https://example.com/micropub");
    expect(endpoints.authorization_endpoint).toBe("https://example.com/auth");
    expect(endpoints.token_endpoint).toBe("https://example.com/token");
  });

  it("should discover indieauth-metadata and fetch it", async () => {
    const metadataUrl = "https://example.com/.well-known/oauth-authorization-server";
    const html = `<html><head>
      <link rel="indieauth-metadata" href="${metadataUrl}">
      <link rel="micropub" href="https://example.com/micropub">
    </head></html>`;

    const mockFetch = mock((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr === metadataUrl) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              authorization_endpoint: "https://example.com/auth",
              token_endpoint: "https://example.com/token",
            }),
            { headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.resolve(new Response(html, { headers: {} }));
    });
    globalThis.fetch = mockFetch as typeof fetch;

    const endpoints = await discoverEndpoints("https://example.com");
    expect(endpoints.micropub).toBe("https://example.com/micropub");
    expect(endpoints.authorization_endpoint).toBe("https://example.com/auth");
    expect(endpoints.token_endpoint).toBe("https://example.com/token");
  });

  it("should throw if micropub endpoint not found", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response("<html></html>", { headers: {} }))
    );
    globalThis.fetch = mockFetch as typeof fetch;

    await expect(discoverEndpoints("https://example.com")).rejects.toThrow(
      "micropub endpoint"
    );
  });
});
```

**Step 2: Run tests, verify they fail**

```bash
bun test src/discovery.test.ts
```

Expected: FAIL — `discovery` module does not exist yet.

**Step 3: Implement discovery module**

```typescript
// src/discovery.ts

export interface Endpoints {
  micropub: string;
  media_endpoint?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
}

/**
 * Parse HTTP Link headers into a map of rel -> href.
 */
export function parseLinkHeaders(
  header: string | null
): Record<string, string> {
  if (!header) return {};
  const links: Record<string, string> = {};

  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      links[match[2]] = match[1];
    }
  }
  return links;
}

/**
 * Parse HTML <link rel="..."> tags into a map of rel -> href.
 */
function parseHtmlLinks(html: string): Record<string, string> {
  const links: Record<string, string> = {};
  const regex = /<link[^>]+rel="([^"]+)"[^>]+href="([^"]+)"/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    links[match[1]] = match[2];
  }

  // Also match href before rel
  const regex2 = /<link[^>]+href="([^"]+)"[^>]+rel="([^"]+)"/gi;
  while ((match = regex2.exec(html)) !== null) {
    links[match[2]] = match[1];
  }

  return links;
}

/**
 * Discover Micropub and IndieAuth endpoints from a site URL.
 * Checks HTTP Link headers first, then HTML <link> tags.
 * If indieauth-metadata is found, fetches it for auth/token endpoints.
 */
export async function discoverEndpoints(siteUrl: string): Promise<Endpoints> {
  const response = await fetch(siteUrl, {
    headers: { Accept: "text/html" },
    redirect: "follow",
  });

  const html = await response.text();

  // Merge Link headers and HTML link tags (headers take precedence)
  const htmlLinks = parseHtmlLinks(html);
  const headerLinks = parseLinkHeaders(response.headers.get("Link"));
  const allLinks = { ...htmlLinks, ...headerLinks };

  // If indieauth-metadata found, fetch it for auth endpoints
  if (allLinks["indieauth-metadata"]) {
    const metaResponse = await fetch(allLinks["indieauth-metadata"]);
    const metadata = (await metaResponse.json()) as Record<string, string>;
    if (metadata.authorization_endpoint) {
      allLinks.authorization_endpoint = metadata.authorization_endpoint;
    }
    if (metadata.token_endpoint) {
      allLinks.token_endpoint = metadata.token_endpoint;
    }
  }

  if (!allLinks.micropub) {
    throw new Error(
      `Could not find micropub endpoint at ${siteUrl}. ` +
        'Ensure the site has a <link rel="micropub"> tag or Link header.'
    );
  }

  return {
    micropub: allLinks.micropub,
    media_endpoint: allLinks["media-endpoint"],
    authorization_endpoint: allLinks.authorization_endpoint,
    token_endpoint: allLinks.token_endpoint,
  };
}
```

**Step 4: Run tests, verify they pass**

```bash
bun test src/discovery.test.ts
```

Expected: all 5 tests PASS.

**Step 5: Commit**

```bash
git add src/discovery.ts src/discovery.test.ts
git commit -m "feat: endpoint discovery from site URL (Link headers + HTML + indieauth-metadata)"
```

---

### Task 3: Auth Module — PKCE and Token Storage

**Files:**
- Create: `src/auth.ts`
- Create: `src/auth.test.ts`

**Context:** Implements IndieAuth with PKCE (RFC 7636). Generates code verifier/challenge, stores tokens to `~/.config/micropub-mcp/<domain>.json`, handles token refresh. The browser flow uses a temporary HTTP server on localhost:19750. See the IndieAuth spec.

**Step 1: Write failing tests for PKCE and token storage**

```typescript
// src/auth.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePKCE, TokenStore } from "./auth";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("generatePKCE", () => {
  it("should generate verifier of 43-128 characters", () => {
    const pkce = generatePKCE();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.verifier.length).toBeLessThanOrEqual(128);
  });

  it("should generate base64url challenge", () => {
    const pkce = generatePKCE();
    // base64url: no +, /, or = padding
    expect(pkce.challenge).not.toMatch(/[+/=]/);
    expect(pkce.challenge.length).toBeGreaterThan(0);
  });

  it("should generate different values each time", () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe("TokenStore", () => {
  let tempDir: string;
  let store: TokenStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "micropub-mcp-test-"));
    store = new TokenStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should return null for unknown domain", async () => {
    const token = await store.load("example.com");
    expect(token).toBeNull();
  });

  it("should save and load token", async () => {
    const tokenData = {
      me: "https://example.com/",
      access_token: "test-token",
      token_type: "Bearer" as const,
      scope: "create update delete media",
      micropub_endpoint: "https://example.com/micropub",
      token_endpoint: "https://example.com/token",
    };

    await store.save("example.com", tokenData);
    const loaded = await store.load("example.com");
    expect(loaded).toEqual(tokenData);
  });

  it("should report valid token as not expired", async () => {
    const tokenData = {
      me: "https://example.com/",
      access_token: "test-token",
      token_type: "Bearer" as const,
      scope: "create",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      micropub_endpoint: "https://example.com/micropub",
      token_endpoint: "https://example.com/token",
    };

    await store.save("example.com", tokenData);
    const loaded = await store.load("example.com");
    expect(store.isExpired(loaded!)).toBe(false);
  });

  it("should report old token as expired", async () => {
    const tokenData = {
      me: "https://example.com/",
      access_token: "test-token",
      token_type: "Bearer" as const,
      scope: "create",
      expires_at: Math.floor(Date.now() / 1000) - 100,
      micropub_endpoint: "https://example.com/micropub",
      token_endpoint: "https://example.com/token",
    };

    await store.save("example.com", tokenData);
    const loaded = await store.load("example.com");
    expect(store.isExpired(loaded!)).toBe(true);
  });

  it("should treat token without expires_at as not expired", async () => {
    const tokenData = {
      me: "https://example.com/",
      access_token: "test-token",
      token_type: "Bearer" as const,
      scope: "create",
      micropub_endpoint: "https://example.com/micropub",
      token_endpoint: "https://example.com/token",
    };

    await store.save("example.com", tokenData);
    const loaded = await store.load("example.com");
    expect(store.isExpired(loaded!)).toBe(false);
  });
});
```

**Step 2: Run tests, verify they fail**

```bash
bun test src/auth.test.ts
```

Expected: FAIL — `auth` module does not exist.

**Step 3: Implement auth module**

```typescript
// src/auth.ts
import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import open from "open";
import { discoverEndpoints, type Endpoints } from "./discovery";

export interface TokenData {
  me: string;
  access_token: string;
  token_type: "Bearer";
  scope: string;
  refresh_token?: string;
  expires_at?: number;
  micropub_endpoint: string;
  media_endpoint?: string;
  token_endpoint: string;
  authorization_endpoint?: string;
}

// --- PKCE ---

export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url").slice(0, 64);

  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");

  return { verifier, challenge };
}

// --- Token Storage ---

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "micropub-mcp");

export class TokenStore {
  constructor(private configDir: string = DEFAULT_CONFIG_DIR) {}

  private path(domain: string): string {
    return join(this.configDir, `${domain}.json`);
  }

  async load(domain: string): Promise<TokenData | null> {
    try {
      const raw = await readFile(this.path(domain), "utf-8");
      return JSON.parse(raw) as TokenData;
    } catch {
      return null;
    }
  }

  async save(domain: string, data: TokenData): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    await writeFile(this.path(domain), JSON.stringify(data, null, 2));
  }

  isExpired(data: TokenData): boolean {
    if (!data.expires_at) return false;
    return data.expires_at < Math.floor(Date.now() / 1000);
  }
}

// --- IndieAuth Flow ---

const CALLBACK_PORT = 19750;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;
const CLIENT_ID = `http://localhost:${CALLBACK_PORT}/`;
const DEFAULT_SCOPE = "create update delete media";

/**
 * Run the full IndieAuth flow:
 * 1. Discover endpoints
 * 2. Generate PKCE
 * 3. Open browser for authorization
 * 4. Wait for callback on temp server
 * 5. Exchange code for token
 * 6. Save token to disk
 */
export async function authenticate(
  siteUrl: string,
  scope: string = DEFAULT_SCOPE,
  store: TokenStore = new TokenStore()
): Promise<TokenData> {
  const endpoints = await discoverEndpoints(siteUrl);

  if (!endpoints.authorization_endpoint || !endpoints.token_endpoint) {
    throw new Error(
      `Could not find authorization or token endpoint at ${siteUrl}. ` +
        "Ensure the site supports IndieAuth."
    );
  }

  const pkce = generatePKCE();
  const state = randomBytes(16).toString("hex");

  // Build authorization URL
  const authUrl = new URL(endpoints.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("code_challenge", pkce.challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("me", siteUrl);

  // Wait for callback via temp server, then exchange code
  const code = await waitForCallback(state, authUrl.toString());
  const tokenData = await exchangeCode(
    code,
    pkce.verifier,
    endpoints.token_endpoint,
    endpoints
  );

  const domain = new URL(siteUrl).hostname;
  await store.save(domain, tokenData);

  return tokenData;
}

/**
 * Start a temporary HTTP server, open the browser, wait for the OAuth callback.
 * Returns the authorization code.
 */
function waitForCallback(
  expectedState: string,
  authUrl: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.stop();
      reject(new Error("Authentication timed out after 5 minutes"));
    }, 5 * 60 * 1000);

    const server = Bun.serve({
      port: CALLBACK_PORT,
      fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/callback") {
          const code = url.searchParams.get("code");
          const returnedState = url.searchParams.get("state");

          if (!code || !returnedState) {
            return new Response("Missing code or state", { status: 400 });
          }

          if (returnedState !== expectedState) {
            return new Response("State mismatch", { status: 403 });
          }

          clearTimeout(timeout);
          server.stop();
          resolve(code);

          return new Response(
            "<html><body><h1>Authenticated!</h1>" +
              "<p>You can close this tab and return to your terminal.</p>" +
              "</body></html>",
            { headers: { "Content-Type": "text/html" } }
          );
        }

        if (url.pathname === "/") {
          return new Response(
            `<html><head>` +
              `<link rel="redirect_uri" href="${REDIRECT_URI}">` +
              `</head><body><h1>Micropub MCP Client</h1></body></html>`,
            { headers: { "Content-Type": "text/html" } }
          );
        }

        return new Response("Not found", { status: 404 });
      },
    });

    open(authUrl).catch(reject);
  });
}

/**
 * Exchange authorization code for access token.
 */
async function exchangeCode(
  code: string,
  codeVerifier: string,
  tokenEndpoint: string,
  endpoints: Endpoints
): Promise<TokenData> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  if (data.error) {
    throw new Error(
      `Token exchange error: ${data.error} — ${data.error_description || ""}`
    );
  }

  const expiresIn = data.expires_in as number | undefined;

  return {
    me: data.me as string,
    access_token: data.access_token as string,
    token_type: "Bearer",
    scope: (data.scope as string) || "create update delete media",
    refresh_token: data.refresh_token as string | undefined,
    expires_at: expiresIn
      ? Math.floor(Date.now() / 1000) + expiresIn
      : undefined,
    micropub_endpoint: endpoints.micropub,
    media_endpoint: endpoints.media_endpoint,
    token_endpoint: tokenEndpoint,
    authorization_endpoint: endpoints.authorization_endpoint,
  };
}

/**
 * Refresh an expired access token using a refresh token.
 */
export async function refreshToken(
  tokenData: TokenData,
  store: TokenStore = new TokenStore()
): Promise<TokenData> {
  if (!tokenData.refresh_token) {
    throw new Error("No refresh token available — re-authentication required");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokenData.refresh_token,
    client_id: CLIENT_ID,
  });

  const response = await fetch(tokenData.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(
      `Token refresh failed (${response.status}) — re-authentication required`
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  const expiresIn = data.expires_in as number | undefined;

  const updated: TokenData = {
    ...tokenData,
    access_token: data.access_token as string,
    refresh_token:
      (data.refresh_token as string | undefined) || tokenData.refresh_token,
    expires_at: expiresIn
      ? Math.floor(Date.now() / 1000) + expiresIn
      : undefined,
  };

  const domain = new URL(tokenData.me).hostname;
  await store.save(domain, updated);

  return updated;
}

/**
 * Get a valid token for a site: load from disk, refresh if needed, or null.
 */
export async function getToken(
  siteUrl: string,
  store: TokenStore = new TokenStore()
): Promise<TokenData | null> {
  const domain = new URL(siteUrl).hostname;
  const data = await store.load(domain);

  if (!data) return null;
  if (!store.isExpired(data)) return data;

  if (data.refresh_token) {
    try {
      return await refreshToken(data, store);
    } catch {
      return null;
    }
  }

  return null;
}
```

**Step 4: Run tests, verify they pass**

```bash
bun test src/auth.test.ts
```

Expected: all 6 tests PASS.

**Step 5: Commit**

```bash
git add src/auth.ts src/auth.test.ts
git commit -m "feat: IndieAuth module with PKCE, token storage, and refresh"
```

---

### Task 4: Micropub Client

**Files:**
- Create: `src/client.ts`
- Create: `src/client.test.ts`

**Context:** Pure HTTP client that speaks Micropub. Uses JSON format for creates/updates, GET for queries, multipart for media uploads. All methods take a token and endpoint URL. See the Micropub W3C spec.

**Step 1: Write failing tests**

```typescript
// src/client.test.ts
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { MicropubClient } from "./client";

describe("MicropubClient", () => {
  let client: MicropubClient;

  beforeEach(() => {
    client = new MicropubClient({
      micropubEndpoint: "https://example.com/micropub",
      token: "test-token",
    });
  });

  describe("create", () => {
    it("should send JSON create request and return location", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(null, {
            status: 201,
            headers: { Location: "https://example.com/notes/abc" },
          })
        )
      ) as typeof fetch;

      const result = await client.create({
        type: "note",
        content: "Hello world",
      });

      expect(result.location).toBe("https://example.com/notes/abc");
      expect(result.status).toBe(201);

      const call = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
      const [url, options] = call as [string, RequestInit];
      expect(url).toBe("https://example.com/micropub");
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body as string);
      expect(body.type).toEqual(["h-entry"]);
      expect(body.properties.content).toEqual(["Hello world"]);
    });

    it("should include optional properties", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(null, {
            status: 202,
            headers: { Location: "https://example.com/articles/post" },
          })
        )
      ) as typeof fetch;

      await client.create({
        type: "article",
        content: "Body text",
        name: "My Article",
        category: ["tech", "indieweb"],
        syndicateTo: ["https://bsky.app"],
        slug: "my-article",
        postStatus: "draft",
      });

      const call = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse((call as [string, RequestInit])[1].body as string);
      expect(body.properties.name).toEqual(["My Article"]);
      expect(body.properties.category).toEqual(["tech", "indieweb"]);
      expect(body.properties["mp-syndicate-to"]).toEqual(["https://bsky.app"]);
      expect(body.properties["mp-slug"]).toEqual(["my-article"]);
      expect(body.properties["post-status"]).toEqual(["draft"]);
    });

    it("should throw on error response", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: "invalid_request",
              error_description: "Missing content",
            }),
            { status: 400 }
          )
        )
      ) as typeof fetch;

      await expect(
        client.create({ type: "note", content: "test" })
      ).rejects.toThrow("invalid_request");
    });
  });

  describe("update", () => {
    it("should send update request with replace operation", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(null, { status: 200 }))
      ) as typeof fetch;

      await client.update({
        url: "https://example.com/notes/abc",
        replace: { content: ["Updated content"] },
      });

      const call = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse((call as [string, RequestInit])[1].body as string);
      expect(body.action).toBe("update");
      expect(body.url).toBe("https://example.com/notes/abc");
      expect(body.replace).toEqual({ content: ["Updated content"] });
    });
  });

  describe("delete", () => {
    it("should send delete request", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(null, { status: 200 }))
      ) as typeof fetch;

      await client.delete("https://example.com/notes/abc");

      const call = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse((call as [string, RequestInit])[1].body as string);
      expect(body.action).toBe("delete");
      expect(body.url).toBe("https://example.com/notes/abc");
    });
  });

  describe("query", () => {
    it("should query config", async () => {
      const configResponse = {
        "media-endpoint": "https://example.com/media",
        "syndicate-to": [{ uid: "https://bsky.app", name: "Bluesky" }],
      };

      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify(configResponse), {
            headers: { "Content-Type": "application/json" },
          })
        )
      ) as typeof fetch;

      const result = await client.query({ q: "config" });
      expect(result).toEqual(configResponse);

      const call = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
      const url = new URL(call[0] as string);
      expect(url.searchParams.get("q")).toBe("config");
    });

    it("should query source with url", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ properties: { content: ["test"] } }), {
            headers: { "Content-Type": "application/json" },
          })
        )
      ) as typeof fetch;

      await client.query({
        q: "source",
        url: "https://example.com/notes/abc",
      });

      const call = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
      const url = new URL(call[0] as string);
      expect(url.searchParams.get("q")).toBe("source");
      expect(url.searchParams.get("url")).toBe("https://example.com/notes/abc");
    });
  });
});
```

**Step 2: Run tests, verify they fail**

```bash
bun test src/client.test.ts
```

Expected: FAIL — `client` module does not exist.

**Step 3: Implement Micropub client**

```typescript
// src/client.ts

export interface MicropubClientConfig {
  micropubEndpoint: string;
  mediaEndpoint?: string;
  token: string;
}

export interface CreateOptions {
  type?: string;
  content?: string;
  name?: string;
  category?: string[];
  syndicateTo?: string[];
  inReplyTo?: string;
  likeOf?: string;
  repostOf?: string;
  photo?: string[];
  video?: string[];
  audio?: string[];
  slug?: string;
  postStatus?: string;
  published?: string;
  summary?: string;
}

export interface UpdateOptions {
  url: string;
  replace?: Record<string, string[]>;
  add?: Record<string, string[]>;
  delete?: string[] | Record<string, string[]>;
}

export interface QueryOptions {
  q: string;
  url?: string;
  properties?: string[];
  limit?: number;
  offset?: number;
}

export interface CreateResult {
  location: string;
  status: number;
}

export class MicropubClient {
  private endpoint: string;
  private mediaEndpoint?: string;
  private token: string;

  constructor(config: MicropubClientConfig) {
    this.endpoint = config.micropubEndpoint;
    this.mediaEndpoint = config.mediaEndpoint;
    this.token = config.token;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
  }

  private async checkError(response: Response): Promise<void> {
    if (response.ok) return;

    let message = `Micropub error (${response.status})`;
    try {
      const body = (await response.json()) as Record<string, string>;
      if (body.error) {
        message = body.error;
        if (body.error_description) {
          message += `: ${body.error_description}`;
        }
      }
    } catch {
      // Response was not JSON
    }
    throw new Error(message);
  }

  async create(options: CreateOptions): Promise<CreateResult> {
    const properties: Record<string, unknown[]> = {};

    if (options.content) properties.content = [options.content];
    if (options.name) properties.name = [options.name];
    if (options.summary) properties.summary = [options.summary];
    if (options.published) properties.published = [options.published];
    if (options.category) properties.category = options.category;
    if (options.syndicateTo) properties["mp-syndicate-to"] = options.syndicateTo;
    if (options.inReplyTo) properties["in-reply-to"] = [options.inReplyTo];
    if (options.likeOf) properties["like-of"] = [options.likeOf];
    if (options.repostOf) properties["repost-of"] = [options.repostOf];
    if (options.photo) properties.photo = options.photo;
    if (options.video) properties.video = options.video;
    if (options.audio) properties.audio = options.audio;
    if (options.slug) properties["mp-slug"] = [options.slug];
    if (options.postStatus) properties["post-status"] = [options.postStatus];

    const hType = options.type === "event" ? "h-event" : "h-entry";

    const body = { type: [hType], properties };

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    await this.checkError(response);

    const location = response.headers.get("Location");
    if (!location) {
      throw new Error("Server returned success but no Location header");
    }

    return { location, status: response.status };
  }

  async update(options: UpdateOptions): Promise<void> {
    const body: Record<string, unknown> = {
      action: "update",
      url: options.url,
    };

    if (options.replace) body.replace = options.replace;
    if (options.add) body.add = options.add;
    if (options.delete) body.delete = options.delete;

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    await this.checkError(response);
  }

  async delete(url: string): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ action: "delete", url }),
    });

    await this.checkError(response);
  }

  async undelete(url: string): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ action: "undelete", url }),
    });

    await this.checkError(response);
  }

  async query(options: QueryOptions): Promise<unknown> {
    const url = new URL(this.endpoint);
    url.searchParams.set("q", options.q);

    if (options.url) url.searchParams.set("url", options.url);
    if (options.limit) url.searchParams.set("limit", String(options.limit));
    if (options.offset) url.searchParams.set("offset", String(options.offset));
    if (options.properties) {
      for (const prop of options.properties) {
        url.searchParams.append("properties[]", prop);
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });

    await this.checkError(response);
    return response.json();
  }

  async uploadMedia(filePath: string): Promise<string> {
    if (!this.mediaEndpoint) {
      throw new Error("No media endpoint configured. Query ?q=config to check.");
    }

    const file = Bun.file(filePath);
    const formData = new FormData();
    const name = filePath.split("/").pop() || "upload";
    formData.append("file", file, name);

    const response = await fetch(this.mediaEndpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });

    await this.checkError(response);

    const location = response.headers.get("Location");
    if (!location) {
      throw new Error("Media endpoint returned success but no Location header");
    }

    return location;
  }
}
```

**Step 4: Run tests, verify they pass**

```bash
bun test src/client.test.ts
```

Expected: all 6 tests PASS.

**Step 5: Commit**

```bash
git add src/client.ts src/client.test.ts
git commit -m "feat: Micropub HTTP client with create, update, delete, query, and media upload"
```

---

### Task 5: MCP Tool Definitions

**Files:**
- Create: `src/tools.ts`

**Context:** Defines MCP tools using Zod schemas. Each tool maps to a MicropubClient method. The auth tool triggers the IndieAuth flow. Tools handle loading/refreshing tokens transparently. Uses the v1 `server.tool()` API from `@modelcontextprotocol/sdk`.

**Step 1: Implement tools module**

```typescript
// src/tools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MicropubClient } from "./client";
import { authenticate, getToken, TokenStore, type TokenData } from "./auth";

const store = new TokenStore();

async function getClient(siteUrl?: string): Promise<{
  client: MicropubClient;
  tokenData: TokenData;
}> {
  const url = siteUrl || "https://rmendes.net";
  const tokenData = await getToken(url, store);

  if (!tokenData) {
    throw new Error(
      `Not authenticated. Call micropub_auth with site_url="${url}" first.`
    );
  }

  const client = new MicropubClient({
    micropubEndpoint: tokenData.micropub_endpoint,
    mediaEndpoint: tokenData.media_endpoint,
    token: tokenData.access_token,
  });

  return { client, tokenData };
}

export function registerTools(server: McpServer): void {
  server.tool(
    "micropub_auth",
    "Authenticate with an IndieAuth-enabled site to get a Micropub access token. Opens a browser for authorization.",
    {
      site_url: z.string().url().describe("The URL of the site to authenticate with"),
      scope: z.string().optional().describe("OAuth scopes (default: 'create update delete media')"),
    },
    async ({ site_url, scope }) => {
      const existing = await getToken(site_url, store);
      if (existing) {
        return {
          content: [{
            type: "text" as const,
            text: [
              `Already authenticated as ${existing.me}`,
              `Micropub endpoint: ${existing.micropub_endpoint}`,
              `Scope: ${existing.scope}`,
              `To re-authenticate, delete ~/.config/micropub-mcp/${new URL(site_url).hostname}.json and try again.`,
            ].join("\n"),
          }],
        };
      }

      const tokenData = await authenticate(site_url, scope, store);
      return {
        content: [{
          type: "text" as const,
          text: [
            `Authenticated as ${tokenData.me}`,
            `Micropub endpoint: ${tokenData.micropub_endpoint}`,
            `Media endpoint: ${tokenData.media_endpoint || "none"}`,
            `Scope: ${tokenData.scope}`,
          ].join("\n"),
        }],
      };
    }
  );

  server.tool(
    "micropub_create",
    "Create a new post on the blog via Micropub.",
    {
      type: z.string().optional().default("note").describe("Post type: note, article, photo, bookmark, reply, like, repost, event, video, audio"),
      content: z.string().optional().describe("The post content (text or markdown)"),
      name: z.string().optional().describe("Post title (required for articles)"),
      summary: z.string().optional().describe("Post summary/excerpt"),
      category: z.array(z.string()).optional().describe("Tags/categories"),
      syndicate_to: z.array(z.string()).optional().describe("Syndication target UIDs"),
      in_reply_to: z.string().url().optional().describe("URL this post replies to"),
      like_of: z.string().url().optional().describe("URL this post is a like of"),
      repost_of: z.string().url().optional().describe("URL this post is a repost of"),
      photo: z.array(z.string()).optional().describe("Photo URLs (upload first via micropub_upload)"),
      slug: z.string().optional().describe("Custom URL slug"),
      post_status: z.enum(["published", "draft"]).optional().describe("Post status (default: published)"),
      published: z.string().optional().describe("Publication date (ISO 8601)"),
    },
    async (args) => {
      const { client } = await getClient();
      const result = await client.create({
        type: args.type,
        content: args.content,
        name: args.name,
        summary: args.summary,
        category: args.category,
        syndicateTo: args.syndicate_to,
        inReplyTo: args.in_reply_to,
        likeOf: args.like_of,
        repostOf: args.repost_of,
        photo: args.photo,
        slug: args.slug,
        postStatus: args.post_status,
        published: args.published,
      });

      return {
        content: [{
          type: "text" as const,
          text: `Post created (${result.status})!\nURL: ${result.location}`,
        }],
      };
    }
  );

  server.tool(
    "micropub_update",
    "Update an existing post.",
    {
      url: z.string().url().describe("URL of the post to update"),
      replace: z.record(z.array(z.string())).optional().describe('Properties to replace, e.g. {"content": ["new"]}'),
      add: z.record(z.array(z.string())).optional().describe('Properties to add to, e.g. {"category": ["tag"]}'),
      delete_properties: z.union([z.array(z.string()), z.record(z.array(z.string()))]).optional().describe("Properties to delete"),
    },
    async ({ url, replace, add, delete_properties }) => {
      const { client } = await getClient();
      await client.update({ url, replace, add, delete: delete_properties });
      return { content: [{ type: "text" as const, text: `Post updated: ${url}` }] };
    }
  );

  server.tool(
    "micropub_delete",
    "Delete a post from the blog.",
    { url: z.string().url().describe("URL of the post to delete") },
    async ({ url }) => {
      const { client } = await getClient();
      await client.delete(url);
      return { content: [{ type: "text" as const, text: `Post deleted: ${url}` }] };
    }
  );

  server.tool(
    "micropub_undelete",
    "Restore a previously deleted post.",
    { url: z.string().url().describe("URL of the post to restore") },
    async ({ url }) => {
      const { client } = await getClient();
      await client.undelete(url);
      return { content: [{ type: "text" as const, text: `Post restored: ${url}` }] };
    }
  );

  server.tool(
    "micropub_query",
    "Query the Micropub endpoint for config, posts, syndication targets, post types, or categories.",
    {
      q: z.enum(["config", "source", "syndicate-to", "post-types", "category", "channel"]).describe("Query type"),
      url: z.string().url().optional().describe("Post URL (for q=source)"),
      properties: z.array(z.string()).optional().describe("Specific properties to return"),
      limit: z.number().optional().describe("Max results"),
      offset: z.number().optional().describe("Results offset"),
    },
    async (args) => {
      const { client } = await getClient();
      const result = await client.query(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "micropub_upload",
    "Upload a media file to the Micropub media endpoint. Returns a URL to use in micropub_create.",
    {
      file_path: z.string().describe("Absolute path to the file to upload"),
    },
    async ({ file_path }) => {
      const { client } = await getClient();
      const url = await client.uploadMedia(file_path);
      return {
        content: [{
          type: "text" as const,
          text: `File uploaded!\nURL: ${url}\n\nUse this URL in micropub_create's photo/video/audio parameter.`,
        }],
      };
    }
  );
}
```

**Step 2: Commit**

```bash
git add src/tools.ts
git commit -m "feat: MCP tool definitions for all Micropub operations"
```

---

### Task 6: MCP Server Entry Point

**Files:**
- Create: `src/index.ts`

**Step 1: Implement entry point**

```typescript
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools";

const server = new McpServer({
  name: "micropub-mcp",
  version: "0.1.0",
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Step 2: Verify it starts**

Send an initialize JSON-RPC message via stdin and check for a response:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | bun run src/index.ts 2>/dev/null | head -1
```

Expected: JSON response containing server info and tool capabilities.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: MCP server entry point with stdio transport"
```

---

### Task 7: Claude Code Integration and CLAUDE.md

**Files:**
- Create: `CLAUDE.md`
- Modify: `/home/rick/code/indiekit-dev/.mcp.json`

**Step 1: Create CLAUDE.md for the project**

Document the project overview, commands, architecture, tools, and first-use flow.

**Step 2: Add micropub server to .mcp.json**

Add to `/home/rick/code/indiekit-dev/.mcp.json`:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--browser", "chrome", "--caps", "vision"]
    },
    "micropub": {
      "command": "bun",
      "args": ["run", "/home/rick/code/indiekit-dev/indiekit-mcp-micropub/src/index.ts"]
    }
  }
}
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md and MCP server configuration"
```

---

### Task 8: End-to-End Test (Manual)

**Step 1:** Restart Claude Code so it picks up the new .mcp.json entry.

**Step 2:** Call `micropub_auth` with `site_url="https://rmendes.net"`. Approve in browser. Verify `~/.config/micropub-mcp/rmendes.net.json` exists.

**Step 3:** Call `micropub_query` with `q="config"`. Verify response.

**Step 4:** Call `micropub_query` with `q="post-types"`. Verify response.

**Step 5:** Call `micropub_create` with `type="note"`, `content="Testing Micropub from the terminal via MCP!"`, `post_status="draft"`. Verify Location URL returned.

**Step 6:** Call `micropub_query` with `q="source"` and the URL from step 5. Verify post properties.

**Step 7:** Call `micropub_delete` with the URL from step 5. Verify success.

---

## Summary

| Task | What | Files | Tests |
|------|------|-------|-------|
| 1 | Project scaffold | package.json, tsconfig.json, .gitignore | — |
| 2 | Endpoint discovery | src/discovery.ts | src/discovery.test.ts (5 tests) |
| 3 | IndieAuth + PKCE + tokens | src/auth.ts | src/auth.test.ts (6 tests) |
| 4 | Micropub HTTP client | src/client.ts | src/client.test.ts (6 tests) |
| 5 | MCP tool definitions | src/tools.ts | — |
| 6 | MCP server entry point | src/index.ts | — |
| 7 | Claude Code integration | CLAUDE.md, .mcp.json | — |
| 8 | E2E test (manual) | — | Manual verification |
