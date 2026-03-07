/**
 * Import micro.blog bookmarks into Indiekit via Micropub.
 *
 * Usage:
 *   bun run scripts/import-bookmarks.ts /path/to/microblog_bookmarks.html [--dry-run]
 *
 * Reads the HTML export, parses each <li><a> bookmark, and creates
 * a Micropub bookmark post preserving the original published date and tags.
 *
 * Uses the stored auth token from ~/.config/micropub-mcp/rmendes.net.json
 */

import { readFileSync } from "node:fs";
import { TokenStore } from "../src/auth";
import { MicropubClient } from "../src/client";

const SITE_URL = "https://rmendes.net";
const DELAY_MS = 500; // delay between posts to avoid overwhelming the server

interface Bookmark {
  href: string;
  title: string;
  tags: string[];
  datetime: string; // ISO 8601
}

function parseBookmarksHTML(html: string): Bookmark[] {
  const bookmarks: Bookmark[] = [];

  // Match each <li><a ...>...</a></li>
  const liRegex = /<li><a\s+([^>]+)>([\s\S]*?)<\/a><\/li>/gi;
  let match;

  while ((match = liRegex.exec(html)) !== null) {
    const attrs = match[1];
    const text = match[2];

    // Extract href
    const hrefMatch = attrs.match(/href="([^"]+)"/);
    if (!hrefMatch) continue;
    const href = hrefMatch[1];

    // Extract tags
    const tagsMatch = attrs.match(/tags="([^"]*)"/);
    const tagsStr = tagsMatch ? tagsMatch[1].trim() : "";
    const tags = tagsStr
      ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    // Extract datetime
    const dtMatch = attrs.match(/datetime="([^"]+)"/);
    const datetime = dtMatch ? dtMatch[1].replace(" ", "T") + "Z" : "";

    // Clean title: decode HTML entities, normalize whitespace
    let title = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&[a-z]+;/g, "") // strip remaining entities like &ndash; &rsquo; etc.
      .replace(/\s+/g, " ")
      .trim();

    // Strip trailing domain name (micro.blog appends "domain.com" to titles)
    try {
      const domain = new URL(href).hostname.replace(/^www\./, "");
      if (title.endsWith(domain)) {
        title = title.slice(0, -domain.length).trim();
      }
    } catch {
      // Invalid URL, keep title as-is
    }

    bookmarks.push({ href, title, tags, datetime });
  }

  return bookmarks;
}

async function main() {
  const args = Bun.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filePath = args.find((a) => !a.startsWith("--"));

  if (!filePath) {
    console.error("Usage: bun run scripts/import-bookmarks.ts <file.html> [--dry-run]");
    // eslint-disable-next-line unicorn/no-process-exit
    throw new Error("No file path provided");
  }

  const html = readFileSync(filePath, "utf-8");
  const bookmarks = parseBookmarksHTML(html);

  console.log(`Found ${bookmarks.length} bookmarks`);

  if (dryRun) {
    console.log("\n--- DRY RUN (no posts will be created) ---\n");
    for (const bm of bookmarks.slice(0, 10)) {
      console.log(`  ${bm.datetime} | ${bm.href}`);
      console.log(`    Title: ${bm.title}`);
      if (bm.tags.length) console.log(`    Tags: ${bm.tags.join(", ")}`);
      console.log();
    }
    if (bookmarks.length > 10) {
      console.log(`  ... and ${bookmarks.length - 10} more`);
    }
    return;
  }

  // Load stored token
  const store = new TokenStore();
  const hostname = new URL(SITE_URL).hostname;
  const tokenData = await store.load(hostname);

  if (!tokenData) {
    console.error(`No auth token found for ${hostname}. Run micropub_auth first.`);
    throw new Error("No auth token found");
  }

  const client = new MicropubClient({
    micropubEndpoint: tokenData.micropub_endpoint,
    mediaEndpoint: tokenData.media_endpoint,
    token: tokenData.access_token,
  });

  console.log(`\nImporting ${bookmarks.length} bookmarks to ${SITE_URL}...\n`);

  let success = 0;
  let failed = 0;
  const errors: { href: string; error: string }[] = [];

  for (let i = 0; i < bookmarks.length; i++) {
    const bm = bookmarks[i];
    const progress = `[${i + 1}/${bookmarks.length}]`;

    try {
      const result = await client.create({
        bookmarkOf: bm.href,
        name: bm.title,
        category: bm.tags.length ? bm.tags : undefined,
        published: bm.datetime || undefined,
      });
      console.log(`${progress} OK: ${result.location}`);
      success++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${progress} FAIL: ${bm.href} — ${msg}`);
      errors.push({ href: bm.href, error: msg });
      failed++;
    }

    // Small delay between requests
    if (i < bookmarks.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\nDone! ${success} imported, ${failed} failed.`);
  if (errors.length) {
    console.log("\nFailed bookmarks:");
    for (const e of errors) {
      console.log(`  ${e.href}: ${e.error}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
});
