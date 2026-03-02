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
