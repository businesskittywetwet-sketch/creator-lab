import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import { fetchJson, withRetry } from "@/engine/http";

const execFileAsync = promisify(execFile);

/* Native modules are loaded lazily so they are never pulled into a
   client/edge bundle and never required unless a render is requested. */
type ResvgCtor = new (svg: string, opts?: Record<string, unknown>) => {
  render(): { asPng(): Buffer };
};
function loadResvg(): ResvgCtor {
   
  return (require("@resvg/resvg-js") as { Resvg: ResvgCtor }).Resvg;
}
function loadFfmpegPath(): string | null {
  try {
     
    const p = require("ffmpeg-static") as string | { default?: string };
    return typeof p === "string" ? p : (p?.default ?? null);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Media provider abstraction.                                        */
/*                                                                     */
/*  Image, speech and video-render capabilities each resolve through   */
/*  an env-selected provider. Real API providers are used when         */
/*  credentials exist; otherwise we either render locally (a genuine   */
/*  asset, labelled `fallback`) or return `unavailable` — we never     */
/*  claim an asset was generated when it was not.                      */
/* ------------------------------------------------------------------ */

export type GenerationMode = "real_ai" | "fallback" | "unavailable" | "failed";

export type AssetResult = {
  status: "generated" | "unavailable" | "failed";
  mode: GenerationMode;
  provider: string;
  model: string;
  filePath?: string;
  url?: string;
  mimeType?: string;
  bytes?: number;
  durationSec?: number;
  error?: string;
  costMicroUsd?: number;
};

export const MEDIA_ROOT = path.join(process.cwd(), "public", "generated");

export function publicUrlFor(absPath: string): string {
  const rel = path.relative(path.join(process.cwd(), "public"), absPath);
  return `/${rel.split(path.sep).join("/")}`;
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export function jobDir(jobId: string): string {
  return path.join(MEDIA_ROOT, jobId);
}

/* ============================== IMAGES ============================= */

export type ScenePrompt = {
  sceneNumber: number;
  prompt: string;
  overlayText: string;
  narration: string;
  heading: string;
};

export type ImageProviderInfo = { key: string; model: string; real: boolean };

export function resolveImageProvider(): ImageProviderInfo {
  const wanted = process.env.IMAGE_PROVIDER;
  if ((wanted === "openai" || !wanted) && process.env.OPENAI_API_KEY) {
    return { key: "openai", model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1", real: true };
  }
  if ((wanted === "stability" || !wanted) && process.env.STABILITY_API_KEY) {
    return { key: "stability", model: "stable-image-core", real: true };
  }
  return { key: "local-svg", model: "scene-renderer-v1", real: false };
}

/** Deterministic, brand-consistent scene frame rendered locally to PNG. */
function renderSceneSvg(
  scene: ScenePrompt,
  opts: { width: number; height: number; accent: string; channel: string; total: number },
): string {
  const { width: w, height: h, accent, channel, total } = opts;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // wrap overlay text to fit the frame
  const words = scene.overlayText.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  const maxChars = Math.floor(w / 46);
  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars) {
      if (line) lines.push(line.trim());
      line = word;
    } else line += ` ${word}`;
  }
  if (line.trim()) lines.push(line.trim());
  const shown = lines.slice(0, 4);

  const fontSize = Math.round(w / 13);
  const startY = h / 2 - ((shown.length - 1) * fontSize * 1.18) / 2;
  const seed = scene.sceneNumber * 37;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0d16"/>
      <stop offset="55%" stop-color="#0d1220"/>
      <stop offset="100%" stop-color="#05060a"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="34%" r="62%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  ${Array.from({ length: 9 }, (_, i) => {
    const y = ((seed * (i + 3)) % h);
    const op = 0.05 + ((i * 7 + seed) % 9) / 90;
    return `<rect x="0" y="${y}" width="${w}" height="2" fill="${accent}" opacity="${op.toFixed(2)}"/>`;
  }).join("")}
  <circle cx="${w * 0.5}" cy="${h * 0.33}" r="${w * 0.30}" fill="none" stroke="${accent}" stroke-opacity="0.20" stroke-width="3"/>
  <circle cx="${w * 0.5}" cy="${h * 0.33}" r="${w * 0.22}" fill="none" stroke="${accent}" stroke-opacity="0.13" stroke-width="2"/>
  <text x="${w * 0.5}" y="${h * 0.345}" font-family="DejaVu Sans, sans-serif" font-size="${Math.round(w / 6.2)}"
        font-weight="bold" fill="${accent}" fill-opacity="0.92" text-anchor="middle">${String(scene.sceneNumber).padStart(2, "0")}</text>
  ${shown
    .map(
      (l, i) =>
        `<text x="${w * 0.5}" y="${startY + i * fontSize * 1.18}" font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(l)}</text>`,
    )
    .join("\n  ")}
  <rect x="${w * 0.08}" y="${h * 0.80}" width="${w * 0.84}" height="4" rx="2" fill="#ffffff" opacity="0.12"/>
  <rect x="${w * 0.08}" y="${h * 0.80}" width="${(w * 0.84 * scene.sceneNumber) / Math.max(1, total)}" height="4" rx="2" fill="${accent}"/>
  <text x="${w * 0.08}" y="${h * 0.87}" font-family="DejaVu Sans, sans-serif" font-size="${Math.round(w / 34)}"
        fill="#9aa3b2" letter-spacing="3">${esc(channel.toUpperCase())}</text>
  <text x="${w * 0.92}" y="${h * 0.87}" font-family="DejaVu Sans, sans-serif" font-size="${Math.round(w / 40)}"
        fill="#6b7280" text-anchor="end" letter-spacing="2">SCENE ${scene.sceneNumber}/${total}</text>
