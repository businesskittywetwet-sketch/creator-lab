import { XMLParser } from "fast-xml-parser";
import { fetchText } from "@/engine/http";
import { SourceConfigError } from "@/engine/http";
import {
  cfgNum,
  cfgStr,
  cleanText,
  cleanTitle,
  type RawStoryItem,
  type SourceAdapter,
  type SourceRowLite,
} from "./types";

/* Generic RSS 2.0 / Atom parser used by the rss adapter and any       */
/* adapter that ultimately returns an RSS feed (e.g. Google News).     */

type XmlNode = Record<string, unknown>;

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object") {
    const n = node as XmlNode;
    if (typeof n["#text"] === "string") return n["#text"] as string;
  }
  return "";
}

export function parseFeed(xml: string, sourceName: string, limit: number): RawStoryItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  });
  const doc = parser.parse(xml) as XmlNode;

  // RSS 2.0
  const rss = doc.rss as XmlNode | undefined;
  const channel = rss?.channel as XmlNode | undefined;
  if (channel) {
    const items = asArray(channel.item as XmlNode | XmlNode[] | undefined);
    return items.slice(0, limit).map((item, i) => {
      const title = cleanTitle(textOf(item.title));
      const link = textOf(item.link);
      const guid = textOf(item.guid) || link || title;
      const desc = cleanText(textOf(item.description) || textOf(item["content:encoded"]));
      return {
        externalId: String(guid),
        title,
        summary: desc,
        url: link,
        signals: { rank: i + 1 },
        publishedAt: textOf(item.pubDate) || textOf(item["dc:date"]) || undefined,
        tags: [],
      };
    });
  }

  // Atom
  const feed = doc.feed as XmlNode | undefined;
  if (feed) {
    const entries = asArray(feed.entry as XmlNode | XmlNode[] | undefined);
    return entries.slice(0, limit).map((entry, i) => {
      const linkNode = asArray(entry.link as XmlNode | XmlNode[] | undefined)[0];
      const link =
        (linkNode?.["@_href"] as string | undefined) ?? textOf(entry.link);
      const title = cleanTitle(textOf(entry.title));
      return {
        externalId: textOf(entry.id) || link || title,
        title,
        summary: cleanText(textOf(entry.summary) || textOf(entry.content)),
        url: link,
        signals: { rank: i + 1 },
        publishedAt: textOf(entry.published) || textOf(entry.updated) || undefined,
        tags: [],
      };
    });
  }

  throw new SourceConfigError(`Unrecognised feed format at ${sourceName}`);
}

export const rssAdapter: SourceAdapter = {
  type: "rss",
  async fetch(source: SourceRowLite): Promise<RawStoryItem[]> {
    const feedUrl = cfgStr(source.config, "feedUrl");
    if (!feedUrl)
      throw new SourceConfigError(`rss source "${source.name}" is missing config.feedUrl`);
    const limit = cfgNum(source.config, "limit", 15);
    const xml = await fetchText(feedUrl);
    return parseFeed(xml, source.name, limit);
  },
};

const GOOGLE_NEWS_RSS =
  "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=";

export const googleNewsAdapter: SourceAdapter = {
  type: "googlenews",
  async fetch(source: SourceRowLite): Promise<RawStoryItem[]> {
    const query = cfgStr(source.config, "query");
    if (!query)
      throw new SourceConfigError(
        `googlenews source "${source.name}" is missing config.query`,
      );
    const limit = cfgNum(source.config, "limit", 15);
    const xml = await fetchText(`${GOOGLE_NEWS_RSS}${encodeURIComponent(query)}`);
    return parseFeed(xml, source.name, limit);
  },
};
