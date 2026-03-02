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