</svg>`;
}

export async function generateSceneImage(
  jobId: string,
  scene: ScenePrompt,
  opts: { width: number; height: number; accent: string; channel: string; total: number },
): Promise<AssetResult> {
  const provider = resolveImageProvider();
  const dir = path.join(jobDir(jobId), "scenes");
  await ensureDir(dir);
  const file = path.join(dir, `scene-${String(scene.sceneNumber).padStart(2, "0")}.png`);

  if (provider.real && provider.key === "openai") {
    try {
      const size = opts.height > opts.width ? "1024x1536" : "1536x1024";
      const res = await withRetry(
        () =>
          fetchJson<{ data: { b64_json?: string; url?: string }[] }>(
            `${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/images/generations`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              },
              body: JSON.stringify({
                model: provider.model,
                prompt: scene.prompt,
                size,
                n: 1,
              }),
            },
            90_000,
          ),
        { retries: 1, baseDelayMs: 1200, label: `image-scene-${scene.sceneNumber}` },
      );
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new Error("image provider returned no image data");
      const buf = Buffer.from(b64, "base64");
      await writeFile(file, buf);
      return {
        status: "generated",
        mode: "real_ai",
        provider: provider.key,
        model: provider.model,
        filePath: file,
        url: publicUrlFor(file),
        mimeType: "image/png",
        bytes: buf.length,
        costMicroUsd: 40_000, // ~$0.04 per image
      };
    } catch (err) {
      console.warn(`[media] AI image failed, using local renderer: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Local renderer — a real PNG asset, explicitly labelled as fallback.
  try {
    const svg = renderSceneSvg(scene, opts);
    const Resvg = loadResvg();
    const png = new Resvg(svg, { fitTo: { mode: "width", value: opts.width } }).render().asPng();
    await writeFile(file, png);
    return {
      status: "generated",
      mode: "fallback",
      provider: "local-svg",
      model: "scene-renderer-v1",
      filePath: file,
      url: publicUrlFor(file),
      mimeType: "image/png",
      bytes: png.length,
      costMicroUsd: 0,
    };
  } catch (err) {
    return {
      status: "failed",
      mode: "failed",
      provider: "local-svg",
      model: "scene-renderer-v1",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ============================== SPEECH ============================= */

export type VoiceProviderInfo = { key: string; model: string; real: boolean };

export function resolveVoiceProvider(): VoiceProviderInfo {
  const wanted = process.env.TTS_PROVIDER;
  if ((wanted === "elevenlabs" || !wanted) && process.env.ELEVENLABS_API_KEY) {
    return { key: "elevenlabs", model: process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2", real: true };
  }
  if ((wanted === "openai" || !wanted) && process.env.OPENAI_API_KEY) {
    return { key: "openai", model: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts", real: true };
  }
  return { key: "none", model: "", real: false };
}

export async function generateNarration(
  jobId: string,
  text: string,
  opts: { voice: string; speed: number; style: string; language: string },
): Promise<AssetResult> {
  const provider = resolveVoiceProvider();
  const dir = jobDir(jobId);
  await ensureDir(dir);
  const file = path.join(dir, "narration.mp3");

  if (!provider.real) {
    // Honest failure: no TTS credentials → no audio asset produced.
    return {
      status: "unavailable",
      mode: "unavailable",
      provider: "none",
      model: "",
      error:
        "No text-to-speech credentials configured (set ELEVENLABS_API_KEY or OPENAI_API_KEY). Narration audio was not generated.",
    };
  }

  try {
    let buf: Buffer;
    if (provider.key === "elevenlabs") {
      const voiceId = opts.voice || process.env.ELEVENLABS_DEFAULT_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "",
            accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: provider.model,
            voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
          }),
          signal: AbortSignal.timeout(120_000),
        },
      );
      if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      buf = Buffer.from(await res.arrayBuffer());
    } else {
      const res = await fetch(
        `${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/audio/speech`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: provider.model,
            voice: opts.voice || "onyx",
            input: text,
            speed: Math.max(0.5, Math.min(1.5, opts.speed || 1)),
          }),
          signal: AbortSignal.timeout(120_000),
        },
      );
      if (!res.ok) throw new Error(`OpenAI TTS HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      buf = Buffer.from(await res.arrayBuffer());
    }
    await writeFile(file, buf);
    const durationSec = await probeDuration(file);
    return {
      status: "generated",
      mode: "real_ai",
      provider: provider.key,
      model: provider.model,
      filePath: file,
      url: publicUrlFor(file),
      mimeType: "audio/mpeg",
      bytes: buf.length,
      durationSec,
      costMicroUsd: Math.round((text.length / 1000) * 15_000),
    };
  } catch (err) {
    return {
      status: "failed",
      mode: "failed",
      provider: provider.key,
      model: provider.model,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ============================= CAPTIONS ============================ */

export type CaptionCue = { index: number; start: number; end: number; text: string };

function tc(sec: number, comma = true): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  const f = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s}${comma ? "," : "."}${f}`;
}

/** Split narration into short, vertical-video-friendly caption cues. */
export function buildCaptionCues(
  sections: { narration: string; durationSec: number }[],
  wordsPerCue = 4,
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let clock = 0;
  let index = 1;
  for (const section of sections) {
    const words = section.narration.split(/\s+/).filter(Boolean);
    const dur = Math.max(1, section.durationSec);
    if (words.length === 0) {
      clock += dur;
      continue;
    }
    const groups: string[][] = [];
    for (let i = 0; i < words.length; i += wordsPerCue) groups.push(words.slice(i, i + wordsPerCue));
    const per = dur / groups.length;
    for (const g of groups) {
      cues.push({ index: index++, start: clock, end: clock + per, text: g.join(" ") });
      clock += per;
    }
  }
  return cues;
}

export function cuesToSrt(cues: CaptionCue[]): string {
  return cues
    .map((c) => `${c.index}\n${tc(c.start)} --> ${tc(c.end)}\n${c.text}\n`)
    .join("\n");
}

export function cuesToVtt(cues: CaptionCue[]): string {
  return `WEBVTT\n\n${cues
    .map((c) => `${tc(c.start, false)} --> ${tc(c.end, false)}\n${c.text}\n`)
    .join("\n")}`;
}

export async function writeCaptionFiles(
  jobId: string,
  cues: CaptionCue[],
): Promise<{ srtPath: string; vttPath: string; vttUrl: string }> {
  const dir = jobDir(jobId);
  await ensureDir(dir);
  const srtPath = path.join(dir, "captions.srt");
  const vttPath = path.join(dir, "captions.vtt");
  await writeFile(srtPath, cuesToSrt(cues), "utf8");
  await writeFile(vttPath, cuesToVtt(cues), "utf8");
  return { srtPath, vttPath, vttUrl: publicUrlFor(vttPath) };
}

/* ========================== VIDEO ASSEMBLY ========================= */

export type RenderProviderInfo = { key: string; model: string; real: boolean };

export function resolveRenderProvider(): RenderProviderInfo {
  const wanted = process.env.VIDEO_RENDER_PROVIDER;
  if (wanted && wanted !== "local-ffmpeg") {
    return { key: wanted, model: "external", real: true };
  }
  return { key: "local-ffmpeg", model: "ffmpeg-7", real: true };
}

async function probeDuration(file: string): Promise<number | undefined> {
  const ffmpegPath = loadFfmpegPath();
  if (!ffmpegPath) return undefined;
  try {
    const { stderr } = await execFileAsync(ffmpegPath, ["-hide_banner", "-i", file], {
      maxBuffer: 1 << 20,
    }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }));
    const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr ?? "");
    if (!m) return undefined;
    return Math.round(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  } catch {
    return undefined;
  }
}

