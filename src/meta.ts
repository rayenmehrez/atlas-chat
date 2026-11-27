// Official Instagram API transport: webhooks in, Send API out, business-login OAuth for the token.
// Two token kinds share this file:
// - Instagram Login (IG…): https://graph.instagram.com and /me/…
// - Instagram API with Unified Login (EA…, a Business Integration System User token): https://graph.facebook.com,
//   the account id from /me/assigned_instagram_accounts, then /{ig-user-id}/…
// App: AtlasChat (Instagram app id in META_IG_APP_ID).

import { AsyncLocalStorage } from "node:async_hooks";
import type { MessageUpdate, Part } from "./attachments";
import { IG_HANDLE } from "./brand";

export const IG_GRAPH = "https://graph.instagram.com/v26.0";
export const FB_GRAPH = "https://graph.facebook.com/v27.0";
export const SCOPES = "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments";

// Unified Login Business Integration System User tokens start with EA. Instagram Login user tokens start with IG.
// Anything else (including tests' short stand-in tokens) stays on the Instagram Login host, which is the old behavior.
export function isUnifiedLoginToken(token: string): boolean {
  return token.startsWith("EA");
}

export function graphOrigin(token: string | null | undefined): string {
  return token && isUnifiedLoginToken(token) ? FB_GRAPH : IG_GRAPH;
}

// paging.next is an absolute URL on whichever host Meta used. Callers pass it back through graph(), which
// reattaches the host that matches the token. Strip either host, with or without a version.
export function graphPath(urlOrPath: string): string {
  return urlOrPath.replace(/^https:\/\/graph\.(?:instagram|facebook)\.com(?:\/v[\d.]+)?/, "");
}

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// X-Hub-Signature-256: "sha256=<hex>" over the raw body with the app secret. Missing, empty, or wrong: reject.
export async function verifySignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const got = header.slice(7).trim();
  if (!/^[0-9a-f]{64}$/i.test(got)) return false;
  const expected = await hmacHex(secret, body);
  return safeEqual(got.toLowerCase(), expected);
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// signed_request on the deauthorize and data-deletion callbacks: "<sig>.<payload>", HMAC-SHA256 of the payload.
export async function parseSignedRequest(secret: string, sr: string | null): Promise<{ user_id: string } | null> {
  const [sig, payload] = (sr ?? "").split(".");
  if (!secret || !sig || !payload) return null;
  try {
    const expected = await hmacHex(secret, payload);
    const got = [...b64url(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (!safeEqual(got, expected)) return null;
    const data = JSON.parse(new TextDecoder().decode(b64url(payload))) as { user_id?: string | number };
    return data.user_id ? { user_id: String(data.user_id) } : null;
  } catch {
    return null; // not base64 / not JSON
  }
}

export interface MetaEvent {
  kind: "inbound" | "echo";
  lead_id: string; // IGSID of the other person
  mid: string;
  text: string;
  at: number;
  attachments: { type: string; url: string | null }[]; // media URLs (signed, short-lived): read them right away
  parts: Part[]; // the same, as structure (src/attachments.ts), for src/media.ts to read
  app_id: string | null; // set on echoes when an app sent the message (unverified on Instagram; see autonomy.ts)
}

interface RawMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    app_id?: string | number;
    attachments?: { type?: string; payload?: { url?: string } }[];
    reply_to?: { story?: unknown; mid?: string };
  };
}

const TAGS: Record<string, string> = {
  audio: "[voice note]",
  image: "[image]",
  media: "[image]",
  video: "[video]",
  file: "[file]",
  share: "[shared a post]",
  ig_post: "[shared a post]",
  ig_reel: "[shared a reel]",
  reel: "[shared a reel]",
  story_mention: "[mentioned you in their story]",
  ig_story: "[shared a story]",
  story: "[shared a story]",
  like_heart: "[sent a heart]",
};

function describe(m: NonNullable<RawMessaging["message"]>): string {
  const parts: string[] = [];
  if (m.reply_to?.story) parts.push("[replying to your story]");
  for (const a of dedupeShares(m.attachments ?? [])) {
    const t = a.type ?? "attachment";
    parts.push(TAGS[t] ?? `[${t}]`);
  }
  if (m.text) parts.push(m.text);
  return parts.join(" ").trim();
}

