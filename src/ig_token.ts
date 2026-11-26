// Pasting a long-lived Instagram token on Settings stores it in the same D1 rows OAuth already uses
// (`settings.ig_token` and `settings.ig_token_at`). me(), DM sending, comment sync and the weekly refresh all read
// `ig_token`, so a pasted token behaves like the one `npm run setup` leaves after "Log in with Instagram".
// The token is never returned to the browser, logs, or these result codes.

import { IG_HANDLE } from "./brand";
import * as db from "./db";
import { fetchAccount, instagramWritesAllowed, subscribe, type Account } from "./meta";
import type { Env } from "./setter";

const MIN_LEN = 20;
const MAX_LEN = 2000;

export type IgCode =
  | "empty"
  | "invalid"
  | "saved"
  | "connected"
  | "preview"
  | "unreachable"
  | "rejected"
  | "wrong_account"
  | "removed"
  | "verified"
  | "verify_none"
  | "verify_preview"
  | "verify_fail"
  | "verify_rejected";

const NOTES: Record<IgCode, string> = {
  empty: "Paste an access token first.",
  invalid: "That does not look like an Instagram access token. Paste the long-lived token and try again.",
  saved: "Token saved.",
  connected: "Token saved. Instagram confirmed the connection.",
  preview: "Token saved. Preview mode skips the live Instagram check.",
  unreachable: "Token saved. Instagram could not be reached to confirm it.",
  rejected: "Token saved, but Instagram did not accept it.",
  wrong_account: "That token is for a different Instagram account, so it was not kept.",
  removed: "Token removed. Instagram is disconnected.",
  verified: "Instagram confirmed the connection.",
  verify_none: "No token saved yet. Paste one, or use Connect with Instagram.",
  verify_preview: "Preview mode skips the live Instagram check.",
  verify_fail: "Instagram could not be reached.",
  verify_rejected: "Instagram did not accept the saved token.",
};

export function igNote(code: string | null): string {
  if (!code || !(code in NOTES)) return "";
  return NOTES[code as IgCode];
}

// "Bearer <token>" and surrounding whitespace are common when copying from a dashboard.
export function normalizeToken(raw: string): string | null {
  const token = raw.trim().replace(/^Bearer\s+/i, "").trim();
  if (token.length < MIN_LEN || token.length > MAX_LEN) return null;
  if (!/^[A-Za-z0-9._\-]+$/.test(token)) return null;
  return token;
}

// Local preview (`wrangler dev` on localhost) must not depend on Instagram being reachable.
export function isPreviewHost(req: Request): boolean {
  const host = new URL(req.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.endsWith(".localhost");
}

// Session cookies are SameSite=Lax, which already blocks a cross-site form post. Basic auth can still be attached
// cross-site, so a posted Origin that does not match this host is refused. A missing Origin (scripts, curl) is allowed,
// matching the other /admin/settings posts.
export function crossSite(req: Request): boolean {
  const origin = req.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(req.url).origin;
  } catch {
    return true;
  }
}

export interface IgLink {
  connected: boolean;
  username: string | null;
  label: string;
}

export async function instagramLink(env: Env): Promise<IgLink> {
  const token = await db.getSetting(env.DB, "ig_token");
  if (!token) return { connected: false, username: null, label: "Not connected" };
  let username: string | null = null;
  try {
    const cur = JSON.parse((await db.getSetting(env.DB, "ig_profile")) ?? "null") as { username?: unknown } | null;
    if (cur && typeof cur.username === "string" && cur.username && !cur.username.includes(token)) username = cur.username;
  } catch {
    username = null;
  }
  if (username) return { connected: true, username, label: `Connected as @${username}` };
  return { connected: true, username: null, label: "Token saved" };
}

function refused(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : "";
  return /^instagram 4\d\d\b/.test(msg) || /\bcode 190\b/.test(msg);
}

function ambiguousAccount(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : "";
  return /more than one Instagram account/.test(msg);
}

function otherAccount(account: Account): boolean {
  if (!account.username || !IG_HANDLE || IG_HANDLE.startsWith("REPLACE")) return false;
  return account.username.toLowerCase() !== IG_HANDLE.toLowerCase();
}

function safeAccount(account: Account, token: string): Account {
  const keep = (v: string | undefined) => (v && !v.includes(token) ? v : undefined);
  return {
    id: keep(account.id),
    username: keep(account.username),
    name: keep(account.name),
    profile_picture_url: keep(account.profile_picture_url),
  };
}

async function remember(env: Env, account: Account, now: number): Promise<boolean> {
  if (!account.username) return false;
  await db.setSetting(
    env.DB,
    "ig_profile",
    JSON.stringify({ username: account.username, name: account.name ?? null, pic: account.profile_picture_url ?? null, at: now }),
  );
  return true;
}

async function persist(env: Env, token: string, now: number): Promise<void> {
  await db.setSetting(env.DB, "ig_token", token);
  await db.setSetting(env.DB, "ig_token_at", String(now));
  // Drop a previous account's cached name so a new paste does not keep showing the old @username.
  await env.DB.prepare(`DELETE FROM settings WHERE key = 'ig_profile'`).run();
}

// Best-effort: OAuth connect subscribes the account so DMs and comments arrive. A failure here still leaves the token
// in place (same as /auth/start, which saves the token before subscribe). A token for a different Instagram account
// is not kept: sending with it would act as that account.
async function confirm(env: Env, token: string, now: number, saved: boolean): Promise<IgCode> {
  try {
    const account = safeAccount(await fetchAccount(token), token);
    if (otherAccount(account)) {
      if (!saved) await clearInstagramToken(env);
      return "wrong_account";
    }
    if (saved) await persist(env, token, now);
    const named = await remember(env, account, now);
    if (account.id && !String(account.id).includes(token)) await db.setSetting(env.DB, "ig_account_id", account.id);
    if (instagramWritesAllowed()) await subscribe(token).catch(() => {});
    if (named) return saved ? "connected" : "verified";
    return "saved";
  } catch (e) {
    // A token assigned to several accounts has no safe default. Do not keep it.
    if (ambiguousAccount(e)) {
      if (!saved) await clearInstagramToken(env);
      return "wrong_account";
    }
    if (saved) await persist(env, token, now);
    if (refused(e)) return saved ? "rejected" : "verify_rejected";
    return saved ? "unreachable" : "verify_fail";
  }
}

export async function storeInstagramToken(env: Env, raw: string, opts: { preview: boolean; now?: number }): Promise<IgCode> {
  const now = opts.now ?? Date.now();
  if (!raw.trim()) return "empty";
  const token = normalizeToken(raw);
  if (!token) return "invalid";
  if (opts.preview) {
    await persist(env, token, now);
    return "preview";
  }
  return confirm(env, token, now, true);
}

export async function verifyInstagramToken(env: Env, opts: { preview: boolean; now?: number }): Promise<IgCode> {
  const token = await db.getSetting(env.DB, "ig_token");
  if (!token) return "verify_none";
  if (opts.preview) return "verify_preview";
  return confirm(env, token, opts.now ?? Date.now(), false);
}

// Same rows /auth deauthorize drops, plus the cached profile so the console stops showing the old account.
export async function clearInstagramToken(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM settings WHERE key IN ('ig_token', 'ig_token_at', 'ig_user_id', 'ig_profile')`).run();
}
