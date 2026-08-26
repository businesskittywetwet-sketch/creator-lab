import { fetchJson, withRetry, NetworkError } from "@/engine/http";

/* ------------------------------------------------------------------ */
/*  Story Judge provider adapters.                                     */
/*                                                                     */
/*  `openai` and `anthropic` call the real model APIs with a strict    */
/*  JSON contract. `heuristic` is a deterministic scoring algorithm    */
/*  over real story signals (engagement, source reliability, text      */
/*  features) — never a fake LLM response — used when no key exists.   */
/*  The chosen provider is recorded on every evaluation row.           */
/* ------------------------------------------------------------------ */

export type JudgeScores = {
  viralPotential: number;
  entertainmentValue: number;
  channelRelevance: number;
  visualPotential: number;
  originality: number;
  evergreenPotential: number;
  sourceReliability: number;
};

export type JudgeResult = JudgeScores & {
  overall: number;
  recommendation: "greenlight" | "review" | "reject";
  rationale: string;
  provider: string;
  model: string;
};

export type JudgeInput = {
  title: string;
  summary: string;
  url: string;
  sourceName: string;
  sourceReliability: number;
  signals: { score?: number; comments?: number; rank?: number };
  channel: {
    name: string;
    niche: string;
    targetAudience: string;
    voiceTone: string;
    preferredLength: string;
  } | null;
};

export interface JudgeProvider {
  key: string;
  model: string;
  evaluate(input: JudgeInput): Promise<JudgeResult>;
}

const WEIGHTS: Record<keyof JudgeScores, number> = {
  viralPotential: 0.22,
  entertainmentValue: 0.16,
  channelRelevance: 0.18,
  visualPotential: 0.12,
  originality: 0.12,
  evergreenPotential: 0.1,
  sourceReliability: 0.1,
};

export function computeOverall(scores: JudgeScores): number {
  let total = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    total += clampScore(scores[k as keyof JudgeScores]) * w;
  }
  return Math.round(total);
}

export function recommendationFor(overall: number, threshold = 72): JudgeResult["recommendation"] {
  if (overall >= threshold) return "greenlight";
  if (overall >= threshold - 18) return "review";
  return "reject";
}