type RawAttachment = { type?: string; payload?: { url?: string; title?: string; ig_post_media_id?: string; reel_video_id?: string; sticker_id?: string | number; name?: string } };

// Nov 2025 - Feb 2026 a shared post came as both "share" and "ig_post": one post, not two.
function dedupeShares<T extends RawAttachment>(atts: T[]): T[] {
  const posts = new Set(atts.filter((a) => a.type === "ig_post").map((a) => a.payload?.ig_post_media_id ?? ""));
  return atts.filter((a) => a.type !== "share" || !posts.has(a.payload?.ig_post_media_id ?? ""));
}

// What a webhook message is made of, as structure for messages.attachments (src/attachments.ts renders it).
export function webhookParts(m: { reply_to?: { story?: { url?: string; id?: string } }; attachments?: RawAttachment[]; is_unsupported?: boolean }): Part[] {
  const out: Part[] = [];
  if (m.reply_to?.story) out.push({ type: "story_reply", url: m.reply_to.story.url ?? null, id: m.reply_to.story.id ?? null });
  for (const a of dedupeShares(m.attachments ?? [])) {
    const p = a.payload ?? {};
    const url = p.url ?? null;
    switch (a.type) {
      case "image":
      case "media":
        out.push({ type: p.sticker_id ? "sticker" : "image", url });
        break;
      case "video":
      case "audio":
        out.push({ type: a.type, url });
        break;
      case "file":
        out.push({ type: "file", url, title: p.name ?? null });
        break;
      case "share":
      case "ig_post":
        out.push({ type: "post", url, id: p.ig_post_media_id ?? null, title: p.title ?? null });
        break;
      case "ig_reel":
      case "reel":
        out.push({ type: "reel", url, id: p.reel_video_id ?? null, title: p.title ?? null });
        break;
      case "story_mention":
        out.push({ type: "story_mention", url });
        break;
      case "ig_story":
      case "story":
        out.push({ type: "story_share", url });
        break;
      case "like_heart":
        out.push({ type: "like" });
        break;
      case "template":
      case "fallback":
        break; // our own buttons: the thread already has them as text
      default:
        out.push({ type: "unsupported", url });
    }
  }
  if (m.is_unsupported && !out.length) out.push({ type: "unsupported" });
  return out;
}

// mid -> parts for every message in a webhook payload that has any.
export function parseParts(payload: unknown): Map<string, Part[]> {
  const out = new Map<string, Part[]>();
  const p = normalizeWebhook(payload) as { object?: string; entry?: { messaging?: { message?: RawMessaging["message"] & { reply_to?: { story?: { url?: string; id?: string } } } }[] }[] };
  if (p?.object !== "instagram" || !Array.isArray(p.entry)) return out;
  for (const entry of p.entry) {
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      if (!m?.mid || m.is_deleted) continue;
      const parts = webhookParts(m);
      if (parts.length) out.set(m.mid, parts);
    }
  }
  return out;
}

// mid -> the mid it replies to (swipe-to-reply), for theirs and for echoes of ours. Only the webhook says this: reading
// a message back through the API has no reply field, so it's saved now or never.
export function parseReplies(payload: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const p = normalizeWebhook(payload) as { object?: string; entry?: { messaging?: RawMessaging[] }[] };
  if (p?.object !== "instagram" || !Array.isArray(p.entry)) return out;
  for (const entry of p.entry) {
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      const to = m?.reply_to?.mid;
      if (m?.mid && !m.is_deleted && typeof to === "string" && to && to !== m.mid) out.set(m.mid, to);
    }
  }
  return out;
}

