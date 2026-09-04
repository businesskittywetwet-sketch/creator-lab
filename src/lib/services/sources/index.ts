import { googleNewsAdapter, rssAdapter } from "./rss";
import { hackerNewsAdapter, newsApiAdapter, redditAdapter } from "./social";
import type { SourceAdapter } from "./types";

/* Source adapter registry. The scout reads enabled rows from the      */
/* story_sources table and dispatches each to its adapter by type.     */
/* New adapters register here; new sources need no code at all.        */

export const SOURCE_ADAPTERS: Record<string, SourceAdapter> = {
  rss: rssAdapter,
  googlenews: googleNewsAdapter,
  hackernews: hackerNewsAdapter,
  reddit: redditAdapter,
  newsapi: newsApiAdapter,
};

export function adapterFor(type: string): SourceAdapter | undefined {
  return SOURCE_ADAPTERS[type];
}

export type { RawStoryItem, SourceRowLite } from "./types";
