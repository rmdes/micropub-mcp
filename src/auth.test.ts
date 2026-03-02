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
