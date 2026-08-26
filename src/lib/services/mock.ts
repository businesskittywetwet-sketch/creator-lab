import type {
  AIScriptProvider,
  AnalyticsProvider,
  DiscoveredStory,
  FactCheckResult,
  MediaProvider,
  PerformanceMetrics,
  PublishingProvider,
  PublishResult,
  ResearchBrief,
  ResearchProvider,
  ScriptDraft,
  StoryDiscoveryProvider,
  TTSProvider,
  VoiceResult,
} from "./types";

/* ------------------------------------------------------------------ */
/*  Deterministic phase-1 mocks. They emulate latency-free responses   */
/*  so the engine and UI can be exercised end-to-end before any real   */
/*  API keys are wired up.                                             */
/* ------------------------------------------------------------------ */

const DEMO_STORIES: DiscoveredStory[] = [
  {
    title: "The Town That Burned Underground for 60 Years",
    summary:
      "Centralia, Pennsylvania has had a coal-seam fire raging beneath it since 1962 — and a handful of residents refused to leave.",
    sourceName: "Atlas Obscura",
    sourceUrl: "https://example.com/centralia",
    score: 86,
    tags: ["forgotten-places", "disasters"],
  },
  {
    title: "The Game Show Contestant Who Memorised the Board",
    summary:
      "In 1984 Michael Larson lost his life savings after cracking the Press Your Luck pattern — a perfect cautionary underdog arc.",
    sourceName: "Wikipedia",
    sourceUrl: "https://example.com/larson",
    score: 91,
    tags: ["tv-history", "heists"],
  },
  {
    title: "The 1977 Wow! Signal Still Has No Explanation",
    summary:
      "A 72-second radio burst matched every signature of an artificial deep-space broadcast. It never repeated.",
    sourceName: "NASA JPL archive",
    sourceUrl: "https://example.com/wow",
    score: 88,
    tags: ["space", "unexplained"],
  },
];

export const mockDiscovery: StoryDiscoveryProvider = {
  key: "mock",
  async discoverStories(_niche, limit = 3) {
    return DEMO_STORIES.slice(0, limit);
  },
};

export const mockResearch: ResearchProvider = {
  key: "mock",
  async research(topic): Promise<ResearchBrief> {
    return {
      topic,
      keyFacts: [
        "Primary timeline reconstructed from two independent archives",
        "At least one verifiable primary source exists for every major claim",
        "Conflicting details flagged in contemporary reporting",
      ],
      sources: [
        { name: "Public archive extract", url: "https://example.com/archive" },
        { name: "Contemporary press scan", url: "https://example.com/press" },
      ],
      cautions: ["Names and dates vary between sources — resolved to majority account"],
    };
  },
};

export const mockAI: AIScriptProvider = {
  key: "mock",
  async writeScript(title, brief): Promise<ScriptDraft> {
    return {
      hook: `Nobody talks about ${title.toLowerCase()} — here's why they should.`,
      body: `Structured around ${brief.keyFacts.length} verified beats with retention-first pacing.`,
      cta: "Follow for the file they didn't want found.",
      wordCount: 128,
      estimatedDurationSec: 52,
    };
  },
  async factCheck(script, brief): Promise<FactCheckResult> {
    return {
      claimsChecked: brief.keyFacts.length + 4,
      verified: brief.keyFacts.length + 3,
      flagged: [{ claim: script.cta, note: "Rhetorical flourish — acceptable" }],
      passed: true,
    };
  },
};

export const mockTTS: TTSProvider = {
  key: "mock",
  async synthesize(text, voice): Promise<VoiceResult> {
    return {
      audioUrl: "mock://voiceover/take-01.wav",
      durationSec: Math.max(20, Math.round(text.length / 15)),
      voice,
    };
  },
};

export const mockMedia: MediaProvider = {
  key: "mock",
  async generateThumbnail(prompt) {
    return { assetUrl: `mock://thumb/${prompt.length}`, kind: "image" };
  },
  async generateVideoSegment(_prompt, durationSec) {
    return { assetUrl: "mock://render/segment.mp4", kind: "video", durationSec };
  },
};

export const mockPublishing: PublishingProvider = {
  key: "mock",
  async publish(input): Promise<PublishResult> {
    return {
      platform: input.platform,
      externalUrl: `https://${input.platform}.example.com/v/${Math.random()
        .toString(36)
        .slice(2, 9)}`,
      publishedAt: new Date().toISOString(),
    };
  },
};

export const mockAnalytics: AnalyticsProvider = {
  key: "mock",
  async fetchPerformance(_externalId, platform): Promise<PerformanceMetrics> {
    const views = 12000 + Math.floor(Math.random() * 90000);
    return {
      platform,
      views,
      likes: Math.round(views * 0.055),
      comments: Math.round(views * 0.004),
      shares: Math.round(views * 0.011),
      watchMinutes: Math.round(views * 0.62),
    };
  },
};