export type RenderScene = { filePath: string; durationSec: number };

/**
 * Render a real, playable MP4 from scene stills, optional narration and
 * burned-in captions. Server-side and synchronous-per-job so it can be
 * moved behind an async worker queue without changing callers.
 */
export async function renderVideo(
  jobId: string,
  scenes: RenderScene[],
  opts: {
    width: number;
    height: number;
    audioPath?: string;
    srtPath?: string;
    fps?: number;
  },
): Promise<AssetResult> {
  const provider = resolveRenderProvider();
  const ffmpegPath = loadFfmpegPath();
  if (!ffmpegPath) {
    return {
      status: "unavailable",
      mode: "unavailable",
      provider: provider.key,
      model: provider.model,
      error: "ffmpeg binary unavailable in this runtime — video was not rendered",
    };
  }
  if (scenes.length === 0) {
    return {
      status: "unavailable",
      mode: "unavailable",
      provider: provider.key,
      model: provider.model,
      error: "No scene assets available to assemble",
    };
  }

  const dir = jobDir(jobId);
  await ensureDir(dir);
  const outFile = path.join(dir, "draft.mp4");
  const listFile = path.join(dir, "scenes.txt");
  const fps = opts.fps ?? 25;

  // concat demuxer playlist (still image per scene, held for its duration)
  const list = scenes
    .map((s) => `file '${s.filePath.replace(/'/g, "'\\''")}'\nduration ${Math.max(0.6, s.durationSec).toFixed(2)}`)
    .concat([`file '${scenes[scenes.length - 1].filePath.replace(/'/g, "'\\''")}'`])
    .join("\n");
  await writeFile(listFile, list, "utf8");

  const filters = [
    `scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease`,
    `pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2:color=#05060a`,
    "format=yuv420p",
  ];
  if (opts.srtPath) {
    const escaped = opts.srtPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
    filters.push(
      `subtitles='${escaped}':force_style='FontName=DejaVu Sans,Fontsize=15,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=90'`,
    );
  }

  const args: string[] = ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile];
  if (opts.audioPath) args.push("-i", opts.audioPath);
  else args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");

  args.push(
    "-vf", filters.join(","),
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    "-movflags", "+faststart",
    outFile,
  );

  try {
    await execFileAsync(ffmpegPath, args, { maxBuffer: 1 << 24, timeout: 240_000 });
    const st = await stat(outFile);
    const durationSec = await probeDuration(outFile);
    await rm(listFile, { force: true });
    return {
      status: "generated",
      mode: "real_ai", // a genuinely rendered artifact
      provider: provider.key,
      model: provider.model,
      filePath: outFile,
      url: publicUrlFor(outFile),
      mimeType: "video/mp4",
      bytes: st.size,
      durationSec,
      costMicroUsd: 0,
    };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return {
      status: "failed",
      mode: "failed",
      provider: provider.key,
      model: provider.model,
      error: (e.stderr || e.message || "ffmpeg failed").slice(0, 400),
    };
  }
}

