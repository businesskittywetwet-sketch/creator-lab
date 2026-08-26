import {
  asArray,
  asNumber,
  asString,
  asStringList,
  callModelJson,
  hasModelCredentials,
  resolveModel,
} from "./ai-client";
import type { GenerationMode } from "./media";
import type { ScriptSection, VisualShot } from "@/db/schema";

/* ------------------------------------------------------------------ */
/*  Production step services.                                          */
/*                                                                     */
/*  Each step has two implementations:                                 */
/*   • model — a real OpenAI/Anthropic call with a strict JSON schema  */
/*   • composer — deterministic construction from the story text and   */
/*     the channel's production settings                               */
/*                                                                     */
/*  Every result is tagged `real_ai` or `fallback` so the UI can never */
/*  present deterministic output as AI-generated. Failures surface as  */
/*  `failed` rather than silently degrading.                           */
/* ------------------------------------------------------------------ */

export type ProductionSettings = {
  format: string;
  targetDurationSec: number;
  scriptWordTarget: number;
  tone: string;
  hookStyle: string;
  ctaStyle: string;
  visualStyle: string;
  narrationVoice: string;
  researchDepth: number;
  sectionCount: number;
  writingStyle: string;
  pacing: string;
  minWordCount: number;
  maxWordCount: number;
  language: string;
  captionStyle: string;
  wordsPerCue: number;
  speakingRate: number;
  musicCue: string;
};

export type StepContext = {
  story: { title: string; summary: string; sourceName: string; sourceUrl: string };
  channel: { name: string; niche: string; targetAudience: string; voiceTone: string };
  settings: ProductionSettings;
  prior: Record<string, Record<string, unknown>>;
  /** operator feedback when this run is a revision */
  revisionNote?: string;
};

export type StepOutput = {
  output: Record<string, unknown>;
  provider: string;
  mode: GenerationMode;
  usage?: { promptTokens: number; completionTokens: number; costMicroUsd: number };
};

/* ---------------------------- text utils --------------------------- */

function isMetadataText(text: string): boolean {
  return /\d+\s*(points|upvotes|comments)\b/i.test(text) || text.trim().length < 40;
}
function prose(ctx: StepContext): string {
  return isMetadataText(ctx.story.summary) ? "" : ctx.story.summary;
}
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 24 && !isMetadataText(s));
}
function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
function titleCore(title: string): string {
  return title.replace(/\s+[-–—|]\s+[^-–—|]+$/, "").trim();
}
function keyPhrase(title: string): string {
  const core = titleCore(title);
  return core.length > 90 ? `${core.slice(0, 87)}…` : core;
}
/** crude but useful entity extraction for the deterministic path */
function extractEntities(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2}\b/g) ?? [];
  const stop = new Set(["The", "This", "That", "These", "Here", "There", "When", "What", "Why"]);
  return Array.from(new Set(matches.filter((m) => !stop.has(m)))).slice(0, 10);
}
function extractDates(text: string): string[] {
  const years = text.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) ?? [];
  const months =
    text.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(,\s*\d{4})?\b/g,
    ) ?? [];
  return Array.from(new Set([...months, ...years])).slice(0, 8);
}

/* ------------------------------------------------------------------ */
/*  1. Research — source-backed, structured                            */
/* ------------------------------------------------------------------ */

function composeResearch(ctx: StepContext): Record<string, unknown> {
  const core = titleCore(ctx.story.title);
  const body = prose(ctx);
  const facts = sentences(body);
  const depth = Math.max(3, ctx.settings.researchDepth);
  const entities = extractEntities(`${ctx.story.title} ${body}`);
  const dates = extractDates(`${ctx.story.title} ${body}`);

  const keyFacts = facts.slice(0, depth).map((f) => ({
    fact: f,
    sourceUrl: ctx.story.sourceUrl,
    sourceTitle: ctx.story.sourceName,
    confidence: 55,
  }));

  const claims = [
    { claim: `Core premise: ${core}`, needsVerification: true, importance: "critical" },
    ...facts.slice(0, 3).map((f) => ({
      claim: f,
      needsVerification: true,
      importance: "supporting" as const,
    })),
  ];

  return {
    topic: core,
    summary: body
      ? `${core}. ${facts.slice(0, 2).join(" ")}`.slice(0, 600)
      : `${core}. No source prose was available beyond the headline; all narrative detail must be researched before recording.`,
    keyFacts,
    entities,
    dates,
    claims,
    sources: [
      { title: ctx.story.sourceName || "Primary source", url: ctx.story.sourceUrl, reliability: 60 },
    ],
    cautions: body
      ? ["Single-source origin — corroborate specifics before asserting them on camera"]
      : ["No usable source prose: headline only. Treat every specific as unverified."],
    openQuestions: [
      `What primary documentation exists for "${core}"?`,
      "Are there conflicting accounts in contemporary reporting?",
    ],
    confidence: body ? 55 : 25,
    sourcedFactCount: keyFacts.length,
  };
}

