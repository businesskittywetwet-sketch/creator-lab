import { db } from "./index";
import {
  agentRuns,
  agents,
  aiUsage,
  draftRevisions,
  productionAssets,
  channelProductionSettings,
  contentDrafts,
  productionJobs,
  productionSteps,
  analyticsSnapshots,
  automationJobs,
  automationSettings,
  channels,
  content,
  publishingJobs,
  stories,
  storyEvaluations,
  storySources,
  workflows,
} from "./schema";
import { PIPELINE_STAGES } from "../lib/pipeline";
import { DEFAULT_SOURCES } from "../engine/default-sources";
import { DEFAULT_REQUIRED_STEPS } from "../lib/production-steps";

/* ------------------------------------------------------------------ */
/*  Idempotent demo seed. Wipes and repopulates all tables so the      */
/*  dashboard always has rich, believable data. Run via                */
/*  `npx tsx scripts/seed.ts` or the Settings → "Reset demo data".     */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDatabase(): Promise<{ ok: true }> {
  const rand = mulberry32(1337);
  const now = Date.now();
  const mins = (n: number) => new Date(now - n * 60_000);
  const hours = (n: number) => new Date(now - n * 3600_000);
  const days = (n: number) => new Date(now - n * 86400_000);
  const future = (n: number) => new Date(now + n * 3600_000);

  /* ------------------------- wipe (child-first) -------------------- */
  await db.delete(analyticsSnapshots);
  await db.delete(aiUsage);
  await db.delete(draftRevisions);
  await db.delete(productionAssets);
  await db.delete(contentDrafts);
  await db.delete(productionSteps);
  await db.delete(productionJobs);
  await db.delete(channelProductionSettings);
  await db.delete(storyEvaluations);
  await db.delete(publishingJobs);
  await db.delete(workflows);
  await db.delete(automationJobs);
  await db.delete(agentRuns);
  await db.delete(content);
  await db.delete(stories);
  await db.delete(agents);
  await db.delete(storySources);
  await db.delete(automationSettings);
  await db.delete(channels);

  /* ---------------------------- channels --------------------------- */
  const [weirdHistory, darkMysteries, movieSecrets, retroGaming] = await db
    .insert(channels)
    .values([
      {
        slug: "weird-history",
        name: "Weird History",
        niche: "Bizarre & forgotten history",
        description:
          "Short-form stories about the strangest true events ever recorded — plagues of dancing, molasses floods, and wars lost to wildlife.",
        contentStyle: "Fast-cut archival imagery, kinetic captions, dry comedic timing",
        targetAudience: "18–34, history-curious scrollers",
        postingFrequency: "5 videos / week",
        preferredLength: "45–60s · vertical",
        voiceTone: "Wry, deadpan narrator",
        targetPlatforms: ["youtube", "tiktok", "instagram"],
        color: "#C6F135",
        active: true,
        createdAt: days(41),
      },
      {
        slug: "dark-mysteries",
        name: "Dark Mysteries",
        niche: "Unsolved cases & the unexplained",
        description:
          "Long-form and teaser content covering disappearances, ciphers and incidents that resist explanation.",
        contentStyle: "Cinematic slow-build, ambient score, evidence-overlay graphics",
        targetAudience: "25–44, true-crime and mystery audience",
        postingFrequency: "3 videos / week",
        preferredLength: "8–12 min + 60s teasers",
        voiceTone: "Low, measured, conspiratorial",
        targetPlatforms: ["youtube", "tiktok"],
        color: "#A78BFA",
        active: true,
        createdAt: days(38),
      },
      {
        slug: "movie-secrets",
        name: "Movie Secrets",
        niche: "Film trivia & hidden details",
        description:
          "Easter eggs, continuity tricks and production stories hiding in famous films, delivered at high tempo.",
        contentStyle: "Punchy edits, frame-freeze callouts, zoom-through transitions",
        targetAudience: "16–35, film fans and casual viewers",
        postingFrequency: "Daily",
        preferredLength: "30–45s · vertical",
        voiceTone: "High-energy cinephile",
        targetPlatforms: ["youtube", "tiktok", "instagram", "x"],
        color: "#67E8F9",
        active: true,
        createdAt: days(30),
      },
      {
        slug: "retro-gaming-myths",
        name: "Retro Gaming Myths",
        niche: "Gaming urban legends",
        description:
          "Polybius cabinets, haunted cartridges and cheat codes that never existed. On hold pending audio pipeline work.",
        contentStyle: "CRT texture overlays, VHS glitches, chiptune stingers",
        targetAudience: "20–40, retro gaming community",
        postingFrequency: "2 videos / week",
        preferredLength: "60–90s · vertical",
        voiceTone: "Arcade-hype with a spooky edge",
        targetPlatforms: ["tiktok", "instagram"],
        color: "#FBBF24",
        active: false,
        createdAt: days(12),
      },
    ])
    .returning();

  void retroGaming; // kept as the seeded "inactive" channel example

  /* ------------------- channel production settings ----------------- */
  await db.insert(channelProductionSettings).values([
    {
      channelId: weirdHistory.id,
      format: "Short",
      targetDurationSec: 55,
      scriptWordTarget: 140,
      tone: "Wry, deadpan narrator with comedic timing",
      hookStyle: "cold-open absurd fact",
      ctaStyle: "Follow for more history they skipped",
      visualStyle: "Fast-cut archival imagery with kinetic captions",
      narrationVoice: "weird-history-primary",
      researchDepth: 4,
      sectionCount: 4,
      requiredSteps: DEFAULT_REQUIRED_STEPS,
    },
    {
      channelId: darkMysteries.id,
      format: "Long-form",
      targetDurationSec: 600,
      scriptWordTarget: 1400,
      tone: "Low, measured, conspiratorial",
      hookStyle: "unanswered question cold open",
      ctaStyle: "Subscribe for the rest of the file",
      visualStyle: "Cinematic slow-build with evidence-overlay graphics",
      narrationVoice: "dark-mysteries-primary",
      researchDepth: 6,
      sectionCount: 6,
      requiredSteps: DEFAULT_REQUIRED_STEPS,
    },
    {
      channelId: movieSecrets.id,
      format: "Short",
      targetDurationSec: 40,
      scriptWordTarget: 105,
      tone: "High-energy cinephile",
      hookStyle: "freeze-frame reveal",
      ctaStyle: "Follow for more hidden details",
      visualStyle: "Punchy edits with frame-freeze callouts",
      narrationVoice: "movie-secrets-primary",
      researchDepth: 3,
      sectionCount: 3,
      // narration handled by an external partner for this channel
      requiredSteps: DEFAULT_REQUIRED_STEPS.filter((k) => k !== "narration"),
    },
    {
      channelId: retroGaming.id,
      format: "Short",
      targetDurationSec: 75,
      scriptWordTarget: 185,
      tone: "Arcade-hype with a spooky edge",
      hookStyle: "urban-legend tease",
      ctaStyle: "Follow for more gaming myths",
      visualStyle: "CRT texture overlays with VHS glitches",
      narrationVoice: "retro-gaming-primary",
      researchDepth: 4,
      sectionCount: 4,
      requiredSteps: DEFAULT_REQUIRED_STEPS,
    },
  ]);

  /* ----------------------------- agents ---------------------------- */
  const agentRows = [
    {
      slug: "story-scout",
      name: "Story Scout",
      role: "Discovery",
      description: "Scans feeds, trends and archives for story candidates matched to each channel's niche.",
      icon: "Radar",
      status: "idle",
      currentTask: null,
      lastTask: "Sweep complete — 6 candidates scored",
      lastTaskStatus: "success",
      lastRunAt: mins(42),
      successRate: 97,
      totalRuns: 412,
      failedRuns: 11,
    },
    {
      slug: "story-judge",
      name: "Story Judge",
      role: "Evaluation",
      description: "Ranks scout output on virality potential, niche fit and watch-time retention signals.",
      icon: "Scale",
      status: "idle",
      currentTask: null,
      lastTask: "Evaluated 12 candidates · 4 promoted",
      lastTaskStatus: "success",
      lastRunAt: mins(38),
      successRate: 99,
      totalRuns: 388,
      failedRuns: 2,
    },
    {
      slug: "research-agent",
      name: "Research Agent",
      role: "Investigation",
      description: "Builds sourced briefs with primary references, timelines and conflicting-claim flags.",
      icon: "BookOpenText",
      status: "running",
      currentTask: "Compiling source brief — “The Dancing Plague”",
      lastTask: "Brief delivered · 7 sources verified",
      lastTaskStatus: "success",
      lastRunAt: mins(6),
      successRate: 95,
      totalRuns: 301,
      failedRuns: 14,
    },
    {
      slug: "scriptwriter",
      name: "Scriptwriter",
      role: "Scripting",
      description: "Writes retention-first scripts per channel voice: hooks in 1.5s, escalating payoff beats.",
      icon: "PenLine",
      status: "running",
      currentTask: "Draft v2 — “Fight Club Starbucks Cup”",
      lastTask: "Script approved · 58s runtime",
      lastTaskStatus: "success",
      lastRunAt: mins(11),
      successRate: 93,
      totalRuns: 286,
      failedRuns: 19,
    },
    {
      slug: "fact-checker",
      name: "Fact Checker",
      role: "Verification",
      description: "Cross-examines every claim against the research brief and quarantines weak assertions.",
      icon: "ShieldCheck",
      status: "idle",
      currentTask: null,
      lastTask: "31/33 claims verified · 2 softened",
      lastTaskStatus: "success",
      lastRunAt: mins(55),
      successRate: 98,
      totalRuns: 264,
      failedRuns: 5,
    },
    {
      slug: "video-director",
      name: "Video Director",
      role: "Assembly",
      description: "Plans shot lists, pacing curves and edit decisions; orchestrates the render pipeline.",
      icon: "Clapperboard",
      status: "running",
      currentTask: "Rendering timeline — “CIA Spy Cat” (3/9 segments)",
      lastTask: "Cut approved on first pass",
      lastTaskStatus: "success",
      lastRunAt: mins(3),
      successRate: 91,
      totalRuns: 233,
      failedRuns: 21,
    },
    {
      slug: "voice-agent",
      name: "Voice Agent",
      role: "Narration",
      description: "Generates channel-consistent voiceover from scripts with per-brand voice profiles.",
      icon: "Mic",
      status: "idle",
      currentTask: null,
      lastTask: "52s narration rendered · Weird History voice",
      lastTaskStatus: "success",
      lastRunAt: mins(25),
      successRate: 99,
      totalRuns: 278,
      failedRuns: 3,
    },
    {
      slug: "visual-gen",
      name: "Visual Generation Agent",
      role: "Imagery",
      description: "Produces b-roll frames, thumbnails and motion segments aligned with the director's shot list.",
      icon: "ImagePlus",
      status: "running",
      currentTask: "Generating b-roll — “Somerton Man” (segment 5/8)",
      lastTask: "Thumbnail A/B variants delivered",
      lastTaskStatus: "success",
      lastRunAt: mins(4),
      successRate: 94,
      totalRuns: 341,
      failedRuns: 20,
    },
    {
      slug: "qc-agent",
      name: "Quality Control Agent",
      role: "Review",
      description: "Predicts retention drops, checks policy compliance and blocks weak exports pre-upload.",
      icon: "Gauge",
      status: "error",
      currentTask: null,
      lastTask: "Flagged pacing drop at 0:31 — “Lead Masks Case”",
      lastTaskStatus: "failure",
      lastRunAt: mins(19),
      successRate: 92,
      totalRuns: 198,
      failedRuns: 16,
    },
    {
      slug: "publishing-agent",
      name: "Publishing Agent",
      role: "Distribution",
      description: "Schedules and uploads to every target platform with per-network formats and captions.",
      icon: "Send",
      status: "idle",
      currentTask: null,
      lastTask: "TikTok upload rejected — token expired",
      lastTaskStatus: "failure",
      lastRunAt: mins(88),
      successRate: 96,
      totalRuns: 512,
      failedRuns: 23,
    },
    {
      slug: "analytics-agent",
      name: "Analytics Agent",
      role: "Feedback",
      description: "Pulls performance, detects winning patterns and feeds insights back to the judge and writer.",
      icon: "LineChart",
      status: "idle",
      currentTask: null,
      lastTask: "Synced 14 days of metrics · 3 flagships",
      lastTaskStatus: "success",
      lastRunAt: mins(33),
      successRate: 100,
      totalRuns: 446,
      failedRuns: 0,
    },
  ] as const;

  await db.insert(agents).values(agentRows.map((a) => ({ ...a })));

  /* -------------------------- story sources ------------------------ */
  await db.insert(storySources).values(DEFAULT_SOURCES);

  /* ----------------------------- stories --------------------------- */
  await db
    .insert(stories)
    .values([
      { channelId: weirdHistory.id, title: "The Town That Adopted a Hippo as Mayor", summary: "In stopped-clock America, a ceremonial hippo presidency out-polled two human candidates.", sourceName: "r/todayilearned", sourceUrl: "https://reddit.example.com/hippo", score: 74, status: "discovered", tags: ["absurd-history"], createdAt: hours(26) },
      { channelId: darkMysteries.id, title: "The Eilean Mor Lighthouse Keepers Vanished Mid-Meal", summary: "Three keepers, one storm log, and a meal left half-eaten on a lighthouse table in 1900.", sourceName: "Wikipedia deep-dive", sourceUrl: "https://en.wikipedia.example.com/flannan", score: 92, status: "discovered", tags: ["disappearances", "maritime"], createdAt: hours(22) },
      { channelId: movieSecrets.id, title: "Blade Runner's Unicorn Scene Was Shot for Another Film", summary: "Ridley Scott pulled the footage from unused Legend takes — and fans argue about it to this day.", sourceName: "AFI archive", sourceUrl: "https://afi.example.com/bladerunner", score: 81, status: "discovered", tags: ["sci-fi", "production"], createdAt: hours(18) },
      { channelId: weirdHistory.id, title: "The Kentucky Meat Shower of 1876", summary: "Chunks of raw meat fell from a clear sky over Bath County. Science still debates what they were.", sourceName: "Scientific American (1876)", sourceUrl: "https://archive.example.com/meatsky", score: 87, status: "discovered", tags: ["weird-events"], createdAt: hours(15) },
      { channelId: darkMysteries.id, title: "The Bloop: The Ocean Sound Heard 3,000 Miles Away", summary: "NOAA's hydrophones caught something huge in 1997. 'Icequake' is the official answer. Nobody's sure.", sourceName: "NOAA recordings", sourceUrl: "https://noaa.example.com/bloop", score: 79, status: "discovered", tags: ["ocean", "unexplained"], createdAt: hours(9) },
      { channelId: movieSecrets.id, title: "Home Alone's Grocery Bill Is Economically Impossible", summary: "Kevin's 1990 shopping trip went viral for a reason — the math doesn't survive contact with 2025.", sourceName: "Viral thread analysis", sourceUrl: "https://x.example.com/homealone", score: 68, status: "discovered", tags: ["trending", "economics"], createdAt: hours(5) },
      { channelId: weirdHistory.id, title: "Napoleon Was Attacked by 3,000 Rabbits", summary: "A victory hunt turned rout when the imperial rabbit reserve charged the Emperor of France.", sourceName: "Memoirs of Gen. Thiébault", sourceUrl: "https://archive.example.com/rabbits", score: 79, status: "selected", tags: ["napoleon", "absurd-history"], createdAt: days(2) },
      { channelId: darkMysteries.id, title: "The Vanishing of the Sodder Children", summary: "Five children disappeared from a burning house in 1945 — but no remains were ever found.", sourceName: "FBI file summary", sourceUrl: "https://vault.example.com/sodder", score: 83, status: "selected", tags: ["missing-persons"], createdAt: days(1) },
      { channelId: weirdHistory.id, title: "The Great London Beer Flood of 1814", summary: "A 22-foot vat ruptured, sending 1.3 million litres of porter through the streets of St Giles.", sourceName: "Times archive", sourceUrl: "https://archive.example.com/beerflood", score: 71, status: "discovered", tags: ["disasters"], createdAt: days(2) },
      { channelId: darkMysteries.id, title: "A Village in New York Outlawed Talking About Itself", summary: "Lily Dale's spiritualist residents have enforced unusual rules for 140 years.", sourceName: "Local reporting", sourceUrl: "https://news.example.com/lilydale", score: 54, status: "rejected", tags: ["niche"], createdAt: days(3) },
      { channelId: movieSecrets.id, title: "The Wilhelm Scream Appears in 400+ Films", summary: "One 1951 sound effect became cinema's longest-running inside joke.", sourceName: "Sound design history", sourceUrl: "https://film.example.com/wilhelm", score: 45, status: "rejected", tags: ["overdone"], createdAt: days(4) },
      { channelId: weirdHistory.id, title: "The Exploding Whale of Florence, Oregon", summary: "In 1970 officials used 20 cases of dynamite to remove a beached whale. It went exactly as well as you'd expect.", sourceName: "KATU archive footage", sourceUrl: "https://news.example.com/whale", score: 93, status: "used", tags: ["disasters", "absurd-history"], createdAt: days(11) },
      { channelId: darkMysteries.id, title: "Dyatlov Pass: The Theory That Almost Explains It", summary: "Nine hikers, a tent cut from inside, and an avalanche model that finally fits — almost.", sourceName: "Nature Communications", sourceUrl: "https://nature.example.com/dyatlov", score: 87, status: "used", tags: ["mountains", "unsolved"], createdAt: days(8) },
    ])
    .returning();

  /* ----------------------------- content --------------------------- */
  const contentSeed: (typeof content.$inferInsert)[] = [
    { channelId: weirdHistory.id, title: "The Great London Beer Flood of 1814", format: "Short", stage: "discovered", score: 71, assignedAgents: ["story-scout"], durationSec: null, createdAt: days(2), updatedAt: hours(30) },
    { channelId: darkMysteries.id, title: "Flight 19: Five Bombers That Never Came Back", format: "Short", stage: "discovered", score: 68, assignedAgents: ["story-scout"], durationSec: null, createdAt: days(2), updatedAt: hours(28) },
    { channelId: weirdHistory.id, title: "Napoleon Was Attacked by 3,000 Rabbits", format: "Short", stage: "selected", score: 79, hook: "The Emperor of France fled from bunnies.", assignedAgents: ["story-scout", "story-judge"], durationSec: null, createdAt: days(2), updatedAt: hours(20) },
    { channelId: darkMysteries.id, title: "The Vanishing of the Sodder Children", format: "Teaser", stage: "selected", score: 83, hook: "The house burned. The children didn't.", assignedAgents: ["story-scout", "story-judge"], durationSec: null, createdAt: days(1), updatedAt: hours(16) },
    { channelId: weirdHistory.id, title: "The Dancing Plague That Killed 400 People", format: "Short", stage: "researching", score: 88, hook: "They danced until their hearts gave out.", assignedAgents: ["story-judge", "research-agent"], durationSec: 55, createdAt: days(4), updatedAt: hours(6) },
    { channelId: movieSecrets.id, title: "Fight Club Hides a Starbucks Cup in Every Scene", format: "Short", stage: "researching", score: 85, hook: "David Fincher dared you not to notice.", assignedAgents: ["story-judge", "research-agent"], durationSec: 40, createdAt: days(3), updatedAt: hours(4) },
    { channelId: weirdHistory.id, title: "Julius Caesar Was Kidnapped by Pirates — and Laughed", format: "Short", stage: "scripted", score: 84, hook: "He told them he'd be back to kill them. He was.", assignedAgents: ["research-agent", "scriptwriter"], durationSec: 58, createdAt: days(5), updatedAt: hours(11) },
    { channelId: darkMysteries.id, title: "The Max Headroom Incident Is Still Unsolved", format: "Short", stage: "fact_check", score: 89, hook: "Someone hijacked two TV stations wearing a mask.", assignedAgents: ["scriptwriter", "fact-checker"], durationSec: 62, createdAt: days(6), updatedAt: hours(14) },
    { channelId: movieSecrets.id, title: "Inception's Soundtrack Is One Song Slowed Down", format: "Short", stage: "fact_check", score: 82, hook: "The whole score is the kick.", assignedAgents: ["scriptwriter", "fact-checker"], durationSec: 44, createdAt: days(5), updatedAt: hours(22) },
    { channelId: weirdHistory.id, title: "The CIA Spent $20M Turning a Cat Into a Spy", format: "Short", stage: "production", score: 91, hook: "Acoustic Kitty's first mission lasted minutes.", assignedAgents: ["video-director", "voice-agent", "visual-gen"], durationSec: 54, createdAt: days(7), updatedAt: mins(40) },
    { channelId: darkMysteries.id, title: "The Somerton Man Left a Code Nobody Can Crack", format: "Long-form", stage: "production", score: 90, hook: "Tamám shud — it is ended. But nothing was.", assignedAgents: ["video-director", "voice-agent", "visual-gen"], durationSec: 640, createdAt: days(8), updatedAt: hours(2) },
    { channelId: darkMysteries.id, title: "The Lead Masks Case: Brazil's Strangest Deaths", format: "Short", stage: "qc", score: 81, hook: "Two men. Lead eye masks. No wounds. No answers.", assignedAgents: ["visual-gen", "qc-agent"], durationSec: 58, createdAt: days(9), updatedAt: hours(8) },
    { channelId: weirdHistory.id, title: "Emperor Norton I: America's Only Monarch", format: "Short", stage: "scheduled", score: 86, hook: "San Francisco's beloved self-declared Emperor.", assignedAgents: ["qc-agent", "publishing-agent"], durationSec: 52, scheduledAt: future(6), createdAt: days(10), updatedAt: hours(12) },
    { channelId: movieSecrets.id, title: "Parasite's Poster Spoils the Entire Ending", format: "Short", stage: "scheduled", score: 88, hook: "The eye bars tell you who lies. Look closer.", assignedAgents: ["qc-agent", "publishing-agent"], durationSec: 47, scheduledAt: future(11), createdAt: days(10), updatedAt: hours(9) },
    { channelId: weirdHistory.id, title: "The Exploding Whale of Florence, Oregon", format: "Short", stage: "published", score: 93, hook: "20 cases of dynamite vs. 8 tons of whale.", assignedAgents: ["publishing-agent", "analytics-agent"], durationSec: 56, publishedAt: days(11), createdAt: days(13), updatedAt: days(11) },
    { channelId: darkMysteries.id, title: "Dyatlov Pass: The Theory That Almost Explains It", format: "Long-form", stage: "published", score: 87, hook: "Nine hikers. One tent cut open from inside.", assignedAgents: ["publishing-agent", "analytics-agent"], durationSec: 690, publishedAt: days(6), createdAt: days(9), updatedAt: days(6) },
    { channelId: movieSecrets.id, title: "Coraline's Buttons Were Never About Eyes", format: "Short", stage: "published", score: 84, hook: "The buttons track something much darker.", assignedAgents: ["publishing-agent", "analytics-agent"], durationSec: 45, publishedAt: days(2), createdAt: days(4), updatedAt: days(2) },
  ];
  const contentRows = await db.insert(content).values(contentSeed).returning();
  const byTitle = new Map(contentRows.map((c) => [c.title, c]));

  /* --------------------------- workflows --------------------------- */
  const wfFor = (title: string, currentKey: string, status = "running") => {
    const idx = PIPELINE_STAGES.findIndex((s) => s.key === currentKey);
    return {
      contentId: byTitle.get(title)?.id ?? null,
      name: `Pipeline · ${title}`,
      type: "content_pipeline",
      status,
      currentStage: currentKey,
      steps: PIPELINE_STAGES.slice(0, 9).map((s, i) => ({
        stage: s.key,
        label: s.label,
        status: i < idx ? ("done" as const) : i === idx ? ("active" as const) : ("pending" as const),
        agent: s.agents[0],
      })),
      startedAt: days(3),
    };
  };
  await db.insert(workflows).values([
    wfFor("The CIA Spent $20M Turning a Cat Into a Spy", "production"),
    wfFor("The Dancing Plague That Killed 400 People", "researching"),
    wfFor("Emperor Norton I: America's Only Monarch", "scheduled"),
  ]);

  /* ------------------------- publishing jobs ----------------------- */
  const pubFor = (title: string) => byTitle.get(title)!;
  const pubJobsSeed: (typeof publishingJobs.$inferInsert)[] = [
    // published content → completed jobs
    ...["youtube", "tiktok", "instagram"].map((p) => ({
      contentId: pubFor("The Exploding Whale of Florence, Oregon").id,
      platform: p, status: "published", attempts: 1,
      publishedAt: days(11), scheduledAt: days(11),
      externalUrl: `https://${p}.example.com/v/whale70`, createdAt: days(11),
    })),
    ...["youtube", "tiktok"].map((p) => ({
      contentId: pubFor("Dyatlov Pass: The Theory That Almost Explains It").id,
      platform: p, status: "published", attempts: 1,
      publishedAt: days(6), scheduledAt: days(6),
      externalUrl: `https://${p}.example.com/v/dyatlov9`, createdAt: days(6),
    })),
    ...["youtube", "tiktok", "instagram", "x"].map((p) => ({
      contentId: pubFor("Coraline's Buttons Were Never About Eyes").id,
      platform: p, status: "published", attempts: 1,
      publishedAt: days(2), scheduledAt: days(2),
      externalUrl: `https://${p}.example.com/v/coraline04`, createdAt: days(2),
    })),
    // scheduled content → queued jobs (+ one failure for the retry queue)
    { contentId: pubFor("Emperor Norton I: America's Only Monarch").id, platform: "youtube", status: "queued", attempts: 0, scheduledAt: future(6), createdAt: hours(12) },
    { contentId: pubFor("Emperor Norton I: America's Only Monarch").id, platform: "instagram", status: "queued", attempts: 0, scheduledAt: future(6), createdAt: hours(12) },
    { contentId: pubFor("Emperor Norton I: America's Only Monarch").id, platform: "tiktok", status: "failed", attempts: 1, scheduledAt: future(6), lastError: "TikTok upload rejected: access token expired (40103)", createdAt: hours(3) },
    ...["youtube", "tiktok", "instagram", "x"].map((p) => ({
      contentId: pubFor("Parasite's Poster Spoils the Entire Ending").id,
      platform: p, status: "queued", attempts: 0, scheduledAt: future(11), createdAt: hours(9),
    })),
  ];
  await db.insert(publishingJobs).values(pubJobsSeed);

  /* ---------------------- analytics snapshots ---------------------- */
  type PubCfg = { title: string; platforms: string[]; basePerDay: number; age: number };
  const pubCfg: PubCfg[] = [
    { title: "The Exploding Whale of Florence, Oregon", platforms: ["youtube", "tiktok", "instagram"], basePerDay: 24000, age: 11 },
    { title: "Dyatlov Pass: The Theory That Almost Explains It", platforms: ["youtube", "tiktok"], basePerDay: 9500, age: 6 },
    { title: "Coraline's Buttons Were Never About Eyes", platforms: ["youtube", "tiktok", "instagram", "x"], basePerDay: 14500, age: 2 },
  ];
  const snapSeed: (typeof analyticsSnapshots.$inferInsert)[] = [];
  for (const cfg of pubCfg) {
    const item = pubFor(cfg.title);
    for (const platform of cfg.platforms) {
      const platformWeight = platform === "youtube" ? 1 : platform === "tiktok" ? 0.85 : platform === "instagram" ? 0.55 : 0.2;
      let cumulative = 0;
      for (let day = cfg.age; day >= 0; day--) {
        const viralBoost = day === cfg.age ? 2.1 : day === cfg.age - 1 ? 1.5 : 1 - (cfg.age - day) * 0.04;
        const daily = Math.max(120, Math.round(cfg.basePerDay * platformWeight * Math.max(0.25, viralBoost) * (0.75 + rand() * 0.5)));
        cumulative += daily;
        const views = cumulative;
        snapSeed.push({
          contentId: item.id,
          channelId: item.channelId,
          platform,
          capturedAt: days(day),
          views,
          likes: Math.round(views * (0.045 + rand() * 0.02)),
          comments: Math.round(views * (0.003 + rand() * 0.003)),
          shares: Math.round(views * (0.009 + rand() * 0.006)),
          watchMinutes: Math.round(views * (0.5 + rand() * 0.3)),
        });
      }
    }
  }
  await db.insert(analyticsSnapshots).values(snapSeed);

  /* ---------------------------- automation ------------------------- */
  const autoJobsSeed: (typeof automationJobs.$inferInsert)[] = [
    { type: "story_discovery", label: "Story discovery sweep", status: "success", attempts: 1, durationMs: 4210, scheduledAt: hours(26), startedAt: hours(26), finishedAt: hours(26), createdAt: hours(26), payload: { found: 6 } },
    { type: "story_evaluation", label: "Story evaluation batch", status: "success", attempts: 1, durationMs: 2880, scheduledAt: hours(25), startedAt: hours(25), finishedAt: hours(25), createdAt: hours(25), payload: { evaluated: 12, promoted: 4 } },
    { type: "research", label: "Research · “Dancing Plague”", status: "running", attempts: 1, scheduledAt: mins(9), startedAt: mins(9), createdAt: mins(9), payload: { contentTitle: "The Dancing Plague That Killed 400 People" } },
    { type: "script_generation", label: "Script · “Fight Club Starbucks Cup” v2", status: "running", attempts: 1, scheduledAt: mins(14), startedAt: mins(14), createdAt: mins(14), payload: { draft: 2 } },
    { type: "production", label: "Production · “CIA Spy Cat” render batch", status: "running", attempts: 1, scheduledAt: mins(31), startedAt: mins(31), createdAt: mins(31), payload: { segments: "3/9" } },
    { type: "fact_check", label: "Fact-check · “Max Headroom Incident”", status: "success", attempts: 1, durationMs: 5120, scheduledAt: hours(3), startedAt: hours(3), finishedAt: hours(3), createdAt: hours(3), payload: { claims: 33, verified: 31 } },
    { type: "script_generation", label: "Script · “Julius Caesar Pirates”", status: "success", attempts: 1, durationMs: 3975, scheduledAt: hours(11), startedAt: hours(11), finishedAt: hours(11), createdAt: hours(11) },
    { type: "qc_review", label: "QC review · “Lead Masks Case”", status: "failed", attempts: 1, maxAttempts: 3, durationMs: 6400, lastError: "Predicted retention drop at 0:31 exceeds threshold (−18%)", scheduledAt: hours(8), startedAt: hours(8), finishedAt: hours(8), createdAt: hours(8) },
    { type: "publishing", label: "Publish · “Emperor Norton” → TikTok", status: "failed", attempts: 1, maxAttempts: 3, durationMs: 12100, lastError: "TikTok upload rejected: access token expired (40103)", scheduledAt: hours(3), startedAt: hours(3), finishedAt: hours(3), createdAt: hours(3) },
    { type: "analytics_sync", label: "Analytics sync · all channels", status: "failed", attempts: 2, maxAttempts: 3, durationMs: 9022, lastError: "YouTube Data API: daily quota exceeded (retry window opens 00:00 UTC)", scheduledAt: hours(7), startedAt: hours(7), finishedAt: hours(7), createdAt: hours(7) },
    { type: "analytics_sync", label: "Analytics sync · all channels", status: "success", attempts: 1, durationMs: 7340, scheduledAt: hours(19), startedAt: hours(19), finishedAt: hours(19), createdAt: hours(19), payload: { rows: 126 } },
    { type: "pipeline_orchestration", label: "Pipeline orchestration tick", status: "success", attempts: 1, durationMs: 820, scheduledAt: hours(1), startedAt: hours(1), finishedAt: hours(1), createdAt: hours(1) },
    { type: "story_discovery", label: "Story discovery sweep", status: "queued", attempts: 0, scheduledAt: future(4), createdAt: mins(20), payload: { focus: "all channels" } },
    { type: "publishing", label: "Publish window · 2 items due", status: "queued", attempts: 0, scheduledAt: future(6), createdAt: mins(20), payload: { items: 2 } },
  ];
  await db.insert(automationJobs).values(autoJobsSeed);

  await db
    .insert(automationSettings)
    .values({
      id: 1,
      enabled: true,
      discoveryIntervalHours: 6,
      publishWindowStart: "09:00",
      publishWindowEnd: "21:00",
      dailyPublishCap: 8,
      maxConcurrentJobs: 3,
      autoRetry: true,
      timezone: "UTC",
      lastRunAt: mins(42),
      nextRunAt: future(2),
    })
    .onConflictDoNothing();

  return { ok: true };
}
