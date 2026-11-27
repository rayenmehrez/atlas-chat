// Safety net for the webhook: Instagram has silently stopped delivering for half an hour at a time. Every cron tick,
// ask the conversations API for the most recently active threads and record any message we don't have, exactly as
// if the webhook had brought it (inbound = a lead message, echo = ours or the owner's, which pauses the AI like a live
// one... except that a missed send of ours can't be told apart from Manychat's here (the API has no app_id), so
// it's recorded without pausing the AI). Only a thread's missing tail is appended, never anything older than
// what's stored, so threads stay in order. Group chats come only this way (the webhook never brings them) and each is
// its own conversation (`syncGroup`).

import { MSG_FIELDS, partsFromApi, saveParts, type ApiMessageDetail, type Part } from "./attachments";
import * as db from "./db";
import { fetchProfile, graph, graphPath, instagramAccountId } from "./meta";
import { saveProfile } from "./profiles";
import type { Env } from "./setter";

// The account's Instagram id as conversations report it (17841...). Not settings.ig_user_id, which is OAuth's
// app-scoped id. Looked up once (Instagram Login: /me user_id; Unified Login: assigned_instagram_accounts) and cached.
const ME_KEY = "ig_account_id";
const OVERLAP_MS = 2 * 60 * 1000; // re-check a little behind the watermark: updated_time and our clock can disagree
const MAX_PAGES = 4; // 100 threads a tick is plenty; a longer outage is what scripts/backfill.mjs is for

interface ApiMessage extends Omit<ApiMessageDetail, "attachments"> {
  id: string;
  created_time: string;
  from?: { id: string; username?: string };
  message?: string;
  attachments?: ApiMessageDetail["attachments"];
}
interface ApiConversation {
  id: string;
  updated_time: string;
  participants?: { data?: { id: string; username?: string }[] };
  messages?: { data?: ApiMessage[] };
}

const PART_TAG: Partial<Record<Part["type"], string>> = {
  audio: "[voice note]",
  image: "[image]",
  gif: "[image]",
  sticker: "[image]",
  video: "[video]",
  file: "[file]",
  post: "[shared a post]",
  reel: "[shared a reel]",
  story_mention: "[mentioned you in their story]",
};

// The same summary the webhook writes, from the API's fields (the plain field set only has mime types).
export const syncText = (m: ApiMessage) => {
  const parts = partsFromApi(m).filter((p) => p.type !== "unsupported");
  if (parts.length) {
    const tags = parts.map((p) => (p.type === "story_reply" ? "[replying to your story]" : (PART_TAG[p.type] ?? "[attachment]")));
    return [...tags, m.message ?? ""].join(" ").trim();
  }
  return m.message || (m.attachments?.data?.length ? `[${(m.attachments.data[0].mime_type ?? "attachment").split("/")[0]}]` : "[attachment]");
};

// Rich fields so missed messages get their structure too; if Instagram rejects them (code 100), the old set.
let richFields = true;

