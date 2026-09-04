import {
  mockAI,
  mockAnalytics,
  mockDiscovery,
  mockMedia,
  mockPublishing,
  mockResearch,
  mockTTS,
} from "./mock";
import type {
  AIScriptProvider,
  AnalyticsProvider,
  MediaProvider,
  ProviderDoc,
  PublishingProvider,
  ResearchProvider,
  StoryDiscoveryProvider,
  TTSProvider,
} from "./types";

/* ------------------------------------------------------------------ */
/*  Service registry.                                                  */
/*                                                                     */
/*  Phase 1: every slot resolves to a mock adapter. When real          */
/*  adapters are built (OpenAI, ElevenLabs, YouTube Data API, ...)     */
/*  they are registered in the maps below and selected via env vars    */
/*  documented in .env.example — no UI or engine code changes needed.  */
/* ------------------------------------------------------------------ */

type Registry<T extends { key: string }> = Record<string, () => T>;

function resolve<T extends { key: string }>(
  slot: string,
  envKey: string,
  registry: Registry<T>,
  fallbackKey: string,
): T {
  const wanted = process.env[envKey] ?? fallbackKey;
  const factory = registry[wanted];
  if (!factory) {
    console.warn(`[services] ${slot}: provider "${wanted}" not registered — using mock`);
    return registry[fallbackKey]();
  }
  return factory();
}

const discoveryProviders: Registry<StoryDiscoveryProvider> = { mock: () => mockDiscovery };
const researchProviders: Registry<ResearchProvider> = { mock: () => mockResearch };
const aiProviders: Registry<AIScriptProvider> = { mock: () => mockAI };
const ttsProviders: Registry<TTSProvider> = { mock: () => mockTTS };
const mediaProviders: Registry<MediaProvider> = { mock: () => mockMedia };
const publishingProviders: Registry<PublishingProvider> = { mock: () => mockPublishing };
const analyticsProviders: Registry<AnalyticsProvider> = { mock: () => mockAnalytics };

export const services = {
  discovery: resolve("discovery", "STORY_DISCOVERY_PROVIDER", discoveryProviders, "mock"),
  research: resolve("research", "RESEARCH_PROVIDER", researchProviders, "mock"),
  ai: resolve("ai", "AI_MODEL_PROVIDER", aiProviders, "mock"),
  tts: resolve("tts", "TTS_PROVIDER", ttsProviders, "mock"),
  media: resolve("media", "MEDIA_PROVIDER", mediaProviders, "mock"),
  publishing: resolve("publishing", "PUBLISHING_PROVIDER", publishingProviders, "mock"),
  analytics: resolve("analytics", "ANALYTICS_PROVIDER", analyticsProviders, "mock"),
};

/* -------- integration catalogue (rendered on the Settings page) --- */

export const PROVIDER_DOCS: ProviderDoc[] = [
  {
    id: "ai",
    label: "AI models",
    description: "Scriptwriting, evaluation and fact-checking (OpenAI, Anthropic…)",
    envKeys: ["AI_MODEL_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
  },
  {
    id: "discovery",
    label: "Story discovery",
    description: "Trend and story feeds that feed the scout agent",
    envKeys: ["STORY_DISCOVERY_PROVIDER", "NEWS_API_KEY", "REDDIT_CLIENT_ID"],
  },
  {
    id: "research",
    label: "Research / search",
    description: "Source retrieval for the research agent (Tavily, Exa…)",
    envKeys: ["RESEARCH_PROVIDER", "TAVILY_API_KEY"],
  },
  {
    id: "tts",
    label: "Text-to-speech",
    description: "Channel voiceovers with per-channel voices (ElevenLabs…)",
    envKeys: ["TTS_PROVIDER", "ELEVENLABS_API_KEY"],
  },
  {
    id: "media",
    label: "Image / video generation",
    description: "Visuals, b-roll and thumbnails (Runway, Stability…)",
    envKeys: ["MEDIA_PROVIDER", "RUNWAY_API_KEY", "STABILITY_API_KEY"],
  },
  {
    id: "publishing",
    label: "Social publishing",
    description: "Multi-platform upload (YouTube, TikTok, Instagram, X)",
    envKeys: ["PUBLISHING_PROVIDER", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "TIKTOK_CLIENT_KEY", "INSTAGRAM_ACCESS_TOKEN"],
  },
  {
    id: "analytics",
    label: "Analytics",
    description: "Performance pull-back to improve future content",
    envKeys: ["ANALYTICS_PROVIDER", "YOUTUBE_API_KEY"],
  },
];

export function envConfigured(keys: string[]): boolean {
  return keys.some((k) => !k.endsWith("_PROVIDER") && Boolean(process.env[k]));
}