// Reactions, edits and unsends: small updates to a message we already have.
export function parseMessageUpdates(payload: unknown): MessageUpdate[] {
  const p = normalizeWebhook(payload) as {
    object?: string;
    entry?: {
      id?: string;
      messaging?: {
        sender?: { id?: string };
        message?: { mid?: string; is_deleted?: boolean };
        reaction?: { mid?: string; action?: string; emoji?: string };
        message_edit?: { mid?: string; text?: string };
      }[];
    }[];
  };
  if (p?.object !== "instagram" || !Array.isArray(p.entry)) return [];
  const out: MessageUpdate[] = [];
  for (const entry of p.entry) {
    for (const ev of entry.messaging ?? []) {
      if (ev.reaction?.mid) {
        const who = ev.sender?.id && ev.sender.id === entry.id ? "you" : "lead";
        out.push({ kind: "reaction", mid: ev.reaction.mid, who, emoji: ev.reaction.action === "unreact" ? null : asEmoji(ev.reaction.emoji ?? "\u2764") });
      }
      if (ev.message_edit?.mid && typeof ev.message_edit.text === "string") out.push({ kind: "edit", mid: ev.message_edit.mid, text: ev.message_edit.text });
      if (ev.message?.mid && ev.message.is_deleted) out.push({ kind: "unsend", mid: ev.message.mid });
    }
  }
  return out;
}

// Unified Login (and Facebook Login) can deliver the same events as `changes[]` instead of `messaging[]`,
// and a comment's id as `comment_id` rather than `id`. Instagram Login still uses `messaging[]` and `value.id`.
// Fold the changes-shaped events into `messaging` so every parser below sees one shape. Safe to call twice.
const MESSAGING_FIELDS = new Set(["messages", "message_reactions", "messaging_postbacks", "messaging_referral", "messaging_seen", "message_edit", "message_edits"]);

export function normalizeWebhook(payload: unknown): unknown {
  const p = payload as { object?: string; entry?: Record<string, unknown>[] };
  if (p?.object !== "instagram" || !Array.isArray(p.entry)) return payload;
  return {
    ...p,
    entry: p.entry.map((entry) => {
      const existing = Array.isArray(entry.messaging) ? (entry.messaging as unknown[]) : [];
      const changes = Array.isArray(entry.changes) ? (entry.changes as { field?: string; value?: unknown }[]) : [];
      const seen = new Set(existing.map((ev) => JSON.stringify(ev)));
      const messaging = [...existing];
      for (const ch of changes) {
        if (!ch?.field || !MESSAGING_FIELDS.has(ch.field) || !ch.value || typeof ch.value !== "object") continue;
        const key = JSON.stringify(ch.value);
        if (seen.has(key)) continue;
        seen.add(key);
        messaging.push(ch.value);
      }
      return { ...entry, messaging };
    }),
  };
}

export function parseWebhook(payload: unknown): MetaEvent[] {
  const p = normalizeWebhook(payload) as { object?: string; entry?: { id?: string; messaging?: RawMessaging[] }[] };
  if (p?.object !== "instagram" || !Array.isArray(p.entry)) return [];
  const events: MetaEvent[] = [];
  for (const entry of p.entry) {
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      if (!m?.mid || m.is_deleted || m.is_unsupported) continue;
      const text = describe(m);
      if (!text) continue;
      const echo = Boolean(m.is_echo);
      const lead_id = echo ? ev.recipient?.id : ev.sender?.id;
      if (!lead_id || lead_id === entry.id) continue;
      events.push({
        kind: echo ? "echo" : "inbound",
        lead_id,
        mid: m.mid,
        text,
        at: ev.timestamp ?? Date.now(),
        attachments: (m.attachments ?? []).map((a) => ({ type: a.type ?? "attachment", url: a.payload?.url ?? null })),
        parts: webhookParts(m as Parameters<typeof webhookParts>[0]),
        app_id: m.app_id ? String(m.app_id) : null,
      });
    }
  }
  return events;
}

export interface MetaComment {
  comment_id: string;
  lead_id: string; // commenter's IGSID
  username: string | null;
  media_id: string | null;
  text: string;
}

interface RawChange {
  field?: string;
  value?: { id?: string; comment_id?: string; text?: string; from?: { id?: string; username?: string }; media?: { id?: string } };
}

// "comments" and "live_comments" webhook changes. Skips the account's own comments (including our public replies).
// Instagram Login sends the comment id as `id`. Unified Login sends it as `comment_id`.
export function parseComments(payload: unknown): MetaComment[] {
  const p = payload as { object?: string; entry?: { id?: string; changes?: RawChange[] }[] };
  if (p?.object !== "instagram" || !Array.isArray(p.entry)) return [];
  const out: MetaComment[] = [];
  for (const entry of p.entry) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value;
      const commentId = v?.id ?? v?.comment_id;
      if ((ch.field !== "comments" && ch.field !== "live_comments") || !commentId || !v?.from?.id || !v.text) continue;
      if (v.from.id === entry.id) continue;
      out.push({ comment_id: commentId, lead_id: v.from.id, username: v.from.username ?? null, media_id: v.media?.id ?? null, text: v.text });
    }
  }
  return out;
}

