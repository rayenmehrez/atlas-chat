// Non-text messages, stored as structure. `messages.text` stays the model-readable summary ("[voice note] "...""),
// `messages.attachments` holds what the webhook or the sync saw (types, ids, the signed URL of the moment), and
// `media_cache` holds what the message API says right now, keyed by mid, for MEDIA_TTL_MS. Instagram's CDN URLs are
// signed and expire, and the imported history never had any, so the Inbox asks the API by mid when a thread opens
// and serves the bytes through /admin/media/<message id>/<n> (console login only; the CDN URL never reaches the page).
// Nothing is copied: once Instagram drops the media, the thread shows the placeholder text.

import * as db from "./db";
import { graph, graphPath } from "./meta";

export type PartType =
  | "image"
  | "gif"
  | "sticker"
  | "video"
  | "audio"
  | "file"
  | "post"
  | "reel"
  | "story_reply"
  | "story_mention"
  | "story_share"
  | "like"
  | "card" // a button card (generic template): Manychat's lead magnets, our flow sends
  | "unsupported";

export interface Part {
  type: PartType;
  url?: string | null; // the media itself (signed CDN URL, short-lived)
  preview?: string | null; // poster / thumbnail
  id?: string | null; // attachment, media or story id
  title?: string | null; // share caption, file name
  author?: string | null; // @username of a shared post, when the API tells us (only for the owner's own posts)
  link?: string | null; // instagram.com permalink, when known
  mime?: string | null;
  buttons?: string[] | null; // card buttons, "Title" or "Title (https://...)" for link buttons
}

export interface Resolved {
  parts: Part[];
  reactions: string[];
}

export const MEDIA_TTL_MS = 60 * 60 * 1000; // resolved URLs and "nothing there" answers
const PRUNE_MS = 24 * 60 * 60 * 1000; // cache rows (Platform Data) never outlive a day
const PRERESOLVE = 12; // newest media messages resolved while the thread renders; older ones resolve when scrolled to
const PARALLEL = 6; // Instagram allows a few calls a second per account
const FETCH_MS = 10_000;

// Rich fields first; if Instagram rejects one (code 100), the plain set still says what kind of thing it was.
export const MSG_FIELDS = "id,attachments{id,mime_type,name,size,file_url,image_data,video_data,generic_template},shares{link,name,description,id},story,reactions,is_unsupported";
const MSG_FIELDS_PLAIN = "id,attachments{mime_type,file_url,image_data,video_data,generic_template},shares,story";

// ---------- Mapping ----------

interface ApiAttachment {
  id?: string;
  mime_type?: string;
  name?: string;
  file_url?: string;
  image_data?: { url?: string; preview_url?: string; animated_gif_url?: string; render_as_sticker?: boolean };
  video_data?: { url?: string; preview_url?: string };
  generic_template?: { title?: string; subtitle?: string; image_url?: string; cta?: { title?: string; type?: string; url?: string }[] };
}
export interface ApiMessageDetail {
  id: string;
  attachments?: { data?: ApiAttachment[] };
  shares?: { data?: { link?: string; name?: string; description?: string; id?: string }[] };
  story?: { reply_to?: { link?: string; id?: string }; mention?: { link?: string; id?: string } };
  reactions?: { data?: { reaction?: string }[] };
  is_unsupported?: boolean;
}

