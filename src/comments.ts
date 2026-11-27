// Comment-to-DM: a comment matching a trigger keyword gets a private reply DM,
// plus an optional public reply under the comment. When the commenter answers the DM, the setter takes over.

import { isTest } from "./db";
import { logError } from "./health";
import { recordBot, startCommentFlow } from "./flows";
import { recentMedia, redactSecrets, replyToComment, type MetaComment } from "./meta";

export interface Trigger {
  id: number;
  keyword: string;
  media_id: string | null;
  dm: string;
  public_reply: string | null;
  enabled: number;
  created_at: number;
  source: "comment" | "dm" | "story" | "mention" | "welcome" | "none";
  name: string | null;
  button_title: string | null;
  button_url: string | null;
  next_title: string | null;
  quick_replies: string | null;
  draft: string | null; // the editor's unpublished graph (JSON)
  folder: string | null;
  updated_at: number | null;
  published_at: number | null;
  deleted_at: number | null; // in Trash
}

// "Next Post or Reel": a comment trigger published with this as its post waits for the first post or
// reel that goes up after that, locks onto it, and from then on works like any post trigger. One waits at a time.
export const NEXT_POST = "next";

// Locks the waiting trigger onto the first post published since it was armed (Publish, or switching it back on). Runs
// from the cron every minute and before matching each comment, so a comment that beats the cron to a brand-new post
// still gets its DM. A comment on a post we've seen comments on from before arming skips the Instagram call.
export async function lockNextPost(db: D1Database, token: string | null, now: number, mediaId?: string | null): Promise<void> {
  const armed = await db
    .prepare(`SELECT id, published_at FROM triggers WHERE source = 'comment' AND media_id = ?1 AND enabled = 1 AND deleted_at IS NULL ORDER BY published_at LIMIT 1`)
    .bind(NEXT_POST)
    .first<{ id: number; published_at: number }>();
  if (!armed || !token) return;
  if (mediaId && (await db.prepare(`SELECT 1 FROM comments WHERE media_id = ?1 AND created_at < ?2 LIMIT 1`).bind(mediaId, armed.published_at).first())) return;
  const first = (await recentMedia(token, 10))
    .filter((m) => m.media_product_type !== "AD" && Date.parse(m.timestamp ?? "") >= armed.published_at)
    .sort((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!))[0];
  if (!first) return;
  await db
    .prepare(
      `UPDATE triggers SET media_id = ?2, updated_at = ?3,
         draft = CASE WHEN json_extract(draft, '$.trigger.media_id') = ?4 THEN json_set(draft, '$.trigger.media_id', ?2) ELSE draft END
       WHERE id = ?1 AND media_id = ?4`,
    )
    .bind(armed.id, first.id, now, NEXT_POST)
    .run();
}

const words = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

// Comma-separated keywords: any one of them matching is enough.
export function matches(keyword: string, comment: string): boolean {
  return keyword.split(",").some((k) => {
    if (k.trim() === "*") return true;
    const kw = words(k);
    return kw.trim() !== "" && words(comment).includes(kw);
  });
}

// Post-specific triggers win over account-wide ones; oldest first within each.
export async function findTrigger(db: D1Database, c: MetaComment): Promise<Trigger | null> {
  const { results } = await db
    .prepare(`SELECT * FROM triggers WHERE enabled = 1 AND deleted_at IS NULL AND source = 'comment' AND (media_id IS NULL OR media_id = ?1) ORDER BY media_id IS NULL, id`)
    .bind(c.media_id)
    .all<Trigger>();
  return results.find((t) => matches(t.keyword, c.text)) ?? null;
}

const pick = (lines: string, rand = Math.random()) => {
  const opts = lines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return opts.length ? opts[Math.floor(rand * opts.length)] : null;
};

// Instagram allows 750 private replies an hour per account; stay under it with room to spare. Past the budget, or
// when Instagram says slow down, the comment waits (status queued) and the cron sends it later, oldest first. A
// private reply is allowed up to 7 days after the comment.
export const HOURLY_BUDGET = 700;
const HOUR = 60 * 60 * 1000;
const REPLY_WINDOW_MS = 7 * 24 * HOUR;
// Worth another try later: rate limits and Instagram/network hiccups. Anything else (comment deleted, already
// answered, bad template) fails for good.
const RETRYABLE = /rate|limit|too many|temporar|try again|timeout|timed out|network|fetch failed|instagram 5\d\d|code (1|2|4|17|32|613|80002)\b|2534040|thread does not exist/i;
// Instagram says this when the account has opened too many new conversations. It clears on its own. Wait an hour
// between tries, and don't send those retries while a newer comment is still being refused.
const THROTTLED = /thread does not exist/i;
const THROTTLE_COOL_MS = 10 * 60_000;