async function modelResearch(ctx: StepContext): Promise<Record<string, unknown>> {
  const prompt = `You are a research agent for a short-form entertainment video channel. Produce a rigorous, source-aware brief.

Channel: ${ctx.channel.name} — ${ctx.channel.niche}
Audience: ${ctx.channel.targetAudience}
Story title: ${ctx.story.title}
Story summary: ${ctx.story.summary || "(headline only — no body text available)"}
Known source: ${ctx.story.sourceName} (${ctx.story.sourceUrl})

Rules:
- Produce ${ctx.settings.researchDepth} key facts. Attach the source you believe supports each.
- Extract named entities and important dates that actually appear or are strongly implied.
- List claims that REQUIRE verification, marking importance as "critical" or "supporting".
- Do NOT invent statistics, dates, quotes or URLs. If you are not confident, put it in claims/openQuestions instead of keyFacts.
- confidence is your 0-100 confidence in the overall brief.

Respond with ONLY JSON:
{"topic":string,"summary":string,"keyFacts":[{"fact":string,"sourceUrl":string,"sourceTitle":string,"confidence":int}],
"entities":[string],"dates":[string],"claims":[{"claim":string,"needsVerification":boolean,"importance":string}],
"sources":[{"title":string,"url":string,"reliability":int}],"cautions":[string],"openQuestions":[string],"confidence":int}`;
  const { data } = await callModelJson(prompt, { label: "research", maxTokens: 1800 });
  const keyFacts = asArray(data.keyFacts)
    .map((f) => {
      const o = f as Record<string, unknown>;
      return {
        fact: asString(o?.fact),
        sourceUrl: asString(o?.sourceUrl, ctx.story.sourceUrl),
        sourceTitle: asString(o?.sourceTitle, ctx.story.sourceName),
        confidence: Math.max(0, Math.min(100, asNumber(o?.confidence, 50))),
      };
    })
    .filter((f) => f.fact)
    .slice(0, 12);
  return {
    topic: asString(data.topic, titleCore(ctx.story.title)),
    summary: asString(data.summary),
    keyFacts,
    entities: asStringList(data.entities, 12),
    dates: asStringList(data.dates, 10),
    claims: asArray(data.claims)
      .map((c) => {
        const o = c as Record<string, unknown>;
        return {
          claim: asString(o?.claim),
          needsVerification: o?.needsVerification !== false,
          importance: asString(o?.importance, "supporting"),
        };
      })
      .filter((c) => c.claim)
      .slice(0, 12),
    sources: asArray(data.sources)
      .map((s) => {
        const o = s as Record<string, unknown>;
        return {
          title: asString(o?.title),
          url: asString(o?.url),
          reliability: Math.max(0, Math.min(100, asNumber(o?.reliability, 60))),
        };
      })
      .filter((s) => s.title || s.url)
      .slice(0, 10),
    cautions: asStringList(data.cautions, 8),
    openQuestions: asStringList(data.openQuestions, 8),
    confidence: Math.max(0, Math.min(100, asNumber(data.confidence, 60))),
    sourcedFactCount: keyFacts.filter((f) => f.sourceUrl).length,
  };
}

/* ------------------------------------------------------------------ */
/*  2. Fact check — per-claim verdicts with gating                     */
/* ------------------------------------------------------------------ */

type Verdict = {
  claim: string;
  importance: string;
  supported: boolean;
  verdict: string;
  confidence: number;
  sources: { title: string; url: string }[];
  note: string;
};

function gate(verdicts: Verdict[]): { passed: boolean; blocking: string[] } {
  const blocking = verdicts
    .filter((v) => v.importance === "critical" && (!v.supported || v.confidence < 50))
    .map((v) => v.claim);
  return { passed: blocking.length === 0, blocking };
}

function composeFactCheck(ctx: StepContext): Record<string, unknown> {
  const research = ctx.prior.research ?? {};
  const claims = asArray(research.claims) as { claim?: string; importance?: string }[];
  const sources = asArray(research.sources) as { title?: string; url?: string }[];
  const researchConfidence = asNumber(research.confidence, 40);

  const verdicts: Verdict[] = claims.map((c) => {
    // Deterministic checker cannot browse: it can only report that a claim
    // is unverified. Critical claims therefore fail the gate honestly.
    const importance = asString(c.importance, "supporting");
    return {
      claim: asString(c.claim),
      importance,
      supported: false,
      verdict: "unverified",
      confidence: Math.min(45, researchConfidence),
      sources: sources.slice(0, 1).map((s) => ({ title: asString(s.title), url: asString(s.url) })),
      note: "No automated verification available without an AI/search provider — requires manual review",
    };
  });

  const g = gate(verdicts);
  return {
    claimsChecked: verdicts.length,
    verified: verdicts.filter((v) => v.supported).length,
    unsupported: verdicts.filter((v) => !v.supported).length,
    verdicts,
    flagged: verdicts.filter((v) => !v.supported).map((v) => ({ claim: v.claim, note: v.note })),
    passed: g.passed,
    blockingClaims: g.blocking,
    confidence: Math.min(45, researchConfidence),
    method: "Deterministic gate — claims marked unverified pending a research/AI provider",
  };
}

