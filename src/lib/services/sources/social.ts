import { fetchJson } from "@/engine/http";
import { SourceConfigError } from "@/engine/http";
import {
  cleanText,
  cleanTitle,
  cfgNum,
  cfgStr,
  type RawStoryItem,
  type SourceAdapter,
  type SourceRowLite,
} from "./types";

/* ------------------------- Hacker News (Algolia) ------------------- */

type HnHit = {
  objectID: string;
  title: string;
  url: string | null;
  points: number | null;
  num_comments: number | null;
  created_at: string;
};

export const hackerNewsAdapter: SourceAdapter = {
  type: "hackernews",
  async fetch(source: SourceRowLite): Promise<RawStoryItem[]> {
    const query = cfgStr(source.config, "query") ?? "entertainment";
    const limit = cfgNum(source.config, "limit", 15);
    const minPoints = cfgNum(source.config, "minPoints", 20);
    const data = await fetchJson<{ hits: HnHit[] }>(
      `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=${limit}&query=${encodeURIComponent(query)}`,
    );
    return data.hits
      .filter((h) => h.title && h.url && (h.points ?? 0) >= minPoints)
      .map((h) => ({
        externalId: h.objectID,
        title: cleanTitle(h.title),
        summary: `${h.points ?? 0} points · ${h.num_comments ?? 0} comments — trending on Hacker News`,
        url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
        signals: { score: h.points ?? 0, comments: h.num_comments ?? 0 },
        publishedAt: h.created_at,
        tags: [],
      }));
  },
};

/* ------------------------------- Reddit ---------------------------- */

type RedditChild = {
  data: {
    name: string;
    title: string;
    selftext: string;
    permalink: string;
    score: number;
    num_comments: number;
    created_utc: number;
    stickied: boolean;
    over_18: boolean;
    link_flair_text: string | null;
  };
};

export const redditAdapter: SourceAdapter = {
  type: "reddit",
  async fetch(source: SourceRowLite): Promise<RawStoryItem[]> {
    const subreddit = cfgStr(source.config, "subreddit");
    if (!subreddit)
      throw new SourceConfigError(
        `reddit source "${source.name}" is missing config.subreddit`,
      );
    const limit = cfgNum(source.config, "limit", 20);
    const minScore = cfgNum(source.config, "minScore", 50);
    const data = await fetchJson<{ data: { children: RedditChild[] } }>(
      `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/hot.json?limit=${limit}`,
    );
    return data.data.children
      .map((c) => c.data)
      .filter((p) => !p.stickied && !p.over_18 && p.score >= minScore && p.title.length > 15)
      .map((p) => ({
        externalId: p.name,
        title: cleanTitle(p.title),
        summary: cleanText(p.selftext || `${p.score} upvotes · ${p.num_comments} comments on r/${subreddit}`),
        url: `https://www.reddit.com${p.permalink}`,
        signals: { score: p.score, comments: p.num_comments },
        publishedAt: new Date(p.created_utc * 1000).toISOString(),
        tags: p.link_flair_text ? [p.link_flair_text.toLowerCase().replace(/\s+/g, "-")] : [],
      }));
  },
};

/* ------------------------------ NewsAPI ---------------------------- */

type NewsApiArticle = {
  title: string;
  description: string | null;
  url: string;
  publishedAt: string;
  source: { name: string };
};

export const newsApiAdapter: SourceAdapter = {
  type: "newsapi",
  async fetch(source: SourceRowLite): Promise<RawStoryItem[]> {
    const apiKey = process.env.NEWS_API_KEY;
    if (!apiKey)
      throw new SourceConfigError("NEWS_API_KEY is not configured — source skipped");
    const query = cfgStr(source.config, "query") ?? "entertainment";
    const limit = cfgNum(source.config, "limit", 15);
    const url = `https://newsapi.org/v2/everything?language=en&sortBy=publishedAt&pageSize=${limit}&q=${encodeURIComponent(query)}`;
    const data = await fetchJson<{ articles: NewsApiArticle[] }>(url, {
      headers: { "x-api-key": apiKey },
    });
    return data.articles
      .filter((a) => a.title && a.url && a.title !== "[Removed]")
      .map((a) => ({
        externalId: a.url,
        title: cleanTitle(a.title),
        summary: cleanText(a.description ?? ""),
        url: a.url,
        signals: {},
        publishedAt: a.publishedAt,
        tags: [],
      }));
  },
};
