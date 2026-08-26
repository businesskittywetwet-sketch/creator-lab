/* ------------------------------------------------------------------ */
/*  Provider contracts.                                                */
/*                                                                     */
/*  Every external capability the platform will eventually use is      */
/*  isolated behind an interface. The UI and the engine never call     */
/*  third-party APIs directly — they resolve providers through         */
/*  `@/lib/services`, which selects a real adapter when the matching   */
/*  env vars are present and falls back to deterministic mocks.        */
/* ------------------------------------------------------------------ */

export interface DiscoveredStory {
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  score: number;
  tags: string[];
}

export interface ResearchBrief {
  topic: string;
  keyFacts: string[];
  sources: { name: string; url: string }[];
  cautions: string[];
}

export interface ScriptDraft {
  hook: string;
  body: string;
  cta: string;
  wordCount: number;
  estimatedDurationSec: number;
}

export interface FactCheckResult {
  claimsChecked: number;
  verified: number;
  flagged: { claim: string; note: string }[];
  passed: boolean;
}

export interface VoiceResult {
  audioUrl: string;
  durationSec: number;
  voice: string;
}

export interface MediaResult {
  assetUrl: string;
  kind: "image" | "video";
  durationSec?: number;
}

export interface PublishResult {
  platform: string;
  externalUrl: string;
  publishedAt: string;
}

export interface PerformanceMetrics {
  platform: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchMinutes: number;
}

/* --------------------------- interfaces --------------------------- */

export interface StoryDiscoveryProvider {
  key: string;
  discoverStories(niche: string, limit?: number): Promise<DiscoveredStory[]>;
}

export interface ResearchProvider {
  key: string;
  research(topic: string): Promise<ResearchBrief>;
}

export interface AIScriptProvider {
  key: string;
  writeScript(title: string, brief: ResearchBrief): Promise<ScriptDraft>;
  factCheck(script: ScriptDraft, brief: ResearchBrief): Promise<FactCheckResult>;
}

export interface TTSProvider {
  key: string;
  synthesize(text: string, voice: string): Promise<VoiceResult>;
}

export interface MediaProvider {
  key: string;
  generateThumbnail(prompt: string): Promise<MediaResult>;
  generateVideoSegment(prompt: string, durationSec: number): Promise<MediaResult>;
}

export interface PublishingProvider {
  key: string;
  publish(input: {
    platform: string;
    videoUrl: string;
    caption: string;
    scheduledAt?: string;
  }): Promise<PublishResult>;
}

export interface AnalyticsProvider {
  key: string;
  fetchPerformance(externalId: string, platform: string): Promise<PerformanceMetrics>;
}

/** Display metadata so the Settings page can document each integration. */
export type ProviderDoc = {
  id: string;
  label: string;
  description: string;
  envKeys: string[];
  docsUrl?: string;
};