async function modelFactCheck(ctx: StepContext): Promise<Record<string, unknown>> {
  const research = ctx.prior.research ?? {};
  const prompt = `You are a fact-checker for a documentary-style video channel. Assess each claim individually.

Story: ${ctx.story.title}
Summary: ${ctx.story.summary}
Source: ${ctx.story.sourceName} (${ctx.story.sourceUrl})
Research brief: ${JSON.stringify({
    keyFacts: research.keyFacts,
    claims: research.claims,
    sources: research.sources,
  }).slice(0, 4000)}

For each claim decide:
- supported: true only if the claim is well-established or directly supported by the cited source
- verdict: "supported" | "partially-supported" | "unverified" | "contradicted"
- confidence: 0-100
- sources: the specific supporting sources you are relying on (do not invent URLs; reuse provided ones or leave empty)
- importance: "critical" if the video's premise collapses without it, else "supporting"

Be conservative — mark unverified rather than guessing.

Respond with ONLY JSON:
{"verdicts":[{"claim":string,"importance":string,"supported":boolean,"verdict":string,"confidence":int,"sources":[{"title":string,"url":string}],"note":string}],"confidence":int,"method":string}`;
  const { data } = await callModelJson(prompt, { label: "fact_check", maxTokens: 2000, temperature: 0.2 });
  const verdicts: Verdict[] = asArray(data.verdicts)
    .map((v) => {
      const o = v as Record<string, unknown>;
      return {
        claim: asString(o?.claim),
        importance: asString(o?.importance, "supporting"),
        supported: o?.supported === true,
        verdict: asString(o?.verdict, "unverified"),
        confidence: Math.max(0, Math.min(100, asNumber(o?.confidence, 50))),
        sources: asArray(o?.sources)
          .map((s) => {
            const so = s as Record<string, unknown>;
            return { title: asString(so?.title), url: asString(so?.url) };
          })
          .filter((s) => s.title || s.url),
        note: asString(o?.note),
      };
    })
    .filter((v) => v.claim);
  const g = gate(verdicts);
  return {
    claimsChecked: verdicts.length,
    verified: verdicts.filter((v) => v.supported).length,
    unsupported: verdicts.filter((v) => !v.supported).length,
    verdicts,
    flagged: verdicts.filter((v) => !v.supported).map((v) => ({ claim: v.claim, note: v.note || v.verdict })),
    passed: g.passed,
    blockingClaims: g.blocking,
    confidence: Math.max(0, Math.min(100, asNumber(data.confidence, 60))),
    method: asString(data.method, "Model-based per-claim verification"),
  };
}

/* ------------------------------------------------------------------ */
/*  3. Concept — multiple scored angles, strongest selected            */
/* ------------------------------------------------------------------ */

type Concept = {
  style: string;
  hook: string;
  angle: string;
  keyBeats: string[];
  scores: {
    hookStrength: number;
    retention: number;
    accuracy: number;
    originality: number;
    visualPotential: number;
    nicheRelevance: number;
  };
  total: number;
};

const CONCEPT_WEIGHTS = {
  hookStrength: 0.25,
  retention: 0.2,
  accuracy: 0.2,
  originality: 0.13,
  visualPotential: 0.12,
  nicheRelevance: 0.1,
};

function scoreConcept(c: Omit<Concept, "total">): number {
  let t = 0;
  for (const [k, w] of Object.entries(CONCEPT_WEIGHTS)) {
    t += (c.scores[k as keyof Concept["scores"]] ?? 0) * w;
  }
  return Math.round(t);
}

