// Official Instagram API (Instagram Login) transport: webhooks in, Send API out, business-login OAuth
// for the token. App: AtlasChat (Instagram app id in META_IG_APP_ID).

import type { MessageUpdate, Part } from "./attachments";

const GRAPH = "https://graph.instagram.com/v26.0";
export const SCOPES = "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments";

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// X-Hub-Signature-256: "sha256=<hex>" over the raw body with the app secret.
export async function verifySignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = await hmacHex(secret, body);
  const got = header.slice(7);
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// signed_request on the deauthorize and data-deletion callbacks: "<sig>.<payload>", HMAC-SHA256 of the payload.
export async function parseSignedRequest(secret: string, sr: string | null): Promise<{ user_id: string } | null> {
  const [sig, payload] = (sr ?? "").split(".");
  if (!secret || !sig || !payload) return null;
  try {
    const expected = await hmacHex(secret, payload);
    const got = [...b64url(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (got !== expected) return null;
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
  const p = payload as { object?: string; entry?: { messaging?: { message?: RawMessaging["message"] & { reply_to?: { story?: { url?: string; id?: string } } } }[] }[] };
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
  const p = payload as { object?: string; entry?: { messaging?: RawMessaging[] }[] };
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
  const p = payload as {
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

export function parseWebhook(payload: unknown): MetaEvent[] {
  const p = payload as { object?: string; entry?: { id?: string; messaging?: RawMessaging[] }[] };
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
  value?: { id?: string; text?: string; from?: { id?: string; username?: string }; media?: { id?: string } };
}

// "comments" and "live_comments" webhook changes. Skips the account's own comments (including our public replies).
export function parseComments(payload: unknown): MetaComment[] {
  const p = payload as { object?: string; entry?: { id?: string; changes?: RawChange[] }[] };
  if (p?.object !== "instagram" || !Array.isArray(p.entry)) return [];
  const out: MetaComment[] = [];
  for (const entry of p.entry) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value;
      if ((ch.field !== "comments" && ch.field !== "live_comments") || !v?.id || !v.from?.id || !v.text) continue;
      if (v.from.id === entry.id) continue;
      out.push({ comment_id: v.id, lead_id: v.from.id, username: v.from.username ?? null, media_id: v.media?.id ?? null, text: v.text });
    }
  }
  return out;
}

export async function graph<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || body.error) throw new Error(`instagram ${res.status}${body.error?.code ? ` code ${body.error.code}` : ""}: ${body.error?.message ?? "request failed"}`);
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
  username?: string;
  name?: string;
  profile_picture_url?: string;
}

export async function fetchAccount(token: string): Promise<Account> {
  return graph<Account>(`/me?fields=username,name,profile_picture_url`, { headers: { Authorization: `Bearer ${token}` } });
}

export function authorizeUrl(appId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES, state });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

// code -> short-lived token -> 60-day token. Returns the long-lived token and the account's user id.
export async function exchangeCode(appId: string, secret: string, redirectUri: string, code: string): Promise<{ token: string; userId: string }> {
  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({ client_id: appId, client_secret: secret, grant_type: "authorization_code", redirect_uri: redirectUri, code }),
  });
  const short = (await res.json()) as { access_token?: string; user_id?: number | string; error_message?: string };
  if (!short.access_token) throw new Error(`oauth: ${short.error_message ?? res.status}`);
  const r = await fetch(
    `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: secret, access_token: short.access_token })}`,
  );
  const long = (await r.json()) as { access_token?: string; error?: { message?: string } };
  if (!long.access_token) throw new Error(`long-lived token: ${long.error?.message ?? r.status}`);
  return { token: long.access_token, userId: String(short.user_id) };
}

export async function refreshToken(token: string): Promise<string> {
  const r = await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`);
  const body = (await r.json()) as { access_token?: string };
  if (!body.access_token) throw new Error(`token refresh failed: ${r.status}`);
  return body.access_token;
}

export async function subscribe(token: string): Promise<void> {
  await graph(`/me/subscribed_apps?${new URLSearchParams({ subscribed_fields: "messages,messaging_postbacks,messaging_seen,comments,live_comments", access_token: token })}`, { method: "POST" });
}

// Instagram sends a heart as a bare "❤" (U+2764), which browsers draw as a white text glyph. One pictograph without the
// emoji variation selector that defaults to text gets it (U+FE0F), so it shows as the red emoji like in the app.
export const asEmoji = (e: string) => (/^(?!\p{Emoji_Presentation})\p{Extended_Pictographic}$/u.test(e) ? `${e}\uFE0F` : e);
