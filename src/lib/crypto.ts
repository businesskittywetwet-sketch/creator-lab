import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/* ------------------------------------------------------------------ */
/*  Envelope encryption for OAuth tokens at rest.                      */
/*                                                                     */
/*  Tokens are NEVER stored in plaintext. The key is derived from an   */
/*  environment secret (TOKEN_ENCRYPTION_KEY) — so a database dump     */
/*  alone is useless without the runtime environment.                  */
/*                                                                     */
/*  Server-only module: importing this from a client component will    */
/*  fail the build because node:crypto is not bundled for the browser. */
/* ------------------------------------------------------------------ */

const ALGO = "aes-256-gcm";

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      "TOKEN_ENCRYPTION_KEY is not configured. OAuth tokens cannot be stored or read securely.",
    );
  }
}

function keyMaterial(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) throw new MissingEncryptionKeyError();
  // Derive a stable 32-byte key from an arbitrary-length secret.
  return createHash("sha256").update(secret).digest();
}

export function encryptionConfigured(): boolean {
  const s = process.env.TOKEN_ENCRYPTION_KEY;
  return Boolean(s && s.length >= 16);
}

/** Encrypt a JSON-serialisable payload. Returns `v1.iv.tag.ciphertext` (base64url). */
export function encryptJson(payload: unknown): string {
  const key = keyMaterial();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

/** Decrypt a payload produced by `encryptJson`. Returns null if unreadable. */
export function decryptJson<T>(blob: string | null | undefined): T | null {
  if (!blob) return null;
  try {
    const [version, ivB64, tagB64, ctB64] = blob.split(".");
    if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) return null;
    const key = keyMaterial();
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(pt.toString("utf8")) as T;
  } catch {
    // Wrong key, tampered ciphertext, or corrupt data — never throw the
    // underlying error, which could echo key/token fragments into logs.
    return null;
  }
}

/* ----------------------------- OAuth state ------------------------- */

/** Constant-time comparison for CSRF state / secret checks. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/* --------------------------- log redaction ------------------------- */

const SECRET_PATTERNS: RegExp[] = [
  /ya29\.[A-Za-z0-9._\-]+/g, // Google access tokens
  /1\/\/[A-Za-z0-9._\-]{20,}/g, // Google refresh tokens
  /\bGOCSPX-[A-Za-z0-9._\-]+/g, // Google client secrets
  /\bsk-[A-Za-z0-9]{16,}/g,
  /"(access_token|refresh_token|client_secret|id_token)"\s*:\s*"[^"]*"/gi,
];

/**
 * Strip anything token-shaped from a string before it is logged or
 * persisted. Applied to every external API error surface.
 */
export function redact(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

export function redactUnknown(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return redact(msg);
}