const sentLastHour = async (db: D1Database, now: number) =>
  (await db.prepare(`SELECT COUNT(*) n FROM comments WHERE sent_at > ?1`).bind(now - HOUR).first<{ n: number }>())?.n ?? 0;

export async function handleComment(db: D1Database, token: string | null, skoolLink: string, c: MetaComment, now: number): Promise<void> {
  const ins = await db
    .prepare(
      `INSERT OR IGNORE INTO comments (comment_id, subscriber_id, username, media_id, text, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'ignored', ?6)`,
    )
    .bind(c.comment_id, c.lead_id, c.username, c.media_id, c.text, now)
    .run();
  if (!ins.meta.changes) return; // webhook retry, or the backfill already saw it
  await lockNextPost(db, token, now, c.media_id).catch((e) => logError(db, "next post lock", c.media_id, e, now));
  const trigger = await findTrigger(db, c);
  if (!trigger) return;
  if ((await sentLastHour(db, now)) >= HOURLY_BUDGET) {
    await db.prepare(`UPDATE comments SET status = 'queued', trigger_id = ?2, retry_at = ?3 WHERE comment_id = ?1`).bind(c.comment_id, trigger.id, now).run();
    return;
  }
  await sendCommentDm(db, token, skoolLink, c, trigger, now, now);
}

