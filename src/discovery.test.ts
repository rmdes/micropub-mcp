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
    const metadataUrl =
      "https://example.com/.well-known/oauth-authorization-server";
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
