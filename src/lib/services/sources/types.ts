/* Source adapter contracts for the Story Scout.                       */
/* A "source" is a configured instance (row in story_sources) of an    */
/* adapter "type". Adding new sources later = new rows; adding new     */
/* adapters = one new file + registry entry.                           */

export type RawStoryItem = {
  externalId: string;
  title: string;
  summary: string;
  url: string;
  signals: { score?: number; comments?: number; rank?: number };
  publishedAt?: string;
  tags: string[];
};

export type SourceRowLite = {
  id: string;
  type: string;
  name: string;
  channelSlug: string | null;
  reliability: number;
  config: Record<string, unknown>;
};

export interface SourceAdapter {
  type: string;
  fetch(source: SourceRowLite): Promise<RawStoryItem[]>;
}

export function cfgStr(config: Record<string, unknown>, key: string): string | undefined {
  const v = config[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function cfgNum(config: Record<string, unknown>, key: string, fallback: number): number {
  const v = config[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/* ----------------------- normalization helpers --------------------- */

export function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ");
}

export function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function cleanText(input: string, max = 400): string {
  const cleaned = decodeEntities(stripHtml(input))
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

export function cleanTitle(input: string): string {
  return cleanText(input, 200);
}
