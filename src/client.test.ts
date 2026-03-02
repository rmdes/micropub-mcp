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
      const body = JSON.parse(
        (call as [string, RequestInit])[1].body as string
      );
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
      const body = JSON.parse(
        (call as [string, RequestInit])[1].body as string
      );
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
      const body = JSON.parse(
        (call as [string, RequestInit])[1].body as string
      );
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
          new Response(
            JSON.stringify({ properties: { content: ["test"] } }),
            {
              headers: { "Content-Type": "application/json" },
            }
          )
        )
      ) as typeof fetch;

      await client.query({
        q: "source",
        url: "https://example.com/notes/abc",
      });

      const call = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
      const url = new URL(call[0] as string);
      expect(url.searchParams.get("q")).toBe("source");
      expect(url.searchParams.get("url")).toBe(
        "https://example.com/notes/abc"
      );
    });
  });
});
