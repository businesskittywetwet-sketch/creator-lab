import { fetchJson, withRetry, NetworkError } from "@/engine/http";

/* ------------------------------------------------------------------ */
/*  Shared model client for production agents.                         */
/*                                                                     */
/*  Resolves OpenAI or Anthropic from environment variables and        */
/*  returns parsed JSON for a strict prompt contract. When no          */
/*  credentials exist, callers fall back to the deterministic          */
/*  composer — we never fabricate a "model response".                  */
/* ------------------------------------------------------------------ */

export type ModelInfo = { provider: "openai" | "anthropic"; model: string };

export function resolveModel(): ModelInfo | null {
  const wanted = process.env.AI_MODEL_PROVIDER;
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);

  if (wanted === "openai" && hasOpenAI)
    return { provider: "openai", model: process.env.OPENAI_MODEL ?? "gpt-4o-mini" };
  if (wanted === "anthropic" && hasAnthropic)
    return { provider: "anthropic", model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5" };
  if (!wanted || wanted === "auto") {
    if (hasAnthropic)
      return { provider: "anthropic", model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5" };
    if (hasOpenAI)
      return { provider: "openai", model: process.env.OPENAI_MODEL ?? "gpt-4o-mini" };
  }
  return null;
}

export function hasModelCredentials(): boolean {
  return resolveModel() !== null;
}

export function extractJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new NetworkError("Model returned no JSON object");
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice) as Record<string, unknown>;
  } catch {
    throw new NetworkError("Model returned unparseable JSON");
  }
}

/** Call the configured model and parse a JSON object response. */
export async function callModelJson(
  prompt: string,
  opts: { maxTokens?: number; temperature?: number; label?: string } = {},
): Promise<{ data: Record<string, unknown>; info: ModelInfo }> {
  const info = resolveModel();
  if (!info) throw new NetworkError("No AI model credentials configured");
  const { maxTokens = 1400, temperature = 0.6, label = "model" } = opts;

  if (info.provider === "openai") {
    const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const run = () =>
      fetchJson<{ choices: { message: { content: string } }[] }>(
        `${base}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: info.model,
            messages: [{ role: "user", content: prompt }],
            temperature,
            max_tokens: maxTokens,
            response_format: { type: "json_object" },
          }),
        },
        45_000,
      );
    const res = await withRetry(run, { retries: 2, baseDelayMs: 900, label });
    return { data: extractJsonObject(res.choices?.[0]?.message?.content ?? ""), info };
  }

  const run = () =>
    fetchJson<{ content: { type: string; text: string }[] }>(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: info.model,
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: "user", content: prompt }],
        }),
      },
      45_000,
    );
  const res = await withRetry(run, { retries: 2, baseDelayMs: 900, label });
  const text = res.content?.find((c) => c.type === "text")?.text ?? "";
  return { data: extractJsonObject(text), info };
}

/* ------------------------------ coercion --------------------------- */

export function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

export function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function asStringList(v: unknown, max = 12): string[] {
  return asArray(v)
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
}