function clampScore(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/* --------------------------- prompt contract ----------------------- */

const PROMPT_KEYS: Record<keyof JudgeScores, string> = {
  viralPotential: "viral_potential",
  entertainmentValue: "entertainment_value",
  channelRelevance: "channel_relevance",
  visualPotential: "visual_potential",
  originality: "originality",
  evergreenPotential: "evergreen_potential",
  sourceReliability: "source_reliability",
};

function buildPrompt(input: JudgeInput): string {
  const channelBlock = input.channel
    ? `Channel: ${input.channel.name}\nNiche: ${input.channel.niche}\nAudience: ${input.channel.targetAudience}\nVoice: ${input.channel.voiceTone}\nFormat: ${input.channel.preferredLength}`
    : "Channel: (unassigned — evaluate general entertainment-platform fit)";

  const signals = [
    input.signals.score != null ? `community_score=${input.signals.score}` : null,
    input.signals.comments != null ? `comments=${input.signals.comments}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return `You are the head of content acquisitions for a short-form entertainment video network. Evaluate this story candidate for adaptation into a video.

${channelBlock}

Story title: ${input.title}
Story summary: ${input.summary || "(no summary)"}
Source: ${input.sourceName} (operator-rated reliability ${input.sourceReliability}/100)
URL: ${input.url}
Engagement signals: ${signals || "none"}

Score each dimension 0-100 (integer). Be strict and realistic; most stories should land 40-75, exceptional ones above 80.
- viral_potential: likelihood of mass shares/completion in short-form feeds
- entertainment_value: inherent drama, surprise or delight of the core fact
- channel_relevance: fit with the channel niche, audience and voice (if unassigned, best-channel fit across entertainment brands)
- visual_potential: how well it can be visualised (archival footage, reenactment, motion graphics)
- originality: novelty — penalise saturated/rehashed topics
- evergreen_potential: shelf-life beyond this week's news cycle
- source_reliability: credibility of sourcing; penalise rumours and single-outlet gossip

Respond with ONLY a JSON object, no prose:
{"viral_potential":int,"entertainment_value":int,"channel_relevance":int,"visual_potential":int,"originality":int,"evergreen_potential":int,"source_reliability":int,"rationale":"one sentence, max 240 chars"}`;
}

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text
    .replace(/```(?:json)?/gi, "")
    .replace(/^[^{]*/, "")
    .replace(/[^}]*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new NetworkError("Judge returned unparseable JSON");
  }
}

function resultFromModel(
  raw: Record<string, unknown>,
  provider: string,
  model: string,
  threshold: number,
): JudgeResult {
  const scores = {} as JudgeScores;
  for (const [k, jsonKey] of Object.entries(PROMPT_KEYS)) {
    scores[k as keyof JudgeScores] = clampScore(raw[jsonKey]);
  }
  const overall = computeOverall(scores);
  const rationale =
    typeof raw.rationale === "string" ? raw.rationale.slice(0, 280) : "";
  return {
    ...scores,
    overall,
    recommendation: recommendationFor(overall, threshold),
    rationale,
    provider,
    model,
  };
}

/* ------------------------------ OpenAI ----------------------------- */

const openAIProvider: JudgeProvider = {
  key: "openai",
  model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  async evaluate(input) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new NetworkError("OPENAI_API_KEY missing");
    const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const run = () =>
      fetchJson<{ choices: { message: { content: string } }[] }>(
        `${base}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: buildPrompt(input) }],
            temperature: 0.2,
            max_tokens: 400,
            response_format: { type: "json_object" },
          }),
        },
        30_000,
      );
    const data = await withRetry(run, { retries: 2, baseDelayMs: 800, label: "openai-judge" });
    const content = data.choices?.[0]?.message?.content ?? "";
    return resultFromModel(extractJson(content), "openai", model, 72);
  },
};

/* ---------------------------- Anthropic ---------------------------- */

const anthropicProvider: JudgeProvider = {
  key: "anthropic",
  model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
  async evaluate(input) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new NetworkError("ANTHROPIC_API_KEY missing");
    const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
    const run = () =>
      fetchJson<{ content: { type: string; text: string }[] }>(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 400,
            temperature: 0.2,
            messages: [{ role: "user", content: buildPrompt(input) }],
          }),
        },
        30_000,
      );
    const data = await withRetry(run, { retries: 2, baseDelayMs: 800, label: "anthropic-judge" });
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";
    return resultFromModel(extractJson(text), "anthropic", model, 72);
  },
};

/* ---------------------------- heuristic ---------------------------- */

const VISUAL_TERMS = [
  "video", "footage", "caught on", "photo", "film", "scene", " documentary",
  "visual", "animation", "map", "lighthouse", "ship", "island", "mansion",
];
const VIRAL_TERMS = [
  "secret", "hidden", "banned", "never", "unsolved", "mystery", "found",
  "haunted", "lost", "forgotten", "bizarre", "strange", "shocking", "vanished",
  "code", "treasure", "easter egg", "twist", "true story", "cult", "escaped",
];
const EVERGREEN_BAD = ["box office", "opening weekend", "premiere", "trailer drop", "renewed", "cancelled", "weekend"];
const STALE_TERMS = ["announces", "statement", "press release", "reportedly", "rumour", "rumor"];

function termHits(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((acc, t) => acc + (lower.includes(t) ? 1 : 0), 0);
}

const heuristicProvider: JudgeProvider = {
  key: "heuristic",
  model: "signal-scoring-v1",
  async evaluate(input) {
    const text = `${input.title} ${input.summary}`;
    const engagement = input.signals.score ?? 0;
    const comments = input.signals.comments ?? 0;

    // engagement: log-scaled community traction (0-100)
    const traction =
      engagement > 0
        ? Math.min(96, 38 + Math.log1p(engagement) * 10 + Math.log1p(comments) * 6)
        : 46;

    const viral = Math.min(
      98,
      traction + termHits(text, VIRAL_TERMS) * 6 - (input.title.length > 150 ? 8 : 0),
    );
    const entertainment = Math.min(
      96,
      52 + termHits(text, VIRAL_TERMS) * 5 + Math.log1p(comments) * 4 - termHits(text, STALE_TERMS) * 7,
    );
    const relevanceBase = input.channel
      ? 58 +
        termHits(text, input.channel.niche.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 3)) * 9
      : 48;
    const visual = Math.min(95, 48 + termHits(text, VISUAL_TERMS) * 7);
    const originality = Math.max(
      22,
      Math.min(94, 62 + (input.summary.length > 140 ? 6 : 0) - termHits(text, STALE_TERMS) * 10),
    );
    const evergreen = Math.max(30, 74 - termHits(text, EVERGREEN_BAD) * 14);

    const scores: JudgeScores = {
      viralPotential: clampScore(viral),
      entertainmentValue: clampScore(entertainment),
      channelRelevance: clampScore(relevanceBase),
      visualPotential: clampScore(visual),
      originality: clampScore(originality),
      evergreenPotential: clampScore(evergreen),
      sourceReliability: clampScore(input.sourceReliability),
    };
    const overall = computeOverall(scores);
    return {
      ...scores,
      overall,
      recommendation: recommendationFor(overall, 72),
      rationale: `Signal-based evaluation: traction ${traction.toFixed(0)}, ${termHits(text, VIRAL_TERMS)} high-virality markers, source rated ${input.sourceReliability}/100.`,
      provider: "heuristic",
      model: "signal-scoring-v1",
    };
  },
};

/* ----------------------------- resolver ---------------------------- */

const JUDGE_REGISTRY: Record<string, JudgeProvider> = {
  openai: openAIProvider,
  anthropic: anthropicProvider,
  heuristic: heuristicProvider,
};

export function resolveJudgeProvider(): JudgeProvider {
  const wanted =
    process.env.JUDGE_PROVIDER ??
    (process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : process.env.OPENAI_API_KEY
        ? "openai"
        : "heuristic");
  const provider = JUDGE_REGISTRY[wanted];
  if (!provider) {
    console.warn(`[judge] provider "${wanted}" not registered — falling back to heuristic`);
    return heuristicProvider;
  }
  // demand credentials for AI providers
  if (wanted === "openai" && !process.env.OPENAI_API_KEY) return heuristicProvider;
  if (wanted === "anthropic" && !process.env.ANTHROPIC_API_KEY) return heuristicProvider;
  return provider;
}

export function judgeProviderLabel(): string {
  const p = resolveJudgeProvider();
  return `${p.key} · ${p.model}`;
}
