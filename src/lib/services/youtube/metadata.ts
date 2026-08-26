import {
  asNumber,
  asString,
  asStringList,
  callModelJson,
  resolveModel,
} from "../ai-client";
import type { ScriptSection } from "@/db/schema";

/* ------------------------------------------------------------------ */
/*  YouTube publishing metadata.                                       */
/*                                                                     */
/*  Uses the existing AI provider architecture when credentials exist;  */
/*  otherwise builds metadata deterministically from the approved      */
/*  draft. The result is always tagged real_ai | fallback so the UI    */
/*  can never present composed text as AI-generated.                   */
/*                                                                     */
/*  Descriptions are derived strictly from draft content — no invented */
/*  facts, citations, statistics or performance claims.                */
/* ------------------------------------------------------------------ */

/** YouTube category 24 = Entertainment, 27 = Education, 22 = People & Blogs. */
export const YT_CATEGORIES: { id: string; label: string }[] = [
  { id: "24", label: "Entertainment" },
  { id: "27", label: "Education" },
  { id: "22", label: "People & Blogs" },
  { id: "25", label: "News & Politics" },
  { id: "28", label: "Science & Technology" },
];

export type YtMetadata = {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  mode: "real_ai" | "fallback";
  provider: string;
};

export type MetadataInput = {
  draftTitle: string;
  hook: string;
  sections: ScriptSection[];
  cta: string;
  channelName: string;
  niche: string;
  sourceName: string;
  sourceUrl: string;
  existingHashtags: string[];
};

function sanitizeTag(t: string): string {
  return t.replace(/^#/, "").replace(/[^\w\s-]/g, "").trim().slice(0, 30);
}

function clampTitle(t: string): string {
  const clean = t.replace(/\s+/g, " ").trim();
  return clean.length > 100 ? `${clean.slice(0, 97).trimEnd()}...` : clean;
}

/** Deterministic composition from the approved draft only. */
export function composeMetadata(input: MetadataInput): YtMetadata {
  const title = clampTitle(input.draftTitle || input.hook || "Untitled");
  const body = input.sections
    .filter((s) => !s.narration.includes("[NEEDS SOURCE]"))
    .map((s) => s.narration)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const summary = body.length > 380 ? `${body.slice(0, 377).trimEnd()}...` : body;
  const tags = Array.from(
    new Set(
      [
        ...input.existingHashtags,
        ...input.niche.split(/[^a-zA-Z]+/).filter((w) => w.length > 3),
        input.channelName.replace(/\s+/g, ""),
      ]
        .map(sanitizeTag)
        .filter(Boolean),
    ),
  ).slice(0, 15);

  const parts = [summary || input.hook, ""];
  if (input.cta) parts.push(input.cta, "");
  if (input.sourceName) {
    parts.push(
      `Source: ${input.sourceName}${input.sourceUrl ? ` — ${input.sourceUrl}` : ""}`,
      "",
    );
  }
  parts.push(tags.slice(0, 5).map((t) => `#${t}`).join(" "));

  return {
    title,
    description: parts.join("\n").trim().slice(0, 5000),
    tags,
    categoryId: "24",
    mode: "fallback",
    provider: "composer:deterministic-v1",
  };
}

/** AI-authored metadata using the configured model. */
export async function generateMetadata(input: MetadataInput): Promise<YtMetadata> {
  const info = resolveModel();
  if (!info) return composeMetadata(input);

  const script = input.sections.map((s) => `${s.heading}: ${s.narration}`).join("\n");
  const prompt = `You are a YouTube growth editor for the channel "${input.channelName}" (${input.niche}).

Write publishing metadata for this short-form video.

Approved title: ${input.draftTitle}
Hook: ${input.hook}
Script:
${script.slice(0, 3000)}
Call to action: ${input.cta}
Source: ${input.sourceName} ${input.sourceUrl}

Rules:
- Title: max 100 characters, compelling but NOT misleading clickbait. No ALL CAPS.
- Description: 2-4 short paragraphs derived ONLY from the script above. Do NOT invent facts, statistics, dates, quotes or citations. Do NOT claim view counts or performance. End with the source attribution line if a source is provided.
- Tags: 8-15 lowercase search keywords, no "#" prefix, no duplicates.
- categoryId: choose one of ${YT_CATEGORIES.map((c) => `${c.id}=${c.label}`).join(", ")}.

Respond with ONLY JSON:
{"title":string,"description":string,"tags":[string],"categoryId":string}`;

  try {
    const { data } = await callModelJson(prompt, {
      label: "youtube-metadata",
      maxTokens: 1200,
      temperature: 0.6,
    });
    const title = clampTitle(asString(data.title, input.draftTitle));
    const description = asString(data.description).slice(0, 5000);
    const tags = Array.from(
      new Set(asStringList(data.tags, 20).map(sanitizeTag).filter(Boolean)),
    ).slice(0, 15);
    const catRaw = String(asNumber(data.categoryId, 24));
    const categoryId = YT_CATEGORIES.some((c) => c.id === catRaw) ? catRaw : "24";
    if (!title || !description) throw new Error("model returned incomplete metadata");
    return {
      title,
      description,
      tags: tags.length ? tags : composeMetadata(input).tags,
      categoryId,
      mode: "real_ai",
      provider: `${info.provider}:${info.model}`,
    };
  } catch (err) {
    console.warn(
      `[youtube-metadata] model failed (${err instanceof Error ? err.message : err}) — using deterministic composer`,
    );
    return composeMetadata(input);
  }
}