export const isPermalink = (u?: string | null) => Boolean(u && /^https:\/\/(www\.)?instagram\.com\//.test(u));

// The chat a message belongs to, on instagram.com. Every Instagram message id carries "<account id>:<thread id>:<item
// id>" in its base64 (at an offset), and instagram.com/direct/t/<that thread id> opens the chat (Instagram redirects the
// long id to its short one; checked 2026-11-24). Used where the API gives no link of its own: other people's posts come
// as a bare image (HEIC, which Chrome downloads instead of showing), and their media id maps to no instagram.com/p/ code.
export function threadLink(mid: string | null | undefined): string | null {
  if (!mid || mid.includes(":")) return null; // "pb:" postbacks, test ids
  const s = mid.replace(/-/g, "+").replace(/_/g, "/");
  for (let k = 0; k < 4; k++) {
    try {
      const t = atob(s.slice(k, k + Math.floor((s.length - k) / 4) * 4)).match(/\d{10,}:(\d{25,}):\d{10,}/);
      if (t) return `https://www.instagram.com/direct/t/${t[1]}/`;
    } catch {
      // not base64 at this offset
    }
  }
  return null;
}

// The webhook puts a reel's instagram.com link in `url`, where media goes. It's a page: make it the link, so nothing
// tries to load it as media (the proxy would hand back Instagram's HTML as a download).
const asLink = (p: Part): Part => (!p.link && isPermalink(p.url) ? { ...p, link: p.url, url: null } : p);

// A message from the message API (GET /<mid>, or the conversations edge) as parts.
export function partsFromApi(m: ApiMessageDetail): Part[] {
  const parts: Part[] = [];
  if (m.story?.reply_to) parts.push({ type: "story_reply", url: m.story.reply_to.link ?? null, id: m.story.reply_to.id ?? null });
  if (m.story?.mention) parts.push({ type: "story_mention", url: m.story.mention.link ?? null, id: m.story.mention.id ?? null });
  for (const a of m.attachments?.data ?? []) {
    const mime = a.mime_type ?? "";
    const base = { id: a.id ?? null, mime: mime || null };
    if (a.generic_template) {
      const g = a.generic_template;
      const buttons = (g.cta ?? []).filter((c) => c.title).map((c) => (c.url ? `${c.title} (${c.url})` : c.title!));
      parts.push({ ...base, type: "card", title: [g.title, g.subtitle].filter(Boolean).join("\n") || null, preview: g.image_url ?? null, buttons });
    } else if (a.image_data) {
      const i = a.image_data;
      const type: PartType = i.render_as_sticker ? "sticker" : i.animated_gif_url ? "gif" : "image";
      parts.push({ ...base, type, url: i.animated_gif_url ?? i.url ?? null, preview: i.preview_url ?? null });
    } else if (a.video_data) {
      // Voice notes come back as video_data with an audio mime type.
      parts.push({ ...base, type: mime.startsWith("audio") ? "audio" : "video", url: a.video_data.url ?? null, preview: a.video_data.preview_url ?? null });
    } else if (a.file_url) {
      const type: PartType = mime.startsWith("audio") ? "audio" : mime.startsWith("video") ? "video" : mime.startsWith("image") ? "image" : "file";
      parts.push({ ...base, type, url: a.file_url, title: a.name ?? null });
    } else {
      parts.push({ ...base, type: "unsupported" });
    }
  }
  for (const s of m.shares?.data ?? []) {
    const link = isPermalink(s.link) ? s.link! : null;
    parts.push({
      type: /\/reels?\//.test(s.link ?? "") ? "reel" : "post",
      id: s.id ?? null,
      url: link ? null : (s.link ?? null),
      link,
      title: s.description || s.name || null,
    });
  }
  if (m.is_unsupported && !parts.length) parts.push({ type: "unsupported" });
  return parts;
}

// ---------- Text summaries ----------

// The bracketed tags describe() / syncText() / media.ts put at the front of messages.text, plus the backfill's
// "[image]" / "[audio]" / "[video]" / "[attachment]".
const TAG_TYPE: Record<string, PartType | "story_prefix" | "attachment" | "unsent" | "tapped"> = {
  "voice note": "audio",
  audio: "audio",
  image: "image",
  video: "video",
  file: "file",
  "shared a post": "post",
  "shared a reel": "reel",
  "shared a story": "story_share",
  "mentioned you in their story": "story_mention",
  story_mention: "story_mention",
  "sent a heart": "like",
  like_heart: "like",
  "replying to your story": "story_prefix",
  attachment: "attachment",
  "unsent a message": "unsent",
  tapped: "tapped",
};

export interface Split {
  tags: { tag: string; note: string | null }[]; // leading tags, each with its transcript / description if any
  text: string; // what the person typed
  buttons: string[]; // our "[buttons: a | b]" line
}

export function splitText(text: string): Split {
  const tags: Split["tags"] = [];
  let rest = text;
  for (;;) {
    const m = rest.match(/^\s*\[([a-z_ ]+)\](?: "([^"]*)")?/);
    if (!m || !(m[1] in TAG_TYPE)) break;
    tags.push({ tag: m[1], note: m[2] ?? null });
    rest = rest.slice(m[0].length);
  }
  let buttons: string[] = [];
  const b = rest.match(/\n\[buttons: (.*)\]\s*$/);
  if (b) {
    buttons = b[1].split(" | ").map((s) => s.trim()).filter(Boolean);
    rest = rest.slice(0, b.index);
  }
  return { tags, text: rest.trim(), buttons };
}

export const tagType = (tag: string) => TAG_TYPE[tag];

// Parts a message's text implies, for rows with no stored structure (the imported history).
export function inferParts(s: Split): Part[] {
  return s.tags.flatMap((t): Part[] => {
    const k = TAG_TYPE[t.tag];
    if (k === "story_prefix") return [{ type: "story_reply" }];
    if (k === "attachment" || k === "unsent" || k === "tapped" || !k) return [];
    return [{ type: k }];
  });
}

// Whether a row could have media worth asking the API about.
export function wantsMedia(m: Pick<MediaRow, "text" | "attachments" | "mid" | "unsent_at">): boolean {
  if (!m.mid || m.mid.includes(":") || m.unsent_at) return false; // "pb:" postbacks, test ids
  if (m.attachments) return true;
  return splitText(m.text).tags.some((t) => TAG_TYPE[t.tag] !== "tapped" && TAG_TYPE[t.tag] !== "unsent");
}

// ---------- Storage ----------

export interface MediaRow extends db.Message {
  attachments?: string | null;
  reactions?: string | null;
  edited_at?: number | null;
  unsent_at?: number | null;
  reply_to?: string | null; // mid of the message this one answers (migrations/replies.sql)
}

// Webhook / sync structure for a recorded message. Never overwrites (an echo of our own template adds nothing).
export async function saveParts(d1: D1Database, mid: string, parts: Part[]): Promise<void> {
  if (!parts.length) return;
  await d1.prepare(`UPDATE messages SET attachments = ?2 WHERE mid = ?1 AND attachments IS NULL`).bind(mid, JSON.stringify(parts)).run();
}

// Which message `mid` replies to. The webhook and our own send both say it (whichever lands after the row exists wins);
// it never changes once set.
export async function saveReplyTo(d1: D1Database, mid: string, replyTo: string): Promise<void> {
  await d1.prepare(`UPDATE messages SET reply_to = ?2 WHERE mid = ?1 AND reply_to IS NULL`).bind(mid, replyTo).run();
}

export type MessageUpdate =
  | { kind: "reaction"; mid: string; who: "lead" | "you"; emoji: string | null }
  | { kind: "edit"; mid: string; text: string }
  | { kind: "unsend"; mid: string };

export async function applyUpdate(d1: D1Database, u: MessageUpdate, now: number): Promise<void> {
  if (u.kind === "reaction") {
    const path = `$.${u.who}`;
    await d1
      .prepare(`UPDATE messages SET reactions = CASE WHEN ?2 IS NULL THEN json_remove(COALESCE(reactions, '{}'), ?3) ELSE json_set(COALESCE(reactions, '{}'), ?3, ?2) END WHERE mid = ?1`)
      .bind(u.mid, u.emoji, path)
      .run();
  } else if (u.kind === "edit") {
    // Keep the leading tags (a story reply stays one); the typed part is what changed.
    const row = await d1.prepare(`SELECT text FROM messages WHERE mid = ?1`).bind(u.mid).first<{ text: string }>();
    if (!row) return;
    const prefix = splitText(row.text).tags.map((t) => `[${t.tag}]${t.note ? ` "${t.note}"` : ""}`).join(" ");
    await d1.prepare(`UPDATE messages SET text = ?2, edited_at = ?3 WHERE mid = ?1`).bind(u.mid, [prefix, u.text].filter(Boolean).join(" "), now).run();
  } else {
    // They took it back: drop what it said and showed (Platform Terms: delete when the user deletes).
    await d1.batch([
      d1.prepare(`UPDATE messages SET text = '[unsent a message]', attachments = NULL, reactions = NULL, unsent_at = ?2 WHERE mid = ?1`).bind(u.mid, now),
      d1.prepare(`DELETE FROM media_cache WHERE mid = ?1`).bind(u.mid),
    ]);
  }
}

export async function pruneMediaCache(d1: D1Database, now: number): Promise<void> {
  await d1.prepare(`DELETE FROM media_cache WHERE fetched_at < ?1`).bind(now - PRUNE_MS).run();
}

async function cached(d1: D1Database, mids: string[], now: number): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();
  if (!mids.length) return out;
  const { results } = await d1
    .prepare(`SELECT mid, data FROM media_cache WHERE mid IN (SELECT value FROM json_each(?1)) AND fetched_at > ?2`)
    .bind(JSON.stringify(mids), now - MEDIA_TTL_MS)
    .all<{ mid: string; data: string }>();
  for (const r of results) out.set(r.mid, JSON.parse(r.data) as Resolved);
  return out;
}