export function mediaProviderSummary() {
  const img = resolveImageProvider();
  const voice = resolveVoiceProvider();
  const render = resolveRenderProvider();
  return {
    image: { provider: img.key, model: img.model, real: img.real },
    voice: { provider: voice.key, model: voice.model, real: voice.real },
    render: { provider: render.key, model: render.model, real: render.real },
  };
}

/* ============================== THUMBNAIL =========================== */

/**
 * Generate a real 1280x720 YouTube thumbnail. Uses the configured image
 * provider when available; otherwise renders a genuine branded PNG
 * locally (labelled `fallback`). Never a placeholder file.
 */
export async function generateThumbnail(
  jobId: string,
  input: { title: string; overlayText: string; accent: string; channel: string; prompt: string },
): Promise<AssetResult> {
  const provider = resolveImageProvider();
  const dir = jobDir(jobId);
  await ensureDir(dir);
  const file = path.join(dir, "thumbnail.png");
  const W = 1280;
  const H = 720;

  if (provider.real && provider.key === "openai") {
    try {
      const res = await withRetry(
        () =>
          fetchJson<{ data: { b64_json?: string }[] }>(
            `${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/images/generations`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              },
              body: JSON.stringify({
                model: provider.model,
                prompt: `YouTube thumbnail, 16:9, bold high-contrast, no text: ${input.prompt}`,
                size: "1536x1024",
                n: 1,
              }),
            },
            90_000,
          ),
        { retries: 1, baseDelayMs: 1200, label: "thumbnail" },
      );
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new Error("image provider returned no data");
      const buf = Buffer.from(b64, "base64");
      await writeFile(file, buf);
      return {
        status: "generated",
        mode: "real_ai",
        provider: provider.key,
        model: provider.model,
        filePath: file,
        url: publicUrlFor(file),
        mimeType: "image/png",
        bytes: buf.length,
        costMicroUsd: 40_000,
      };
    } catch (err) {
      console.warn(
        `[media] AI thumbnail failed, using local renderer: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  try {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const words = input.overlayText.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      if ((line + " " + w).trim().length > 22) {
        if (line) lines.push(line.trim());
        line = w;
      } else line += ` ${w}`;
    }
    if (line.trim()) lines.push(line.trim());
    const shown = lines.slice(0, 3);
    const fs = 96;
    const startY = H / 2 - ((shown.length - 1) * fs * 1.15) / 2 + 20;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0d16"/><stop offset="60%" stop-color="#11151f"/><stop offset="100%" stop-color="#05060a"/>
    </linearGradient>
    <radialGradient id="gl" cx="22%" cy="28%" r="70%">
      <stop offset="0%" stop-color="${input.accent}" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="${input.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#gl)"/>
  <rect x="0" y="0" width="14" height="${H}" fill="${input.accent}"/>
  ${shown
    .map(
      (l, i) =>
        `<text x="70" y="${startY + i * fs * 1.15}" font-family="DejaVu Sans, sans-serif" font-size="${fs}" font-weight="bold" fill="#ffffff">${esc(l)}</text>`,
    )
    .join("\n  ")}
  <text x="70" y="${H - 60}" font-family="DejaVu Sans, sans-serif" font-size="34" fill="${input.accent}" letter-spacing="6">${esc(input.channel.toUpperCase())}</text>
</svg>`;
    const Resvg = loadResvg();
    const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
    await writeFile(file, png);
    return {
      status: "generated",
      mode: "fallback",
      provider: "local-svg",
      model: "thumbnail-renderer-v1",
      filePath: file,
      url: publicUrlFor(file),
      mimeType: "image/png",
      bytes: png.length,
      costMicroUsd: 0,
    };
  } catch (err) {
    return {
      status: "failed",
      mode: "failed",
      provider: "local-svg",
      model: "thumbnail-renderer-v1",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