// Drop access tokens out of anything that might be logged, stored, or shown. Meta sometimes echoes the token
// inside an error message, and a failed fetch can include the request URL.
export function redactSecrets(text: string, token?: string | null): string {
  let out = text;
  if (token && token.length >= 8) out = out.split(token).join("[token]");
  return out
    .replace(/\b(?:EA|IG)[A-Za-z0-9._-]{16,}\b/g, "[token]")
    .replace(/access_token=[^&\s'"]+/gi, "access_token=[token]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{16,}/gi, "Bearer [token]")
    .replace(/client_secret=[^&\s'"]+/gi, "client_secret=[secret]");
}

// Preview and localhost must not send DMs, post public replies, or change live subscriptions. The fetch handler
// (and the cron, when ATLAS_PREVIEW is set) runs inside this. Direct calls from tests have no store, so writes stay on.
const writePolicy = new AsyncLocalStorage<boolean>();

export function withInstagramWrites<T>(allowed: boolean, fn: () => Promise<T>): Promise<T> {
  return writePolicy.run(allowed, fn);
}

export function instagramWritesAllowed(): boolean {
  return writePolicy.getStore() !== false;
}

const PREVIEW_WRITE = "instagram: preview does not send or change the live account";

function assertCanMutate(method: string): void {
  if (method === "GET" || method === "HEAD") return;
  if (!instagramWritesAllowed()) throw new Error(PREVIEW_WRITE);
}

interface AssignedAccount {
  id?: string;
  user_id?: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
}

const accountCache = new Map<string, AssignedAccount>();

export function clearInstagramAccountCache(): void {
  accountCache.clear();
}

function bearer(init?: RequestInit): string | null {
  if (!init?.headers) return null;
  const auth = new Headers(init.headers).get("Authorization");
  const m = auth?.match(/^Bearer\s+(\S+)/i);
  return m?.[1] ?? null;
}

function accessTokenParam(path: string): string | null {
  const q = path.split("?")[1];
  if (!q) return null;
  return new URLSearchParams(q).get("access_token");
}

function stripAccessToken(path: string): string {
  const qIndex = path.indexOf("?");
  if (qIndex < 0 || !path.includes("access_token=")) return path;
  const params = new URLSearchParams(path.slice(qIndex + 1));
  if (!params.has("access_token")) return path;
  params.delete("access_token");
  const s = params.toString();
  return s ? `${path.slice(0, qIndex)}?${s}` : path.slice(0, qIndex);
}

function needsAccountId(path: string): boolean {
  if (path.startsWith("/me/assigned_instagram_accounts")) return false;
  return path === "/me" || path.startsWith("/me/") || path.startsWith("/me?");
}

function pickAssigned(rows: AssignedAccount[]): AssignedAccount {
  const list = rows.filter((a) => a.id);
  if (!list.length) throw new Error("instagram 400: no assigned Instagram account");
  const prefer = IG_HANDLE && !IG_HANDLE.startsWith("REPLACE") ? IG_HANDLE.toLowerCase() : "";
  if (prefer) {
    const match = list.find((a) => (a.username ?? "").toLowerCase() === prefer);
    if (match) return match;
  }
  if (list.length === 1) return list[0];
  throw new Error("instagram 400: this token is assigned to more than one Instagram account");
}

async function loadUnifiedAccount(token: string): Promise<AssignedAccount> {
  const hit = accountCache.get(token);
  if (hit?.id) return hit;
  const body = await graph<{ data?: AssignedAccount[] }>(`/me/assigned_instagram_accounts?fields=id,username,name,profile_picture_url`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const account = pickAssigned(body.data ?? []);
  accountCache.set(token, account);
  return account;
}

// The Instagram professional account id (1784…). Unified Login reads it from assigned_instagram_accounts.
// Instagram Login still reads user_id from /me.
export async function instagramAccountId(token: string): Promise<string> {
  if (isUnifiedLoginToken(token)) {
    const account = await loadUnifiedAccount(token);
    if (!account.id) throw new Error("instagram 400: no assigned Instagram account");
    return account.id;
  }
  // `id` on /me is app-scoped. Conversations and webhooks use `user_id` (the same value Unified Login returns).
  const me = await graph<{ user_id?: string }>(`/me?fields=user_id`, { headers: { Authorization: `Bearer ${token}` } });
  if (!me.user_id) throw new Error("instagram: no user id");
  return String(me.user_id);
}

export async function graph<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  assertCanMutate(method);
  const token = bearer(init) ?? accessTokenParam(path);
  let urlPath = stripAccessToken(graphPath(path));
  if (token && isUnifiedLoginToken(token) && needsAccountId(urlPath)) {
    const id = await instagramAccountId(token);
    urlPath = urlPath.replace(/^\/me(?=\/|\?|$)/, `/${id}`);
  }
  const headers = new Headers(init?.headers);
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(`${graphOrigin(token)}${urlPath}`, { ...init, headers });
  } catch (e) {
    throw new Error(`instagram: ${redactSecrets(e instanceof Error ? e.message : String(e), token)}`);
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || body.error) {
    const message = redactSecrets(body.error?.message ?? "request failed", token);
    throw new Error(`instagram ${res.status}${body.error?.code ? ` code ${body.error.code}` : ""}: ${message}`);
  }
  return body;
}

// `replyTo` quotes one of the thread's messages above the text, like swiping to reply in the app.
export async function sendText(token: string, leadId: string, text: string, replyTo?: string): Promise<string> {
  const body = await graph<{ message_id: string }>("/me/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: leadId }, message: { text }, ...(replyTo ? { reply_to: { mid: replyTo } } : {}) }),
  });
  return body.message_id;
}

// "Seen" and the typing dots on the lead's side. Typing turns itself off when the message lands.
export async function senderAction(token: string, leadId: string, action: "mark_seen" | "typing_on" | "typing_off"): Promise<void> {
  await graph("/me/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: leadId }, sender_action: action }),
  });
}

// React to a message with any emoji, or take our reaction off (emoji null).
export async function react(token: string, leadId: string, mid: string, emoji: string | null): Promise<void> {
  await graph("/me/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: leadId },
      sender_action: emoji ? "react" : "unreact",
      payload: emoji ? { message_id: mid, reaction: emoji } : { message_id: mid },
    }),
  });
}