async function store(d1: D1Database, mid: string, r: Resolved, now: number): Promise<void> {
  await d1
    .prepare(`INSERT INTO media_cache (mid, data, fetched_at) VALUES (?1, ?2, ?3) ON CONFLICT (mid) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`)
    .bind(mid, JSON.stringify(r), now)
    .run();
}

// ---------- Resolving ----------

const transient = (e: unknown) => /code (4|17|32|613|2)\b|instagram 5\d\d/.test(String(e)); // rate limits, outages: don't cache

async function fetchDetail(token: string, mid: string): Promise<ApiMessageDetail> {
  const get = (fields: string) => graph<ApiMessageDetail>(`/${encodeURIComponent(mid)}?fields=${encodeURIComponent(fields)}`, { headers: { Authorization: `Bearer ${token}` } });
  try {
    return await get(MSG_FIELDS);
  } catch (e) {
    if (!/code 100\b/.test(String(e)) || /does not exist|deleted|nonexisting field \(id\)/i.test(String(e))) throw e;
    return get(MSG_FIELDS_PLAIN);
  }
}

// A shared post or reel of the owner's own: the media API knows its permalink, author and thumbnail. Anyone else's: no.
async function ownMedia(token: string, p: Part): Promise<Part> {
  if ((p.type !== "post" && p.type !== "reel") || !p.id || p.link) return p;
  try {
    const m = await graph<{ permalink?: string; username?: string; caption?: string; thumbnail_url?: string; media_url?: string; media_type?: string }>(
      `/${encodeURIComponent(p.id)}?fields=permalink,username,caption,thumbnail_url,media_url,media_type`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return {
      ...p,
      link: m.permalink ?? null,
      author: m.username ?? null,
      title: p.title || m.caption || null,
      preview: m.thumbnail_url ?? (m.media_type === "VIDEO" ? null : m.media_url) ?? p.preview ?? null,
      type: m.permalink?.includes("/reel/") ? "reel" : p.type,
    };
  } catch {
    return p;
  }
}

async function resolveOne(token: string, mid: string): Promise<Resolved> {
  const d = await fetchDetail(token, mid);
  const parts = await Promise.all(partsFromApi(d).map((p) => ownMedia(token, p)));
  return { parts, reactions: (d.reactions?.data ?? []).map((r) => r.reaction ?? "").filter(Boolean) };
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t);
  }));
}

