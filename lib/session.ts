import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OAuthDiscoveryState, StoredOAuthClientInformation, StoredOAuthTokens } from "@modelcontextprotocol/client";

/**
 * Per-visitor state, kept in the visitor's own browser.
 *
 * Every visitor signs in with their own Composio account, and their tokens
 * live in an encrypted, httpOnly cookie, never on the server. Nothing has to
 * persist between requests on the server, so the app runs on serverless hosts
 * (Vercel) where every request may land on a different instance.
 *
 * Route handlers wrap their work in `withSession`. Inside it, `session()` gives
 * the request's state; changes are written back as cookies when the work ends.
 */

export interface AuthState {
  /** Stable id for this visitor's sign-in; keys their in-memory caches. */
  sid: string;
  /** Redirect URL the OAuth client and tokens belong to. */
  redirectUrl?: string;
  /** The OAuth client registered with Composio for redirectUrl (dynamic client registration). */
  client?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  /** Instant spend counted against INSTANT_BUDGET_USD, in millionths of a dollar. */
  spentMicros: number;
  calls: number;
  /** True when at least one charge was assumed from a published rate. */
  estimated: boolean;
  /** Last sign-in failure, shown until the next attempt. */
  lastError: string | null;
}

/** A sign-in that was started but not finished, keyed by its OAuth state. */
export interface PendingSignIn {
  createdAt: number;
  codeVerifier: string;
  discovery?: OAuthDiscoveryState;
}

interface Context {
  auth: AuthState;
  authDirty: boolean;
  pending: Record<string, PendingSignIn>;
  pendingDirty: boolean;
  /** Money reserved by calls in flight in this request. */
  reservedMicros: number;
}

const AUTH_COOKIE = "gta6_auth";
const PENDING_COOKIE = "gta6_signin";
/** Browsers cap a cookie near 4KB; tokens can be larger, so the value is split. */
const CHUNK = 3600;
const MAX_CHUNKS = 6;
const AUTH_MAX_AGE = 60 * 60 * 24 * 30;
export const PENDING_TTL_MS = 30 * 60 * 1000;

const storage = new AsyncLocalStorage<Context>();

// ---------- Encryption ----------

let cachedKey: Buffer | null = null;

/**
 * SESSION_SECRET encrypts the cookies. It is required in production. In
 * development a random one is created once in .data/session-secret (git-ignored),
 * so a local restart doesn't sign you out.
 */
function key(): Buffer {
  if (cachedKey) return cachedKey;
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET is not set. Add a long random value in your host's environment variables.");
    }
    const file = path.join(process.cwd(), ".data", "session-secret");
    try {
      secret = readFileSync(file, "utf8").trim();
    } catch {
      secret = randomBytes(32).toString("base64url");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, secret, { mode: 0o600 });
    }
  }
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  cachedKey = createHash("sha256").update(secret).digest();
  return cachedKey;
}

/** A setup problem that blocks sign-in on this deployment, in words for the page. */
export function configError(): string | null {
  try {
    key();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Returns null for anything that doesn't decrypt: tampered, truncated, or sealed with another secret. */
function unseal<T>(sealed: string | undefined): T | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}

// ---------- Cookies ----------

type Jar = Awaited<ReturnType<typeof import("next/headers").cookies>>;

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // Lax keeps the cookie off cross-site POSTs, which covers sign-out CSRF.
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

function readChunked(jar: Jar, name: string): string | undefined {
  const parts: string[] = [];
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = jar.get(`${name}.${i}`)?.value;
    if (!part) break;
    parts.push(part);
  }
  return parts.length ? parts.join("") : undefined;
}

function writeChunked(jar: Jar, name: string, value: string | null, maxAge: number) {
  const parts = value ? value.match(new RegExp(`.{1,${CHUNK}}`, "g")) ?? [] : [];
  if (parts.length > MAX_CHUNKS) throw new Error("Session is too large to store in cookies");
  for (let i = 0; i < MAX_CHUNKS; i++) {
    if (i < parts.length) jar.set(`${name}.${i}`, parts[i], cookieOptions(maxAge));
    else if (jar.get(`${name}.${i}`)) jar.delete(`${name}.${i}`);
  }
}

const freshAuth = (): AuthState => ({
  sid: randomBytes(12).toString("base64url"),
  spentMicros: 0,
  calls: 0,
  estimated: false,
  lastError: null,
});

/** Run `fn` with this request's session; write the cookies back if anything changed. */
export async function withSession<T>(fn: () => Promise<T>): Promise<T> {
  // Loaded here, not at the top: plain Node (the unit tests) can't resolve next/headers.
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const auth = unseal<AuthState>(readChunked(jar, AUTH_COOKIE));
  const pending = unseal<Record<string, PendingSignIn>>(jar.get(PENDING_COOKIE)?.value) ?? {};
  const ctx: Context = { auth: auth ?? freshAuth(), authDirty: false, pending, pendingDirty: false, reservedMicros: 0 };
  try {
    return await storage.run(ctx, fn);
  } finally {
    if (ctx.authDirty) {
      const empty = !ctx.auth.tokens && !ctx.auth.client && !ctx.auth.lastError && ctx.auth.spentMicros === 0;
      writeChunked(jar, AUTH_COOKIE, empty ? null : seal(ctx.auth), AUTH_MAX_AGE);
    }
    if (ctx.pendingDirty) {
      const live = Object.keys(ctx.pending).length > 0;
      if (live) jar.set(PENDING_COOKIE, seal(ctx.pending), cookieOptions(PENDING_TTL_MS / 1000));
      else if (jar.get(PENDING_COOKIE)) jar.delete(PENDING_COOKIE);
    }
  }
}

/** The current request's session. Only valid inside `withSession`. */
function context(): Context {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("No session: wrap the route handler in withSession()");
  return ctx;
}

export const session = () => context().auth;
export const hasSession = () => storage.getStore() !== undefined;

export function updateSession(change: (auth: AuthState) => AuthState) {
  const ctx = context();
  ctx.auth = change(ctx.auth);
  ctx.authDirty = true;
}

/** Start over with a new visitor id (sign-out). */
export function resetSession() {
  const ctx = context();
  ctx.auth = freshAuth();
  ctx.authDirty = true;
}

export const pendingSignIns = () => context().pending;

export function updatePending(change: (pending: Record<string, PendingSignIn>) => Record<string, PendingSignIn>) {
  const ctx = context();
  ctx.pending = change(ctx.pending);
  ctx.pendingDirty = true;
}

/** Spend reserved by calls still in flight in this request. */
export function reserved(): number {
  return context().reservedMicros;
}

export function addReserved(micros: number) {
  context().reservedMicros += micros;
}