// Private reply: a DM to whoever left the comment. One per comment, within 7 days of it.
export async function privateReply(token: string, commentId: string, text: string): Promise<{ lead_id: string; mid: string }> {
  const body = await graph<{ recipient_id: string; message_id: string }>("/me/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
  });
  return { lead_id: body.recipient_id, mid: body.message_id };
}

export async function replyToComment(token: string, commentId: string, text: string): Promise<void> {
  await graph(`/${commentId}/replies?${new URLSearchParams({ message: text })}`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

export interface Media {
  id: string;
  caption?: string;
  permalink?: string;
  timestamp?: string;
  media_product_type?: string; // FEED | REELS | AD
}

export async function recentMedia(token: string, limit = 25): Promise<Media[]> {
  const q = new URLSearchParams({ fields: "id,caption,permalink,timestamp,media_product_type", limit: String(limit) });
  return (await graph<{ data: Media[] }>(`/me/media?${q}`, { headers: { Authorization: `Bearer ${token}` } })).data;
}

export interface Story {
  id: string; // the same id a story reply's webhook carries in reply_to.story.id
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string; // videos only
  timestamp?: string;
}

// Stories that are up right now (the last 24h), newest first: what a story-reply automation can be pinned to.
export async function recentStories(token: string): Promise<Story[]> {
  const q = new URLSearchParams({ fields: "id,media_type,media_url,thumbnail_url,timestamp" });
  return (await graph<{ data: Story[] }>(`/me/stories?${q}`, { headers: { Authorization: `Bearer ${token}` } })).data;
}

export async function fetchProfile(token: string, leadId: string): Promise<{ username: string | null; name: string | null; pic: string | null }> {
  try {
    const p = await graph<{ username?: string; name?: string; profile_pic?: string }>(`/${leadId}?fields=name,username,profile_pic`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { username: p.username ?? null, name: p.name ?? null, pic: p.profile_pic ?? null };
  } catch {
    return { username: null, name: null, pic: null };
  }
}

export interface Account {
  id?: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
}

export async function fetchAccount(token: string): Promise<Account> {
  if (isUnifiedLoginToken(token)) {
    const account = await loadUnifiedAccount(token);
    return {
      id: account.id,
      username: account.username,
      name: account.name,
      profile_picture_url: account.profile_picture_url,
    };
  }
  return graph<Account>(`/me?fields=username,name,profile_picture_url`, { headers: { Authorization: `Bearer ${token}` } });
}

export function authorizeUrl(appId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES, state });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

// code -> short-lived token -> 60-day token. Returns the long-lived token and the account's user id.
export async function exchangeCode(appId: string, secret: string, redirectUri: string, code: string): Promise<{ token: string; userId: string }> {
  let res: Response;
  try {
    res = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: new URLSearchParams({ client_id: appId, client_secret: secret, grant_type: "authorization_code", redirect_uri: redirectUri, code }),
    });
  } catch (e) {
    throw new Error(`oauth: ${redactSecrets(e instanceof Error ? e.message : String(e), secret)}`);
  }
  const short = (await res.json()) as { access_token?: string; user_id?: number | string; error_message?: string };
  if (!short.access_token) throw new Error(`oauth: ${redactSecrets(short.error_message ?? String(res.status), secret)}`);
  let r: Response;
  try {
    r = await fetch(
      `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: secret, access_token: short.access_token })}`,
    );
  } catch (e) {
    throw new Error(`long-lived token: ${redactSecrets(redactSecrets(e instanceof Error ? e.message : String(e), secret), short.access_token)}`);
  }
  const long = (await r.json()) as { access_token?: string; error?: { message?: string } };
  if (!long.access_token) throw new Error(`long-lived token: ${redactSecrets(redactSecrets(long.error?.message ?? String(r.status), secret), short.access_token)}`);
  return { token: long.access_token, userId: String(short.user_id) };
}

