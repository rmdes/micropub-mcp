// src/tools.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MicropubClient } from "./client";
import { startAuth, getToken, hasPendingAuth, TokenStore, type TokenData } from "./auth";

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
      site_url: z
        .string()
        .url()
        .describe("The URL of the site to authenticate with"),
      scope: z
        .string()
        .optional()
        .describe("OAuth scopes (default: 'create update delete media')"),
    },
    async ({ site_url, scope }) => {
      // Check if already authenticated
      const existing = await getToken(site_url, store);
      if (existing) {
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Already authenticated as ${existing.me}`,
                `Micropub endpoint: ${existing.micropub_endpoint}`,
                `Scope: ${existing.scope}`,
                `To re-authenticate, delete ~/.config/micropub-mcp/${new URL(site_url).hostname}.json and try again.`,
              ].join("\n"),
            },
          ],
        };
      }

      // Check if auth is pending (user hasn't clicked Allow yet)
      if (hasPendingAuth()) {
        return {
          content: [
            {
              type: "text" as const,
              text: [
                "Authentication is still in progress.",
                "Please complete the authorization in your browser (click Allow).",
                "The callback server is running and waiting for the redirect.",
                "Call this tool again after you've approved in the browser.",
              ].join("\n"),
            },
          ],
        };
      }

      // Start non-blocking auth flow: returns immediately with auth URL
      const { authUrl } = await startAuth(site_url, scope, store);
      return {
        content: [
          {
            type: "text" as const,
            text: [
              "Authentication started! A browser window should have opened.",
              "",
              "Please:",
              "1. Enter your password in the consent form",
              "2. Click 'Allow' to authorize",
              "3. Wait for the 'Authenticated!' confirmation page",
              "4. Then call micropub_auth again to confirm, or start using micropub_create",
              "",
              `If the browser didn't open, visit this URL manually:`,
              authUrl,
            ].join("\n"),
          },
        ],
      };
    }
  );

  server.tool(
    "micropub_create",
    "Create a new post on the blog via Micropub.",
    {
      type: z
        .string()
        .optional()
        .default("note")
        .describe(
          "Post type: note, article, photo, bookmark, reply, like, repost, event, video, audio"
        ),
      content: z
        .string()
        .optional()
        .describe("The post content (text or markdown)"),
      name: z
        .string()
        .optional()
        .describe("Post title (required for articles)"),
      summary: z.string().optional().describe("Post summary/excerpt"),
      category: z.array(z.string()).optional().describe("Tags/categories"),
      syndicate_to: z
        .array(z.string())
        .optional()
        .describe("Syndication target UIDs"),
      in_reply_to: z
        .string()
        .url()
        .optional()
        .describe("URL this post replies to"),
      like_of: z
        .string()
        .url()
        .optional()
        .describe("URL this post is a like of"),
      repost_of: z
        .string()
        .url()
        .optional()
        .describe("URL this post is a repost of"),
      bookmark_of: z
        .string()
        .url()
        .optional()
        .describe("URL this post is a bookmark of"),
      photo: z
        .array(z.string())
        .optional()
        .describe("Photo URLs (upload first via micropub_upload)"),
      slug: z.string().optional().describe("Custom URL slug"),
      post_status: z
        .enum(["published", "draft"])
        .optional()
        .describe("Post status (default: published)"),
      published: z.string().optional().describe("Publication date (ISO 8601)"),
      ai_text_level: z
        .enum(["0", "1", "2", "3"])
        .optional()
        .describe(
          "AI text usage: 0=None, 1=Editorial assistance, 2=Co-drafting, 3=AI-generated (human reviewed)"
        ),
      ai_code_level: z
        .enum(["0", "1", "2"])
        .optional()
        .describe(
          "AI code usage: 0=Human-written, 1=AI-assisted, 2=Primarily AI-generated"
        ),
      ai_tools: z
        .string()
        .optional()
        .describe("AI tools used (e.g. Claude, ChatGPT, Copilot)"),
      ai_description: z
        .string()
        .optional()
        .describe("Description of how AI was used"),
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
        bookmarkOf: args.bookmark_of,
        photo: args.photo,
        slug: args.slug,
        postStatus: args.post_status,
        published: args.published,
        aiTextLevel: args.ai_text_level,
        aiCodeLevel: args.ai_code_level,
        aiTools: args.ai_tools,
        aiDescription: args.ai_description,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Post created (${result.status})!\nURL: ${result.location}`,
          },
        ],
      };
    }
  );

  server.tool(
    "micropub_update",
    "Update an existing post.",
    {
      url: z.string().url().describe("URL of the post to update"),
      replace: z
        .record(z.array(z.string()))
        .optional()
        .describe('Properties to replace, e.g. {"content": ["new"]}'),
      add: z
        .record(z.array(z.string()))
        .optional()
        .describe('Properties to add to, e.g. {"category": ["tag"]}'),
      delete_properties: z
        .union([z.array(z.string()), z.record(z.array(z.string()))])
        .optional()
        .describe("Properties to delete"),
    },
    async ({ url, replace, add, delete_properties }) => {
      const { client } = await getClient();
      await client.update({ url, replace, add, delete: delete_properties });
      return {
        content: [{ type: "text" as const, text: `Post updated: ${url}` }],
      };
    }
  );

  server.tool(
    "micropub_delete",
    "Delete a post from the blog.",
    { url: z.string().url().describe("URL of the post to delete") },
    async ({ url }) => {
      const { client } = await getClient();
      await client.delete(url);
      return {
        content: [{ type: "text" as const, text: `Post deleted: ${url}` }],
      };
    }
  );

  server.tool(
    "micropub_undelete",
    "Restore a previously deleted post.",
    { url: z.string().url().describe("URL of the post to restore") },
    async ({ url }) => {
      const { client } = await getClient();
      await client.undelete(url);
      return {
        content: [{ type: "text" as const, text: `Post restored: ${url}` }],
      };
    }
  );

  server.tool(
    "micropub_query",
    "Query the Micropub endpoint for config, posts, syndication targets, post types, or categories.",
    {
      q: z
        .enum([
          "config",
          "source",
          "syndicate-to",
          "post-types",
          "category",
          "channel",
        ])
        .describe("Query type"),
      url: z.string().url().optional().describe("Post URL (for q=source)"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Specific properties to return"),
      limit: z.number().optional().describe("Max results"),
      offset: z.number().optional().describe("Results offset"),
    },
    async (args) => {
      const { client } = await getClient();
      const result = await client.query(args);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
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
        content: [
          {
            type: "text" as const,
            text: `File uploaded!\nURL: ${url}\n\nUse this URL in micropub_create's photo/video/audio parameter.`,
          },
        ],
      };
    }
  );
}