function composeConcept(ctx: StepContext): Record<string, unknown> {
  const core = keyPhrase(ctx.story.title);
  const lead = sentences(prose(ctx))[0];
  const fc = ctx.prior.fact_check ?? {};
  const accuracyCeiling = fc.passed === false ? 45 : 70;

  const variants: Omit<Concept, "total">[] = [
    {
      style: "curiosity",
      hook: lead ? `${lead.replace(/\.$/, "")} — and the reason why is stranger.` : `${core}. The reason why is stranger than the story.`,
      angle: "Open a loop the viewer needs closed",
      keyBeats: ["Open the loop", "Raise the stakes", "Close the loop", "Land the meaning"],
      scores: { hookStrength: 70, retention: 72, accuracy: accuracyCeiling, originality: 58, visualPotential: 60, nicheRelevance: 72 },
    },
    {
      style: "question",
      hook: `What actually happened with ${core.toLowerCase()}?`,
      angle: "Pose the question the audience already half-asked",
      keyBeats: ["Ask the question", "Establish context", "Reveal the answer", "Complicate it"],
      scores: { hookStrength: 62, retention: 64, accuracy: accuracyCeiling, originality: 50, visualPotential: 56, nicheRelevance: 70 },
    },
    {
      style: "storytelling",
      hook: lead ? `${lead.replace(/\.$/, "")}.` : `${core}.`,
      angle: "Narrative cold open, chronological build",
      keyBeats: ["Scene-set", "Inciting detail", "Turn", "Resolution"],
      scores: { hookStrength: 58, retention: 68, accuracy: Math.min(accuracyCeiling + 8, 80), originality: 55, visualPotential: 66, nicheRelevance: 68 },
    },
    {
      style: "contrarian",
      hook: `Most people get ${core.toLowerCase()} completely backwards.`,
      angle: "Correct a widely held misreading",
      keyBeats: ["State the myth", "Show the evidence", "Correct it", "Why it persists"],
      scores: { hookStrength: 68, retention: 66, accuracy: Math.max(30, accuracyCeiling - 12), originality: 64, visualPotential: 54, nicheRelevance: 66 },
    },
  ];

  const scored: Concept[] = variants.map((v) => ({ ...v, total: scoreConcept(v) }));
  // honour the channel's configured hook style when it is competitive
  const preferred = scored.find((c) => ctx.settings.hookStyle.toLowerCase().includes(c.style));
  const best =
    preferred && preferred.total >= Math.max(...scored.map((s) => s.total)) - 4
      ? preferred
      : scored.reduce((a, b) => (b.total > a.total ? b : a));

  return {
    concepts: scored,
    selected: best,
    angle: best.angle,
    workingTitle: core,
    hook: best.hook,
    hookStyle: best.style,
    keyBeats: best.keyBeats,
    selectionReason: `Highest weighted score (${best.total}) across hook strength, retention and accuracy.`,
    audiencePromise: `${ctx.channel.targetAudience} get the full story in under ${ctx.settings.targetDurationSec}s.`,
  };
}

async function modelConcept(ctx: StepContext): Promise<Record<string, unknown>> {
  const fc = ctx.prior.fact_check ?? {};
  const research = ctx.prior.research ?? {};
  const prompt = `You are a content strategist for "${ctx.channel.name}". Generate MULTIPLE distinct concepts, score them, then pick the best.

Niche: ${ctx.channel.niche}
Audience: ${ctx.channel.targetAudience}
Tone: ${ctx.settings.tone}
Writing style: ${ctx.settings.writingStyle}
Preferred hook style: ${ctx.settings.hookStyle}
Format: ${ctx.settings.format}, ${ctx.settings.targetDurationSec}s
Story: ${ctx.story.title}
Summary: ${ctx.story.summary}
Verified research: ${JSON.stringify(research.keyFacts ?? []).slice(0, 2500)}
Fact-check verdicts: ${JSON.stringify(fc.verdicts ?? []).slice(0, 2000)}
Claims you MUST NOT assert as fact: ${JSON.stringify(fc.blockingClaims ?? [])}
${ctx.revisionNote ? `\nOPERATOR REVISION REQUEST — address this directly: "${ctx.revisionNote}"` : ""}

Generate 4-5 concepts using distinct styles (curiosity, shock, question, storytelling, contrarian). Avoid cheap clickbait and never promise something the research does not support.
Score each 0-100 on hookStrength, retention, accuracy, originality, visualPotential, nicheRelevance.
Then select the strongest overall for this specific channel.

Respond with ONLY JSON:
{"concepts":[{"style":string,"hook":string,"angle":string,"keyBeats":[string],"scores":{"hookStrength":int,"retention":int,"accuracy":int,"originality":int,"visualPotential":int,"nicheRelevance":int}}],
"selectedStyle":string,"selectionReason":string,"workingTitle":string,"audiencePromise":string}`;
  const { data } = await callModelJson(prompt, { label: "concept", maxTokens: 2200, temperature: 0.8 });
  const concepts: Concept[] = asArray(data.concepts)
    .map((c) => {
      const o = c as Record<string, unknown>;
      const s = (o?.scores ?? {}) as Record<string, unknown>;
      const base = {
        style: asString(o?.style, "curiosity"),
        hook: asString(o?.hook),
        angle: asString(o?.angle),
        keyBeats: asStringList(o?.keyBeats, 8),
        scores: {
          hookStrength: Math.max(0, Math.min(100, asNumber(s.hookStrength, 50))),
          retention: Math.max(0, Math.min(100, asNumber(s.retention, 50))),
          accuracy: Math.max(0, Math.min(100, asNumber(s.accuracy, 50))),
          originality: Math.max(0, Math.min(100, asNumber(s.originality, 50))),
          visualPotential: Math.max(0, Math.min(100, asNumber(s.visualPotential, 50))),
          nicheRelevance: Math.max(0, Math.min(100, asNumber(s.nicheRelevance, 50))),
        },
      };
      return { ...base, total: scoreConcept(base) };
    })
    .filter((c) => c.hook);
  if (concepts.length === 0) throw new Error("concept step returned no usable concepts");

  const chosenStyle = asString(data.selectedStyle);
  const best =
    concepts.find((c) => c.style === chosenStyle) ??
    concepts.reduce((a, b) => (b.total > a.total ? b : a));

  return {
    concepts,
    selected: best,
    angle: best.angle,
    workingTitle: asString(data.workingTitle, titleCore(ctx.story.title)),
    hook: best.hook,
    hookStyle: best.style,
    keyBeats: best.keyBeats,
    selectionReason: asString(data.selectionReason, `Highest weighted score (${best.total}).`),
    audiencePromise: asString(data.audiencePromise),
  };
}