// null: leave the saved token exactly as it is. Unified Login system-user tokens are not refreshed with
// grant_type=ig_refresh_token (that call is for Instagram Login only, and a failure must not clear the EA token).
// Preview also returns null so a local cron cannot rotate a live token.
export async function refreshToken(token: string): Promise<string | null> {
  if (!instagramWritesAllowed() || isUnifiedLoginToken(token)) return null;
  let r: Response;
  try {
    r = await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`);
  } catch (e) {
    throw new Error(`token refresh failed: ${redactSecrets(e instanceof Error ? e.message : String(e), token)}`);
  }
  const body = (await r.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string } };
  if (!body.access_token) throw new Error(`token refresh failed: ${r.status}${body.error?.message ? `: ${redactSecrets(body.error.message, token)}` : ""}`);
  return body.access_token;
}

// Instagram Login's subscribed fields. Unified Login uses the instagram_* names from Meta's migration guide
// (message_reactions and messaging_referral are how button taps and ig.me opens arrive on that setup).
const IG_SUBSCRIBED_FIELDS = "messages,messaging_postbacks,messaging_seen,comments,live_comments";
const UNIFIED_SUBSCRIBED_FIELDS = "messages,message_reactions,messaging_postbacks,messaging_referral,messaging_seen,comments,live_comments";

export async function subscribe(token: string): Promise<void> {
  // Local preview must not change the live account's webhook subscription.
  if (!instagramWritesAllowed()) return;
  const fields = isUnifiedLoginToken(token) ? UNIFIED_SUBSCRIBED_FIELDS : IG_SUBSCRIBED_FIELDS;
  const q = new URLSearchParams({ subscribed_fields: fields });
  await graph(`/me/subscribed_apps?${q}`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

// Instagram sends a heart as a bare "❤" (U+2764), which browsers draw as a white text glyph. One pictograph without the
// emoji variation selector that defaults to text gets it (U+FE0F), so it shows as the red emoji like in the app.
export const asEmoji = (e: string) => (/^(?!\p{Emoji_Presentation})\p{Extended_Pictographic}$/u.test(e) ? `${e}\uFE0F` : e);