// Instagram only gives details for a conversation's newest 20 messages by mid; older ones answer "deleted". The
// conversations edge (what the history import read) lists them with fields, so a thread's misses get one more try.
async function viaConversation(token: string, leadId: string, want: Set<string>): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();
  const fields = `messages.limit(100){${MSG_FIELDS}}`;
  const conv = await graph<{ data: { id: string; messages?: { data?: ApiMessageDetail[]; paging?: { next?: string } } }[] }>(
    `/me/conversations?platform=instagram&user_id=${encodeURIComponent(leadId)}&fields=${encodeURIComponent(fields)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  let page = conv.data[0]?.messages;
  for (let n = 0; page && n < 3; n++) {
    for (const m of page.data ?? []) if (want.has(m.id)) out.set(m.id, { parts: partsFromApi(m), reactions: (m.reactions?.data ?? []).map((r) => r.reaction ?? "").filter(Boolean) });
    if (out.size === want.size || !page.paging?.next) break;
    page = await graph(graphPath(page.paging.next), { headers: { Authorization: `Bearer ${token}` } });
  }
  return out;
}

// What each media message in a thread shows, for the rows given (newest last). Cached answers are used as they are;
// the newest PRERESOLVE misses are asked for now; older misses are left to the media proxy.
// Stops waiting after `budgetMs`: the page renders with what's in, the rest falls back to the proxy.
export async function resolveThread(d1: D1Database, token: string | null, leadId: string, rows: MediaRow[], now: number, budgetMs = 6000): Promise<Map<string, Resolved>> {
  const media = rows.filter(wantsMedia);
  const have = await cached(d1, media.map((m) => m.mid!), now);
  if (!token) return have;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([fill(d1, token, leadId, media, have, now), new Promise<void>((r) => (timer = setTimeout(r, budgetMs)))]);
  clearTimeout(timer);
  return new Map(have);
}

async function fill(d1: D1Database, token: string, leadId: string, media: MediaRow[], have: Map<string, Resolved>, now: number): Promise<void> {
  // Newest first: if the time budget runs out, what's left unresolved is the history further up, not the bottom.
  const todo = media.filter((m) => !have.has(m.mid!)).slice(-PRERESOLVE).map((m) => m.mid!).reverse();
  const missed = new Set<string>();
  await pool(todo, PARALLEL, async (mid) => {
    try {
      const r = await resolveOne(token, mid);
      have.set(mid, r);
      await store(d1, mid, r, now);
    } catch (e) {
      if (!transient(e)) missed.add(mid);
    }
  });
  if (missed.size) {
    const found = await viaConversation(token, leadId, missed).catch(() => new Map<string, Resolved>());
    for (const mid of missed) {
      const r = found.get(mid) ?? { parts: [], reactions: [] }; // nothing there: don't ask again for an hour
      if (found.has(mid)) have.set(mid, r);
      await store(d1, mid, r, now);
    }
  }
}

// The parts a row shows: a fresh API answer, else what the webhook stored, else what its text implies.
export function partsOf(m: MediaRow, r: Resolved | undefined): Part[] {
  if (r?.parts.length) return r.parts.map(asLink);
  if (m.attachments) {
    try {
      const p = JSON.parse(m.attachments) as Part[];
      if (Array.isArray(p) && p.length) return p.map(asLink);
    } catch {
      // fall through
    }
  }
  return inferParts(splitText(m.text));
}

// ---------- The media proxy ----------

const CDN = /(^|\.)(fbcdn\.net|fbsbx\.com|cdninstagram\.com|instagram\.com)$/;
const SAFE_TYPE = /^(image|video|audio)\/|^application\/(pdf|octet-stream)$/;

async function pull(url: string | null | undefined, range: string | null): Promise<Response | null> {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !CDN.test(u.hostname)) return null; // only Instagram's CDN, never an arbitrary URL // only Instagram's CDN, never an arbitrary URL
  // Instagram's links want a User-Agent (without one they redirect to a web page).
  const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" };
  if (range) headers.Range = range;
  const res = await fetch(u.toString(), { headers, signal: AbortSignal.timeout(FETCH_MS) }).catch(() => null);
  return res && (res.ok || res.status === 206) ? res : null;
}

// GET /admin/media/<message id>/<n>[/thumb]: the bytes of a message's nth part, fetched fresh from Instagram.
// Range requests pass through so Safari can play video and voice notes.
export async function mediaRoute(d1: D1Database, req: Request, pathname: string, reviewer: boolean, now = Date.now()): Promise<Response> {
  const m = pathname.match(/^\/admin\/media\/(\d+)\/(\d+)(\/thumb)?$/);
  if (!m || req.method !== "GET") return new Response("not found", { status: 404 });
  const row = await d1
    .prepare(`SELECT m.*, l.test FROM messages m JOIN leads l ON l.subscriber_id = m.subscriber_id WHERE m.id = ?1`)
    .bind(Number(m[1]))
    .first<MediaRow & { test: number }>();
  if (!row || !wantsMedia(row)) return new Response("not found", { status: 404 });
  if (reviewer && !row.test) return new Response("not allowed for the reviewer login", { status: 403 });
  const n = Number(m[2]);
  const thumb = Boolean(m[3]);
  const range = req.headers.get("Range");
  const pick = (parts: Part[]) => {
    const p = parts[n];
    if (!p) return null;
    return thumb ? (p.preview ?? (["image", "gif", "sticker", "post", "story_reply", "story_mention", "story_share"].includes(p.type) ? p.url : null)) : p.url;
  };

  let r = (await cached(d1, [row.mid!], now)).get(row.mid!);
  let res = await pull(pick(partsOf(row, r)), range);
  if (!res && !r) {
    // Nothing fresh: ask Instagram once and remember the answer either way.
    const token = await db.getSetting(d1, "ig_token");
    if (token) {
      try {
        r = await resolveOne(token, row.mid!);
      } catch (e) {
        r = transient(e) ? undefined : { parts: [], reactions: [] };
      }
      if (r) await store(d1, row.mid!, r, now);
      if (r?.parts.length) res = await pull(pick(r.parts), range);
    }
  }
  if (!res) return new Response("media unavailable", { status: 404, headers: { "Cache-Control": "private, max-age=300" } });
  const type = (res.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  const headers = new Headers({
    "Content-Type": SAFE_TYPE.test(type) ? type : "application/octet-stream",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Accept-Ranges": "bytes",
  });
  for (const h of ["Content-Length", "Content-Range"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  const part = partsOf(row, r)[n];
  if (part?.type === "file" || !SAFE_TYPE.test(type) || new URL(req.url).searchParams.has("dl")) {
    const name = (part?.title ?? "file").replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "file";
    headers.set("Content-Disposition", `attachment; filename="${name}"`);
  }
  return new Response(res.body, { status: res.status, headers });
}