/* ------------------------------------------------------------------ */
/*  4. Script — structured, timed, word-bounded                        */
/* ------------------------------------------------------------------ */

const STRUCTURE = ["HOOK", "SETUP", "DEVELOPMENT", "PAYOFF", "CTA"];

function structureFor(sectionCount: number): string[] {
  if (sectionCount <= 3) return ["HOOK", "DEVELOPMENT", "CTA"];
  if (sectionCount === 4) return ["HOOK", "SETUP", "PAYOFF", "CTA"];
  const mid = Array.from({ length: sectionCount - 4 }, (_, i) => `DEVELOPMENT ${i + 2}`);
  return ["HOOK", "SETUP", "DEVELOPMENT", ...mid, "PAYOFF", "CTA"];
}

function timeSections(sections: ScriptSection[], targetSec: number, wpm: number): ScriptSection[] {
  const totalWords = sections.reduce((a, s) => a + words(s.narration), 0) || 1;
  return sections.map((s) => {
    const share = words(s.narration) / totalWords;
    const byRate = (words(s.narration) / wpm) * 60;
    // blend proportional share of target with the natural read time
    const dur = Math.max(1.5, Math.round(((share * targetSec + byRate) / 2) * 10) / 10);
    return { ...s, durationSec: dur };
  });
}

function composeScript(ctx: StepContext): Record<string, unknown> {
  const concept = ctx.prior.concept ?? {};
  const research = ctx.prior.research ?? {};
  const hook = asString(concept.hook, keyPhrase(ctx.story.title));
  const beats = asStringList(concept.keyBeats, 8);
  const factObjs = asArray(research.keyFacts) as { fact?: string }[];
  const pool = [
    ...sentences(prose(ctx)),
    ...factObjs.map((f) => asString(f.fact)).filter(Boolean),
  ].filter((s) => s && !isMetadataText(s));

  const labels = structureFor(Math.max(3, Math.min(8, ctx.settings.sectionCount)));
  const sections: ScriptSection[] = labels.map((label, i) => {
    let narration: string;
    if (label === "HOOK") narration = hook;
    else if (label === "CTA") narration = ctx.settings.ctaStyle;
    else if (pool.length > 0) narration = pool[(i - 1) % pool.length];
    else
      narration = `[NEEDS SOURCE] ${beats[i] ?? label}: expand "${titleCore(ctx.story.title)}" with verified research before recording.`;
    return { heading: label, narration, durationSec: 0 };
  });

  const timed = timeSections(sections, ctx.settings.targetDurationSec, ctx.settings.speakingRate);
  const body = timed.map((s) => s.narration).join("\n\n");
  const wordCount = words(body);
  return {
    sections: timed,
    structure: labels,
    hook,
    cta: ctx.settings.ctaStyle,
    scriptBody: body,
    wordCount,
    estimatedDurationSec: Math.round(timed.reduce((a, s) => a + s.durationSec, 0)),
    withinWordBounds: wordCount >= ctx.settings.minWordCount && wordCount <= ctx.settings.maxWordCount,
  };
}

async function modelScript(ctx: StepContext): Promise<Record<string, unknown>> {
  const concept = ctx.prior.concept ?? {};
  const fc = ctx.prior.fact_check ?? {};
  const research = ctx.prior.research ?? {};
  const labels = structureFor(Math.max(3, Math.min(8, ctx.settings.sectionCount)));
  const prompt = `You are the scriptwriter for "${ctx.channel.name}". Write spoken narration only — no camera directions.

Tone: ${ctx.settings.tone}
Writing style: ${ctx.settings.writingStyle}
Audience: ${ctx.channel.targetAudience}
Pacing: ${ctx.settings.pacing} (speaking rate ~${ctx.settings.speakingRate} wpm)
Format: ${ctx.settings.format}, target ${ctx.settings.targetDurationSec}s
Word count: between ${ctx.settings.minWordCount} and ${ctx.settings.maxWordCount} words TOTAL (target ~${ctx.settings.scriptWordTarget})
Language: ${ctx.settings.language}
Required section structure, in order: ${labels.join(" → ")}
CTA behaviour: ${ctx.settings.ctaStyle}

Story: ${ctx.story.title}
Approved hook: ${asString(concept.hook)}
Angle: ${asString(concept.angle)}
Key beats: ${JSON.stringify(concept.keyBeats ?? [])}
Verified facts you MAY assert: ${JSON.stringify(research.keyFacts ?? []).slice(0, 2500)}
Claims you MUST NOT assert as fact: ${JSON.stringify(fc.blockingClaims ?? [])}
${ctx.revisionNote ? `\nOPERATOR REVISION REQUEST — address this directly: "${ctx.revisionNote}"` : ""}

Section 1 must be the hook and must land within ~1.5 seconds of speech. Vary sentence length. No filler.
Set durationSec per section so the total matches the target duration.

Respond with ONLY JSON:
{"sections":[{"heading":string,"narration":string,"durationSec":number}],"cta":string,"wordCount":int,"estimatedDurationSec":int}`;
  const { data } = await callModelJson(prompt, { label: "script", maxTokens: 2600, temperature: 0.75 });
  let sections: ScriptSection[] = asArray(data.sections)
    .map((s) => {
      const o = s as Record<string, unknown>;
      return {
        heading: asString(o?.heading, "SECTION"),
        narration: asString(o?.narration),
        durationSec: Math.max(1, asNumber(o?.durationSec, 6)),
      };
    })
    .filter((s) => s.narration);
  if (sections.length === 0) throw new Error("script step returned no usable sections");
  sections = timeSections(sections, ctx.settings.targetDurationSec, ctx.settings.speakingRate);
  const body = sections.map((s) => s.narration).join("\n\n");
  const wordCount = words(body);
  return {
    sections,
    structure: sections.map((s) => s.heading),
    hook: sections[0]?.narration ?? asString(concept.hook),
    cta: asString(data.cta, ctx.settings.ctaStyle),
    scriptBody: body,
    wordCount,
    estimatedDurationSec: Math.round(sections.reduce((a, s) => a + s.durationSec, 0)),
    withinWordBounds: wordCount >= ctx.settings.minWordCount && wordCount <= ctx.settings.maxWordCount,
  };
}