export async function syncRecent(env: Env, now: number): Promise<number> {
  const token = await db.getSetting(env.DB, "ig_token");
  if (!token) return 0;
  let me = await db.getSetting(env.DB, ME_KEY);
  if (!me) {
    me = await instagramAccountId(token);
    await db.setSetting(env.DB, ME_KEY, me);
  }
  const watermark = Number((await db.getSetting(env.DB, "sync_at")) ?? 0);
  const fields = `id,participants,updated_time,messages.limit(20){created_time,from,message,${richFields ? MSG_FIELDS : "id,attachments{mime_type}"}}`;
  let next: string | undefined = `/me/conversations?platform=instagram&limit=25&fields=${encodeURIComponent(fields)}`;
  let newest = watermark;
  let added = 0;
  for (let pageNo = 0; next && pageNo < MAX_PAGES; pageNo++) {
    let page: { data: ApiConversation[]; paging?: { next?: string } };
    try {
      page = await graph(graphPath(next), { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      if (!richFields || pageNo || !/code 100\b/.test(String(e))) throw e;
      richFields = false;
      console.error("sync: rich message fields rejected, using the plain ones:", e);
      return syncRecent(env, now);
    }
    let reachedOld = false;
    for (const c of page.data) {
      const updated = Date.parse(c.updated_time);
      if (updated < watermark - OVERLAP_MS) {
        reachedOld = true;
        break;
      }
      newest = Math.max(newest, updated);
      const others = (c.participants?.data ?? []).filter((p) => p.id !== me);
      if (others.length > 1) {
        added += await syncGroup(env, c, others, me);
        continue;
      }
      const other = others[0];
      if (!other) continue;
      added += await syncThread(env, token, other, c.messages?.data ?? [], me);
    }
    next = reachedOld ? undefined : page.paging?.next;
  }
  // First run: start the watermark at now so we don't walk the whole history (the backfill does that).
  await db.setSetting(env.DB, "sync_at", String(watermark ? newest : now));
  return added;
}

async function syncThread(env: Env, token: string, other: { id: string; username?: string }, msgs: ApiMessage[], me: string): Promise<number> {
  const lead = await db.getLead(env.DB, other.id);
  const after = lead?.last_at ?? 0;
  const sorted = [...msgs].sort((a, b) => Date.parse(a.created_time) - Date.parse(b.created_time));
  let added = 0;
  for (const m of sorted) {
    const at = Date.parse(m.created_time);
    if (at <= after) continue; // only the missing tail
    const known = await env.DB.prepare(`SELECT 1 FROM messages WHERE mid = ?1`).bind(m.id).first();
    if (known) continue;
    const text = syncText(m);
    if (m.from?.id === me) {
      // Someone on our side answered: stale drafts and nudges go, but no pause (could have been Manychat).
      if (await db.recordEcho(env.DB, other.id, text, m.id, at)) {
        await env.DB.prepare(`UPDATE leads SET followup_due_at = NULL WHERE subscriber_id = ?1`).bind(other.id).run();
      }
    } else {
      const known = await db.getLead(env.DB, other.id);
      const profile = known?.username ? null : await fetchProfile(token, other.id);
      await db.recordInbound(env.DB, { subscriber_id: other.id, username: profile?.username ?? other.username ?? null, first_name: profile?.name ?? null, text, mid: m.id }, at);
      if (profile) await saveProfile(env.DB, other.id, profile, Date.now());
    }
    await saveParts(env.DB, m.id, partsFromApi(m).filter((p) => p.type !== "unsupported" || !m.message));
    added++;
  }
  if (added) console.log(`sync: recorded ${added} missed message(s) for ${other.username ?? other.id}`);
  return added;
}

// A group's id from its conversation id ("aWdfZAG06" + the thread id in base64), the same thread id every message id
// carries. Anything else shaped: the conversation id itself.
const CONV_PREFIX = "aWdfZAG06";
export function groupId(conversationId: string): string {
  let thread = conversationId;
  try {
    const t = atob(conversationId.slice(CONV_PREFIX.length));
    if (conversationId.startsWith(CONV_PREFIX) && /^\d+$/.test(t)) thread = t;
  } catch {
    // not base64: keep the id
  }
  return `g:${thread}`;
}

// A group chat is its own conversation: who's in it, and each message with who wrote it. Nothing here touches the
// AI (no last_inbound_at, no pauses, no drafts). A message already filed under one member as their DMs (the webhook,
// or the history import before 2026-11-01) moves into the group.
async function syncGroup(env: Env, c: ApiConversation, members: { id: string; username?: string }[], me: string): Promise<number> {
  const id = groupId(c.id);
  const msgs = [...(c.messages?.data ?? [])].sort((a, b) => Date.parse(a.created_time) - Date.parse(b.created_time));
  await env.DB.prepare(
    `INSERT INTO leads (subscriber_id, members, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (subscriber_id) DO UPDATE SET members = excluded.members`,
  )
    .bind(id, JSON.stringify(members.map((p) => ({ id: p.id, username: p.username ?? null }))), msgs[0] ? Date.parse(msgs[0].created_time) : Date.now())
    .run();
  const after = (await db.getLead(env.DB, id))?.last_at ?? 0;
  const moved = new Set<string>();
  let added = 0;
  for (const m of msgs) {
    const sender = m.from?.id && m.from.id !== me ? m.from.id : null;
    const role = sender ? "lead" : "bot";
    const known = await env.DB.prepare(`SELECT subscriber_id FROM messages WHERE mid = ?1`).bind(m.id).first<{ subscriber_id: string }>();
    if (known) {
      if (known.subscriber_id !== id) {
        await env.DB.prepare(`UPDATE messages SET subscriber_id = ?2, role = ?3, sender = ?4 WHERE mid = ?1`).bind(m.id, id, role, sender).run();
        moved.add(known.subscriber_id);
      }
      continue;
    }
    const at = Date.parse(m.created_time);
    if (at <= after) continue; // only the missing tail
    await env.DB.prepare(`INSERT OR IGNORE INTO messages (subscriber_id, role, text, created_at, mid, sender) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(id, role, syncText(m), at, m.id, sender)
      .run();
    await saveParts(env.DB, m.id, partsFromApi(m).filter((p) => p.type !== "unsupported" || !m.message));
    added++;
  }
  if (moved.size) for (const lead of [...moved, id]) await db.repoint(env.DB, lead);
  return added;
}
