/**
 * Pure HTTP client that speaks the Micropub protocol (W3C spec).
 *
 * Uses JSON format for creates/updates, GET for queries,
 * and multipart for media uploads. All methods require a
 * token and endpoint URL provided at construction time.
 */

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
  aiTextLevel?: string;
  aiCodeLevel?: string;
  aiTools?: string;
  aiDescription?: string;
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
    if (options.syndicateTo)
      properties["mp-syndicate-to"] = options.syndicateTo;
    if (options.inReplyTo) properties["in-reply-to"] = [options.inReplyTo];
    if (options.likeOf) properties["like-of"] = [options.likeOf];
    if (options.repostOf) properties["repost-of"] = [options.repostOf];
    if (options.photo) properties.photo = options.photo;
    if (options.video) properties.video = options.video;
    if (options.audio) properties.audio = options.audio;
    if (options.slug) properties["mp-slug"] = [options.slug];
    if (options.postStatus) properties["post-status"] = [options.postStatus];
    if (options.aiTextLevel) properties["ai-text-level"] = [options.aiTextLevel];
    if (options.aiCodeLevel) properties["ai-code-level"] = [options.aiCodeLevel];
    if (options.aiTools) properties["ai-tools"] = [options.aiTools];
    if (options.aiDescription) properties["ai-description"] = [options.aiDescription];

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
      throw new Error(
        "No media endpoint configured. Query ?q=config to check."
      );
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
      throw new Error(
        "Media endpoint returned success but no Location header"
      );
    }

    return location;
  }
}