// The private reply (and the public one) for a matched comment. `at` = when the comment came in.
async function sendCommentDm(db: D1Database, token: string | null, skoolLink: string, c: MetaComment, trigger: Trigger, at: number, now: number): Promise<void> {
  // One DM per person per trigger, so a lead commenting the keyword twice isn't spammed.
  const repeat = await db
    .prepare(`SELECT 1 FROM comments WHERE subscriber_id = ?1 AND trigger_id = ?2 AND status = 'sent' AND comment_id != ?3`)
    .bind(c.lead_id, trigger.id, c.comment_id)
    .first();
  if (repeat) {
    await db.prepare(`UPDATE comments SET status = 'repeat', trigger_id = ?2 WHERE comment_id = ?1`).bind(c.comment_id, trigger.id).run();
    return;
  }

  try {
    if (!token) throw new Error("instagram not connected: open /auth/start");
    // The flow's first message is the private reply (buttons and quick replies ride along, see flows.ts). Only a
    // tap or a reply opens the 24h window, so the rest of the flow waits for that.
    const sent = await startCommentFlow({ DB: db, SKOOL_LINK: skoolLink }, token, trigger, c.comment_id, c.lead_id, c.text, now);
    if (!sent) {
      await db.prepare(`UPDATE comments SET status = 'repeat', trigger_id = ?2 WHERE comment_id = ?1`).bind(c.comment_id, trigger.id).run();
      return;
    }
    // The comment goes into the thread as context for the setter, then our DM. No last_inbound_at: a comment
    // doesn't open the 24h window, so nothing else sends until the lead answers the DM.
    await db.batch([
      db
        .prepare(
          `INSERT INTO leads (subscriber_id, username, created_at, test) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (subscriber_id) DO UPDATE SET username = COALESCE(excluded.username, username), test = MAX(test, excluded.test)`,
        )
        .bind(sent.lead_id, c.username, now, isTest(c.text) ? 1 : 0),
      db
        .prepare(`INSERT INTO messages (subscriber_id, role, text, created_at) VALUES (?1, 'lead', ?2, ?3)`)
        .bind(sent.lead_id, `[commented on your post] ${c.text}`, now),
      recordBot(db, sent.lead_id, sent.text, sent.mid, now),
      db.prepare(`UPDATE comments SET status = 'sent', trigger_id = ?2, sent_at = ?3, error = NULL WHERE comment_id = ?1`).bind(c.comment_id, trigger.id, now),
    ]);
  } catch (e) {
    const row = await db.prepare(`SELECT attempts FROM comments WHERE comment_id = ?1`).bind(c.comment_id).first<{ attempts: number }>();
    const attempts = (row?.attempts ?? 0) + 1;
    const retry = RETRYABLE.test(String(e)) && attempts < 12 && now - at < REPLY_WINDOW_MS;
    // 2, 4, 8 ... minutes, capped at an hour. A new-conversation throttle waits a full hour.
    const throttled = THROTTLED.test(String(e));
    const wait = throttled ? HOUR : Math.min(HOUR, 2 ** attempts * 60_000);
    await db
      .prepare(`UPDATE comments SET status = ?2, trigger_id = ?3, error = ?4, attempts = ?5, retry_at = ?6 WHERE comment_id = ?1`)
      .bind(c.comment_id, retry ? "queued" : "failed", trigger.id, redactSecrets(String(e)), attempts, retry ? now + wait : null)
      .run();
    if (throttled) {
      await db.prepare(`INSERT INTO settings (key, value) VALUES ('comment_throttled_at', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(String(now)).run();
    }
    return;
  }

  const reply = trigger.public_reply ? pick(trigger.public_reply) : null;
  if (reply && token) await replyToComment(token, c.comment_id, reply).catch((e) => logError(db, "public reply", c.comment_id, e, now));
}

// The keyword a refused commenter is told to DM. None when the automation has no public reply, or the keyword is "*".
const offer = (t: { keyword: string; public_reply: string | null }) =>
  t.public_reply?.trim() ? t.keyword.split(",").map((k) => k.trim()).find((k) => k && k !== "*") : undefined;

const FALLBACK_REPLIES = [
  "insta's limiting my auto DMs since so many people commented 😅 DM me {kw} and i'll send it right over",
  "this normally hits your DMs automatically but insta's capping me rn from all the comments. DM me {kw} and it's yours",
  "insta only lets me start so many new chats at once. if you DM me {kw} first it goes straight through",
];

// When Instagram refuses the private reply as too many new conversations, one public reply tells them to DM the
// keyword. A conversation they open isn't under that cap. Newest first, at most 8 a minute, once per comment.
export async function tellRefused(db: D1Database, token: string | null, now: number): Promise<number> {
  if (!token) return 0;
  const { results } = await db
    .prepare(
      `SELECT c.comment_id, t.keyword, t.public_reply FROM comments c JOIN triggers t ON t.id = c.trigger_id
       WHERE c.status = 'queued' AND c.fallback_at IS NULL AND c.error LIKE '%thread does not exist%' AND c.created_at > ?1
         AND NOT EXISTS (SELECT 1 FROM flow_starts f WHERE f.trigger_id = c.trigger_id AND f.subscriber_id = c.subscriber_id AND f.status = 'sent')
       ORDER BY c.created_at DESC LIMIT 8`,
    )
    .bind(now - REPLY_WINDOW_MS)
    .all<{ comment_id: string; keyword: string; public_reply: string | null }>();
  if (!results.length) return 0;
  for (const r of results) {
    const kw = offer(r);
    if (kw) {
      const text = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)].replace("{kw}", kw.toUpperCase());
      await replyToComment(token, r.comment_id, text).catch((e) => logError(db, "public reply", r.comment_id, e, now));
    }
    await db.prepare(`UPDATE comments SET fallback_at = ?2 WHERE comment_id = ?1`).bind(r.comment_id, kw ? now : 0).run();
  }
  return results.length;
}

// Cron: send queued private replies, oldest first, inside what's left of the hour's budget (at most 40 a minute so a
// backlog drains steadily instead of in one burst). Past the 7-day window they expire.
export async function drainComments(db: D1Database, token: string | null, skoolLink: string, now: number): Promise<number> {
  await db.prepare(`UPDATE comments SET status = 'expired' WHERE status = 'queued' AND created_at < ?1`).bind(now - REPLY_WINDOW_MS).run();
  await tellRefused(db, token, now).catch((e) => logError(db, "refused comment reply", null, e, now));
  const room = Math.min(40, HOURLY_BUDGET - (await sentLastHour(db, now)));
  if (room <= 0) return 0;
  const last = Number((await db.prepare(`SELECT value FROM settings WHERE key = 'comment_throttled_at'`).first<{ value: string }>())?.value ?? 0);
  const throttledRoom = now - last > THROTTLE_COOL_MS ? Math.min(4, room) : 0;
  const { results } = await db
    .prepare(
      `SELECT * FROM (SELECT * FROM comments WHERE status = 'queued' AND retry_at <= ?1 AND (error IS NULL OR error NOT LIKE '%thread does not exist%') ORDER BY created_at LIMIT ?2)
       UNION ALL
       SELECT * FROM (SELECT * FROM comments WHERE status = 'queued' AND retry_at <= ?1 AND error LIKE '%thread does not exist%' ORDER BY created_at LIMIT ?3)`,
    )
    .bind(now, room - throttledRoom, throttledRoom)
    .all<{ comment_id: string; subscriber_id: string; username: string | null; media_id: string | null; text: string; trigger_id: number; created_at: number }>();
  for (const r of results) {
    const trigger = await db.prepare(`SELECT * FROM triggers WHERE id = ?1 AND enabled = 1 AND deleted_at IS NULL`).bind(r.trigger_id).first<Trigger>();
    if (!trigger) {
      await db.prepare(`UPDATE comments SET status = 'ignored' WHERE comment_id = ?1`).bind(r.comment_id).run();
      continue;
    }
    const c: MetaComment = { comment_id: r.comment_id, lead_id: r.subscriber_id, username: r.username, media_id: r.media_id, text: r.text };
    await sendCommentDm(db, token, skoolLink, c, trigger, r.created_at, now);
  }
  return results.length;
}