/* ------------------------------------------------------------------ */
/*  5. Visual plan — shot-by-shot, matched to narration                */
/* ------------------------------------------------------------------ */

function composeVisualPlan(ctx: StepContext): Record<string, unknown> {
  const sections = (asArray((ctx.prior.script ?? {}).sections) as ScriptSection[]) ?? [];
  const entities = asStringList((ctx.prior.research ?? {}).entities, 10);
  const aspect = ctx.settings.format === "Long-form" ? "16:9" : "9:16";
  const shots: VisualShot[] = sections.map((s, i) => {
    const subject = entities[i % Math.max(1, entities.length)] ?? titleCore(ctx.story.title);
    const key = s.narration.replace(/^\[NEEDS SOURCE\]\s*/, "").slice(0, 110);
    return {
      section: s.heading,
      description: `${ctx.settings.visualStyle}. Scene ${i + 1} illustrates: ${key}`,
      assetType: i === 0 ? "cold-open archival" : i % 2 === 0 ? "archival footage" : "motion graphic",
      overlayText: (s.heading === "HOOK" ? key : s.heading).slice(0, 42),
    };
  });
  return {
    shots: shots.map((s, i) => ({
      ...s,
      sceneNumber: i + 1,
      narrationSegment: sections[i]?.narration ?? "",
      durationSec: sections[i]?.durationSec ?? 5,
      imageRequirement: s.assetType,
      aiPrompt: `${ctx.settings.visualStyle}; ${s.description}; cinematic, high contrast, no text`,
      transition: i === 0 ? "cut" : "hard cut on beat",
      aspectRatio: aspect,
    })),
    styleGuide: ctx.settings.visualStyle,
    aspectRatio: aspect,
    thumbnailPrompt: `${ctx.settings.visualStyle}; subject from "${titleCore(ctx.story.title)}"; bold caption; high contrast`,
  };
}

async function modelVisualPlan(ctx: StepContext): Promise<Record<string, unknown>> {
  const sections = (asArray((ctx.prior.script ?? {}).sections) as ScriptSection[]) ?? [];
  const aspect = ctx.settings.format === "Long-form" ? "16:9" : "9:16";
  const prompt = `You are the visual director for "${ctx.channel.name}".

Visual style: ${ctx.settings.visualStyle}
Aspect ratio: ${aspect}
Entities in the story: ${JSON.stringify(asStringList((ctx.prior.research ?? {}).entities, 10))}
Script sections (in order): ${JSON.stringify(sections.map((s, i) => ({ scene: i + 1, heading: s.heading, narration: s.narration, durationSec: s.durationSec })))}
${ctx.revisionNote ? `\nOPERATOR REVISION REQUEST — address this directly: "${ctx.revisionNote}"` : ""}

For EACH scene produce a shot that specifically depicts what that narration segment says — not generic filler.
aiPrompt must be a standalone image-generation prompt (no on-screen text in the image).
overlayText: max 42 chars, suitable for burned-in vertical captions.

Respond with ONLY JSON:
{"shots":[{"sceneNumber":int,"section":string,"narrationSegment":string,"durationSec":number,"description":string,"assetType":string,"imageRequirement":string,"aiPrompt":string,"overlayText":string,"transition":string}],
"styleGuide":string,"aspectRatio":string,"thumbnailPrompt":string}`;
  const { data } = await callModelJson(prompt, { label: "visual_plan", maxTokens: 2600 });
  const shots = asArray(data.shots)
    .map((s, i) => {
      const o = s as Record<string, unknown>;
      return {
        sceneNumber: asNumber(o?.sceneNumber, i + 1),
        section: asString(o?.section, sections[i]?.heading ?? "SCENE"),
        narrationSegment: asString(o?.narrationSegment, sections[i]?.narration ?? ""),
        durationSec: asNumber(o?.durationSec, sections[i]?.durationSec ?? 5),
        description: asString(o?.description),
        assetType: asString(o?.assetType, "archival footage"),
        imageRequirement: asString(o?.imageRequirement, "image"),
        aiPrompt: asString(o?.aiPrompt),
        overlayText: asString(o?.overlayText).slice(0, 42),
        transition: asString(o?.transition, "hard cut"),
        aspectRatio: asString(data.aspectRatio, aspect),
      };
    })
    .filter((s) => s.description || s.aiPrompt);
  if (shots.length === 0) throw new Error("visual plan returned no shots");
  return {
    shots,
    styleGuide: asString(data.styleGuide, ctx.settings.visualStyle),
    aspectRatio: asString(data.aspectRatio, aspect),
    thumbnailPrompt: asString(data.thumbnailPrompt),
  };
}

