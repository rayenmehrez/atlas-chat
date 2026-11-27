// Missed-comment backfill: the comments webhook sometimes drops events (the 2026-10-28 outage lost half an hour), and a
// lost keyword comment is a lost DM. Every few minutes this reads the newest comments on the posts our comment
// automations listen to and sends any it hasn't seen through the same handler as the webhook. Comments are stored by
// id, so one already handled (by the webhook or an earlier pass) is skipped.

import { handleComment, NEXT_POST } from "./comments";
import * as db from "./db";
import { alert } from "./health";
import { graph, graphPath } from "./meta";
import type { Env } from "./setter";

const EVERY_MS = 3 * 60_000;
const OVERLAP_MS = 10 * 60_000; // re-read a little behind the watermark: Instagram's timestamps and our clock differ
const RECENT_POSTS = 10; // account-wide automations listen everywhere; the newest posts are where comments land

interface RawComment {
  id: string;
  text?: string;
  timestamp?: string;
  from?: { id?: string; username?: string };
}

export async function syncComments(env: Env, now: number): Promise<number> {
  const last = Number((await db.getSetting(env.DB, "comments_sync_at")) ?? 0);
  if (now - last < EVERY_MS) return 0;
  await db.setSetting(env.DB, "comments_sync_at", String(now));
  const token = await db.getSetting(env.DB, "ig_token");
  if (!token) return 0;
  // First run: start from now, so comments from before (handled by Manychat or nobody) are never DMed late.
  const since = Number((await db.getSetting(env.DB, "comments_watermark")) ?? 0);
  if (!since) {
    await db.setSetting(env.DB, "comments_watermark", String(now));
    return 0;
  }

  const { results: triggers } = await env.DB.prepare(
    `SELECT DISTINCT media_id FROM triggers WHERE source = 'comment' AND enabled = 1 AND deleted_at IS NULL`,
  ).all<{ media_id: string | null }>();
  if (!triggers.length) return 0;
  const media = new Set(triggers.map((t) => t.media_id).filter((m): m is string => Boolean(m) && m !== NEXT_POST)); // a waiting Next Post has no post yet
  if (triggers.some((t) => !t.media_id)) {
    const recent = await graph<{ data: { id: string }[] }>(`/me/media?fields=id&limit=${RECENT_POSTS}`, { headers: { Authorization: `Bearer ${token}` } });
    for (const m of recent.data) media.add(m.id);
  }
  const me = await db.getSetting(env.DB, "ig_account_id");
  const from = since - OVERLAP_MS;
  let newest = since;
  let handled = 0;
  for (const mediaId of media) {
    // Newest first: page until the comments are older than the watermark (a viral post can have hundreds in minutes).
    let url: string | null = `/${mediaId}/comments?fields=id,text,timestamp,from&limit=50`;
    for (let page = 0; url && page < 10; page++) {
      const res: { data: RawComment[]; paging?: { next?: string } } = await graph(url, { headers: { Authorization: `Bearer ${token}` } });
      let older = false;
      for (const c of res.data) {
        const at = Date.parse(c.timestamp ?? "");
        if (!Number.isFinite(at) || at < from) {
          older = true;
          continue;
        }
        newest = Math.max(newest, at);
        if (!c.from?.id || !c.text || c.from.id === me) continue; // our own public replies
        const seen = await env.DB.prepare(`SELECT 1 FROM comments WHERE comment_id = ?1`).bind(c.id).first();
        if (seen) continue;
        await handleComment(env.DB, token, env.SKOOL_LINK, { comment_id: c.id, lead_id: c.from.id, username: c.from.username ?? null, media_id: mediaId, text: c.text }, now);
        handled++;
      }
      url = !older && res.paging?.next ? graphPath(res.paging.next) : null;
    }
  }
  await db.setSetting(env.DB, "comments_watermark", String(newest));
  if (handled) console.log(`comment sync: ${handled} comments the webhook missed`);
  if (handled >= 3) await alert(env, "missed-comments", `webhook missed ${handled} comments`, "The backfill caught and answered them, but Instagram's comment webhook is dropping events. Check the Meta app's webhook.", now);
  return handled;
}