/* ------------------------------------------------------------------ */
/*  Quality control — evaluates the actual produced content            */
/* ------------------------------------------------------------------ */

export type QcInput = {
  ctx: StepContext;
  assets: { images: number; imagesExpected: number; audio: boolean; captions: boolean; video: boolean };
};

export function evaluateQuality(input: QcInput): Record<string, unknown> {
  const { ctx, assets } = input;
  const script = ctx.prior.script ?? {};
  const fc = ctx.prior.fact_check ?? {};
  const research = ctx.prior.research ?? {};
  const visual = ctx.prior.visual_plan ?? {};
  const sections = (asArray(script.sections) as ScriptSection[]) ?? [];
  const findings: { severity: string; area: string; note: string }[] = [];

  // --- factual accuracy ---
  const blocking = asStringList(fc.blockingClaims, 20);
  if (blocking.length) {
    findings.push({
      severity: "critical",
      area: "accuracy",
      note: `${blocking.length} critical claim(s) unsupported by fact-check: "${blocking[0].slice(0, 90)}"`,
    });
  }
  const gaps = sections.filter((s) => s.narration.includes("[NEEDS SOURCE]")).length;
  if (gaps) {
    findings.push({
      severity: "critical",
      area: "accuracy",
      note: `${gaps} script section(s) are unwritten placeholders marked [NEEDS SOURCE]`,
    });
  }
  if (asNumber(research.confidence, 0) < 40) {
    findings.push({ severity: "warning", area: "accuracy", note: `Research confidence is low (${asNumber(research.confidence, 0)}/100)` });
  }

  // --- script quality ---
  const wc = asNumber(script.wordCount, 0);
  if (wc < ctx.settings.minWordCount)
    findings.push({ severity: "warning", area: "script", note: `Script is short: ${wc}w < min ${ctx.settings.minWordCount}w` });
  if (wc > ctx.settings.maxWordCount)
    findings.push({ severity: "warning", area: "script", note: `Script is long: ${wc}w > max ${ctx.settings.maxWordCount}w` });

  const hook = asString(script.hook);
  if (!hook) findings.push({ severity: "critical", area: "hook", note: "No hook present" });
  else if (words(hook) > 24)
    findings.push({ severity: "warning", area: "hook", note: `Hook is ${words(hook)} words — trim for a 1.5s open` });

  // --- pacing ---
  const est = asNumber(script.estimatedDurationSec, 0);
  const drift = ctx.settings.targetDurationSec ? Math.abs(est - ctx.settings.targetDurationSec) / ctx.settings.targetDurationSec : 0;
  if (drift > 0.35)
    findings.push({ severity: "warning", area: "pacing", note: `Runtime ${est}s drifts ${Math.round(drift * 100)}% from ${ctx.settings.targetDurationSec}s target` });

  // --- duplicate / repetitive content ---
  const norm = sections.map((s) => s.narration.toLowerCase().replace(/\W+/g, " ").trim());
  const dupes = norm.length - new Set(norm).size;
  if (dupes > 0)
    findings.push({ severity: "warning", area: "originality", note: `${dupes} duplicated script section(s) detected` });

  // --- visual/script sync ---
  const shots = asArray(visual.shots);
  if (shots.length && sections.length && shots.length !== sections.length)
    findings.push({ severity: "warning", area: "sync", note: `Shot count (${shots.length}) does not match script sections (${sections.length})` });

  // --- assets ---
  if (assets.imagesExpected > 0 && assets.images < assets.imagesExpected)
    findings.push({
      severity: "critical",
      area: "assets",
      note: `Missing visual assets: ${assets.images}/${assets.imagesExpected} scenes rendered`,
    });
  if (!assets.audio)
    findings.push({ severity: "warning", area: "audio", note: "No narration audio available (TTS provider not configured)" });
  if (!assets.captions)
    findings.push({ severity: "warning", area: "captions", note: "No caption track generated" });
  if (!assets.video)
    findings.push({ severity: "critical", area: "video", note: "No playable video file was produced" });

  // --- niche / brand ---
  const nicheTerms = ctx.channel.niche.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 4);
  const blob = `${hook} ${sections.map((s) => s.narration).join(" ")}`.toLowerCase();
  const nicheHits = nicheTerms.filter((t) => blob.includes(t)).length;
  if (nicheTerms.length && nicheHits === 0)
    findings.push({ severity: "info", area: "niche", note: "Script does not surface any channel niche keywords" });

  const penalty = findings.reduce(
    (a, f) => a + (f.severity === "critical" ? 26 : f.severity === "warning" ? 8 : 3),
    0,
  );
  const base = 62 + asNumber(fc.confidence, 40) * 0.22 + (assets.video ? 10 : 0) + (assets.audio ? 6 : 0);
  const score = Math.max(5, Math.min(98, Math.round(base - penalty)));
  const criticals = findings.filter((f) => f.severity === "critical");

  return {
    score,
    findings,
    criticalCount: criticals.length,
    // A critical finding blocks automatic approval outright.
    passed: criticals.length === 0 && score >= 60,
    blocksApproval: criticals.length > 0,
    retentionRisk: drift > 0.4 || gaps > 0 ? "elevated" : "normal",
    checkedAt: new Date().toISOString(),
    evaluated: {
      sections: sections.length,
      words: wc,
      shots: shots.length,
      images: `${assets.images}/${assets.imagesExpected}`,
      audio: assets.audio,
      captions: assets.captions,
      video: assets.video,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Narration + assembly plans (metadata; real media in engine)        */
/* ------------------------------------------------------------------ */

export function composeNarrationPlan(ctx: StepContext): Record<string, unknown> {
  const sections = (asArray((ctx.prior.script ?? {}).sections) as ScriptSection[]) ?? [];
  return {
    voice: ctx.settings.narrationVoice,
    tone: ctx.settings.tone,
    language: ctx.settings.language,
    speakingRate: ctx.settings.speakingRate,
    style: ctx.settings.pacing,
    sectionDirections: sections.map((s, i) => ({
      section: s.heading,
      direction:
        i === 0
          ? "Punch the first four words, then drop volume for intrigue"
          : i === sections.length - 1
            ? "Slow down, land the final beat, hold before the CTA"
            : "Steady build, emphasise the concrete detail",
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Registry / execution                                               */
/* ------------------------------------------------------------------ */

type Executor = {
  model: (ctx: StepContext) => Promise<Record<string, unknown>>;
  composer: (ctx: StepContext) => Record<string, unknown>;
};

const EXECUTORS: Record<string, Executor> = {
  research: { model: modelResearch, composer: composeResearch },
  fact_check: { model: modelFactCheck, composer: composeFactCheck },
  concept: { model: modelConcept, composer: composeConcept },
  script: { model: modelScript, composer: composeScript },
  visual_plan: { model: modelVisualPlan, composer: composeVisualPlan },
};

export function productionProviderLabel(): string {
  const info = resolveModel();
  return info ? `${info.provider} · ${info.model}` : "composer · deterministic-v1";
}

export function hasProductionModel(): boolean {
  return hasModelCredentials();
}

/** Rough per-1M-token pricing so cost reporting is directionally useful. */
const PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-5": { in: 3, out: 15 },
};

export function estimateTextCostMicroUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICE_PER_MTOK[model] ?? { in: 0.5, out: 1.5 };
  return Math.round(((promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out) * 1e6);
}

/** Very rough token estimate when the provider does not return usage. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Execute one text-generation production step. Uses the configured AI
 * model when credentials exist; otherwise the deterministic composer.
 * The returned `mode` distinguishes the two — callers must persist it.
 */
export async function executeStep(stepKey: string, ctx: StepContext): Promise<StepOutput> {
  const executor = EXECUTORS[stepKey];
  if (!executor) throw new Error(`No executor registered for production step "${stepKey}"`);

  const info = resolveModel();
  if (info) {
    const started = Date.now();
    try {
      const output = await executor.model(ctx);
      const promptTokens = estimateTokens(JSON.stringify(ctx.prior) + ctx.story.summary + ctx.story.title);
      const completionTokens = estimateTokens(JSON.stringify(output));
      return {
        output,
        provider: `${info.provider}:${info.model}`,
        mode: "real_ai",
        usage: {
          promptTokens,
          completionTokens,
          costMicroUsd: estimateTextCostMicroUsd(info.model, promptTokens, completionTokens),
        },
      };
    } catch (err) {
      console.warn(
        `[production] model step "${stepKey}" failed after ${Date.now() - started}ms (${
          err instanceof Error ? err.message : err
        }) — falling back to deterministic composer`,
      );
    }
  }
  return {
    output: executor.composer(ctx),
    provider: "composer:deterministic-v1",
    mode: "fallback",
    usage: { promptTokens: 0, completionTokens: 0, costMicroUsd: 0 },
  };
}
