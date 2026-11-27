import { refreshProfiles } from "./profiles";
import { syncRecent } from "./sync";
import { DISCLOSE, DISCLOSURE, AUTOPILOT_MAX_DELAY_MS, clearOutgoing, leadsNeedingFollowUp, lockLead, markOutgoing, resumeManualPauses, scheduleFollowUp, unlockLead } from "./autonomy";
import { decide, FOLLOW_UP_ASK, type Decision } from "./brain";
import { pruneMediaCache, saveReplyTo } from "./attachments";
import * as db from "./db";
import { logError } from "./health";
import { fillTracked, leadMagnet, liveMagnets } from "./links";
import { liveKnowledge } from "./learn";
import { aiBlocker } from "./ready";
import { customerLine } from "./roster";
import { ping } from "./live";
import { enrichPending } from "./media";
import { findByIgId, sendBubbles } from "./manychat";
import { isUnifiedLoginToken, react, redactSecrets, refreshToken, senderAction, sendText } from "./meta";
import { meter } from "./usage";

export interface Env {
  DB: D1Database;
  AI: Ai; // Workers AI: Whisper for voice notes
  ANTHROPIC_API_KEY: string;
  MANYCHAT_API_KEY: string;
  INBOUND_SECRET: string;
  ADMIN_PASSWORD: string;
  REVIEW_PASSWORD: string; // Meta App Review login: sees and answers SETTERTEST threads only
  SKOOL_LINK: string;
  AUTOPILOT: string;
  REPLY_DELAY_MIN_S: string;
  REPLY_DELAY_MAX_S: string;
  TRANSPORT: string; // "meta" | "manychat"
  META_IG_APP_ID: string;
  META_APP_SECRET: string; // Instagram app secret (API setup with Instagram login)
  META_VERIFY_TOKEN: string;
  ATLAS_PREVIEW?: string; // "true" on the local preview: no live Instagram writes (sends, replies, subscriptions, token refresh)
  SKOOL_AUTH_TOKEN?: string;
  ALERT_TOPIC?: string; // ntfy.sh topic for phone alerts (src/health.ts) // The owner's Skool auth_token cookie (one-year JWT): reads new members for join matching
  TYPING?: string; // "true": autopilot sends show seen + typing and pause per bubble
  SEND_QUEUE?: Queue<SendJob>; // autopilot sends run as queue jobs (typing pauses outlast a webhook's waitUntil)
  LIVE?: DurableObjectNamespace; // real-time Inbox: open tabs' WebSockets (src/live.ts)
}

export interface SendJob {
  draft_id: number;
  typing_at?: number; // the fast path showed "typing..." from this ms while the model wrote; it counts toward bubble 1
}

// How long "typing..." shows for a bubble: 100 words a minute (500 characters, 120ms each), so a "W" is quick and a
// real answer takes a while. At least 1s, at most 20s (Instagram drops the dots after about 20s), never the same twice.
export function typingMs(text: string, rand = Math.random()): number {
  return Math.round(Math.min(20_000, Math.max(1000, text.length * 120)) * (0.85 + rand * 0.3));
}
export const pace = { sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

const TOKEN_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

// Sends bubbles in order. Leads who came in through Manychat answer back through it (Meta can't reach them at
// Standard access); everyone else goes through the Instagram API. Returns Instagram message ids where known.
const NOT_OWNER = /not the thread owner/i;

async function deliver(
  env: Env,
  lead: db.Lead,
  bubbles: string[],
  replyTo?: string,
  human = false,
  typingAt?: number,
  stop?: () => Promise<boolean>,
): Promise<(string | null)[]> {
  if (env.TRANSPORT !== "meta" || lead.mc_id) {
    await sendBubbles(env.MANYCHAT_API_KEY, lead.mc_id ?? lead.subscriber_id, bubbles);
    return bubbles.map(() => null);
  }
  const token = await db.getSetting(env.DB, "ig_token");
  if (!token) throw new Error("instagram not connected: open /auth/start");
  const mids: string[] = [];
  try {
    for (const text of bubbles) {
      if (human) {
        // Read it, then type each bubble. Cosmetic: a failed indicator never blocks the message. When the fast path
        // already marked it seen and typed while the model wrote, that time counts toward the first bubble.
        const typedSince = !mids.length && typingAt ? typingAt : null;
        if (!mids.length && !typedSince) await senderAction(token, lead.subscriber_id, "mark_seen").then(() => pace.sleep(800 + Math.random() * 1200)).catch(() => {});
        await senderAction(token, lead.subscriber_id, "typing_on").catch(() => {});
        await pace.sleep(Math.max(0, typingMs(text) - (typedSince ? Date.now() - typedSince : 0)));
      }
      if (stop && (await stop())) break; // they wrote in the middle of it: drop the rest, their message gets its own reply
      mids.push(await sendText(token, lead.subscriber_id, text, mids.length ? undefined : replyTo));
    }
  } catch (e) {
    // Instagram's conversation routing gives Manychat every thread its flows start, and an Instagram Login app can't
    // take one over ("not the thread owner"). Manychat's own send API still answers inside them, so switch this lead
    // to it for good.
    if (mids.length || !NOT_OWNER.test(String(e)) || !env.MANYCHAT_API_KEY) throw e;
    const mc = await findByIgId(env.MANYCHAT_API_KEY, lead.subscriber_id, lead.first_name);
    if (!mc) throw e;
    await env.DB.prepare(`UPDATE leads SET mc_id = ?2 WHERE subscriber_id = ?1`).bind(lead.subscriber_id, mc).run();
    await sendBubbles(env.MANYCHAT_API_KEY, mc, bubbles);
    return bubbles.map(() => null);
  }
  return mids;
}

// Leads often send 2-3 messages in a burst; wait this long after the last one before drafting.
export const QUIET_MS = 45_000;
const DRAFTS_AT_ONCE = 5;
// How much of the thread the model reads. Replies are 2-3 bubbles, so a hot conversation passes 40 messages in about
// 15 minutes: at 40, @dex.044's answer to the bottleneck question, the pitch and the Skool link had scrolled out,
// the model asked and pitched all over again, and he clocked it as a bot (2026-10-29).
const HISTORY = 200;

export function sendDelayMs(env: Env, rand = Math.random()): number {
  const min = Number(env.REPLY_DELAY_MIN_S) * 1000;
  const max = Number(env.REPLY_DELAY_MAX_S) * 1000;
  return Math.round(min + rand * Math.max(0, max - min));
}

// Autopilot sends within Meta's 30 seconds, so the configured delay is capped.
export const autopilotDelayMs = (env: Env, rand = Math.random()) => Math.min(sendDelayMs(env, rand), AUTOPILOT_MAX_DELAY_MS);

// The AI runs on a thread when the master switch is on, or when the owner turned it on for just this lead.
export const aiOn = (env: Env, lead: Pick<db.Lead, "ai_on">) => env.AUTOPILOT === "true" || lead.ai_on === 1;

// Autopilot sends only on active threads, plus a handoff's own hold-on line: the handoff pauses the thread the moment
// it's drafted, and the line still has to go out.
export const sendable = (lead: Pick<db.Lead, "status" | "paused_reason">, draft: Pick<db.Draft, "action">) =>
  lead.status === "active" || (draft.action === "handoff" && lead.status === "paused" && lead.paused_reason === "handoff");

// What a decision does to the lead once it's made (flag/handoff) or sent (stop).
export function leadStatusAfter(action: Decision["action"]): db.Lead["status"] | null {
  return action === "flag" ? "flagged" : action === "handoff" ? "paused" : null;
}

// Drafts the next move: a reply when the lead spoke last, a nudge ("follow_up") when we did and they went quiet.
// Returns the new draft, or null when there was nothing to do (or another pass is already on it).
// Nothing after the lead's last message, or only bubbles our own earlier reply was still sending when they wrote it
// (those don't answer it). Anything else (a newer lead message, the owner by hand, a Manychat flow) does.
async function onlyOurs(env: Env, leadId: string, lastLeadId: number, after: { role: string; text: string }[]): Promise<boolean> {
  if (!after.length) return true;
  if (after.some((m) => m.role !== "bot")) return false;
  // (or the hold-on line of a handoff that answered it: after a resume, the AI still owes the real answer)
  const prev = await env.DB.prepare(
    `SELECT bubbles FROM drafts WHERE subscriber_id = ?1 AND (after_message_id < ?2 OR action = 'handoff') AND status IN ('sending', 'sent') ORDER BY id DESC LIMIT 1`,
  )
    .bind(leadId, lastLeadId)
    .first<{ bubbles: string }>();
  const ours = new Set(JSON.parse(prev?.bubbles ?? "[]") as string[]);
  return after.every((m) => ours.has(m.text));
}

export async function draftFor(env: Env, lead: db.Lead, now: number, mode: "reply" | "follow_up" = "reply"): Promise<db.Draft | null> {
  if (db.isGroup(lead.subscriber_id)) return null; // group chats: never
  if (await db.isFriend(env.DB, lead)) return null; // friends & family: never
  if (aiBlocker(env)) return null; // no script or no API key yet: nothing to draft with
  if (!(await lockLead(env.DB, lead.subscriber_id, now))) return null;
  await ping(env, lead.subscriber_id); // the Inbox shows the AI typing
  try {
    await enrichPending(env, lead.subscriber_id, now).catch((e) => console.error(`media catch-up for ${lead.subscriber_id}:`, e));
    const thread = await db.history(env.DB, lead.subscriber_id, HISTORY);
    const last = thread.at(-1);
    const lastLead = [...thread].reverse().find((m) => m.role === "lead");
    if (!last || !lastLead) return null;
    if (mode === "follow_up" ? last.role !== "bot" : !(await onlyOurs(env, lead.subscriber_id, lastLead.id, thread.filter((m) => m.id > lastLead.id)))) return null;
    if (mode === "reply") {
      const done = await env.DB.prepare(`SELECT 1 FROM drafts WHERE subscriber_id = ?1 AND after_message_id >= ?2 AND status != 'superseded' AND action != 'handoff'`)
        .bind(lead.subscriber_id, lastLead.id)
        .first();
      if (done) return null;
    }
    const who = [lead.first_name, lead.username && `(@${lead.username})`].filter(Boolean).join(" ") || null; // both: the name says more about who they are
    const decision = await decide(env.ANTHROPIC_API_KEY, who, thread, mode === "follow_up" ? FOLLOW_UP_ASK : undefined, await customerLine(env.DB, lead.subscriber_id), (await leadMagnet(env.DB, lead.subscriber_id))?.name ?? null, await liveMagnets(env.DB), await liveKnowledge(env.DB), meter(env.DB, mode, lead.subscriber_id));
    // The thread moved on while the model was thinking (lead typed, the owner answered): this draft is stale.
    if (mode === "follow_up") {
      const newest = await env.DB.prepare(`SELECT MAX(id) AS id FROM messages WHERE subscriber_id = ?1`).bind(lead.subscriber_id).first<{ id: number }>();
      if (newest?.id !== last.id) return null;
    } else {
      const { results: since } = await env.DB.prepare(`SELECT role, text FROM messages WHERE subscriber_id = ?1 AND id > ?2 ORDER BY id`)
        .bind(lead.subscriber_id, lastLead.id)
        .all<{ role: string; text: string }>();
      if (!(await onlyOurs(env, lead.subscriber_id, lastLead.id, since))) return null;
    }
    let action: db.Draft["action"] = decision.action;
    if (mode === "follow_up" && (action === "reply" || action === "stop")) {
      if (!decision.bubbles.length) return null; // the model chose not to nudge
      action = "follow_up";
    }
    const holdOn = mode === "reply" && action === "handoff" && decision.bubbles.length > 0; // "lemme double check that for u"
    const autopilot = aiOn(env, lead) && (action === "reply" || action === "stop" || action === "react" || action === "follow_up" || holdOn);
    const draft = await env.DB.prepare(
      `INSERT INTO drafts (subscriber_id, after_message_id, action, bubbles, stage, note, send_after, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING *`,
    )
      .bind(lead.subscriber_id, lastLead.id, action, JSON.stringify(decision.bubbles), decision.stage, decision.note, autopilot ? now + autopilotDelayMs(env) : null, now)
      .first<db.Draft>();
    await env.DB.prepare(`UPDATE leads SET stage = ?2 WHERE subscriber_id = ?1`).bind(lead.subscriber_id, decision.stage).run();
    const status = leadStatusAfter(decision.action);
    if (status) await db.setLeadStatus(env.DB, lead.subscriber_id, status, "handoff");
    return draft;
  } finally {
    await unlockLead(env.DB, lead.subscriber_id);
    await ping(env, lead.subscriber_id);
  }
}

// Sends a pending draft (optionally with the owner's edited bubbles). Refuses outside the 24h window. `auto` = autopilot
// sent it, which adds the one-time disclosure line.
export async function sendDraft(env: Env, draft: db.Draft, now: number, edited?: string[], opts: { auto?: boolean; replyTo?: string; typingAt?: number } = {}): Promise<void> {
  // Claim it first: the cron, the fast path and a double-tapped Send can all reach the same draft.
  const claim = await env.DB.prepare(`UPDATE drafts SET status = 'sending' WHERE id = ?1 AND status IN ('pending', 'failed')`).bind(draft.id).run();
  if (!claim.meta.changes) return;
  const lead = await db.getLead(env.DB, draft.subscriber_id);
  if (!lead?.last_inbound_at || now - lead.last_inbound_at > db.WINDOW_MS) {
    await db.setDraftStatus(env.DB, draft.id, "expired");
    return;
  }
  const bubbles = edited ?? (JSON.parse(draft.bubbles) as string[]);
  const disclose = Boolean(DISCLOSE && opts.auto && bubbles.length && !lead.disclosed_at);
  if (bubbles.length) {
    const out = await fillTracked(env, draft.subscriber_id, bubbles, now);
    if (disclose) out.push(DISCLOSURE);
    await markOutgoing(env.DB, lead.subscriber_id, out, now);
    // Autopilot stops between bubbles when the lead writes something new, like a person would.
    const stop = opts.auto
      ? async () =>
          Boolean(
            await env.DB.prepare(`SELECT 1 FROM messages WHERE subscriber_id = ?1 AND role = 'lead' AND id > ?2 LIMIT 1`)
              .bind(draft.subscriber_id, draft.after_message_id)
              .first(),
          )
      : undefined;
    let mids: (string | null)[];
    try {
      mids = await deliver(env, lead, out, opts.replyTo, Boolean(opts.auto && env.TYPING === "true"), opts.typingAt, stop);
    } catch (e) {
      await db.setDraftStatus(env.DB, draft.id, "failed", redactSecrets(String(e)));
      return;
    }
    if (mids.length < out.length) {
      // Interrupted: keep what went out (nothing went out = superseded) and leave follow-ups to the reply that answers them.
      const said = bubbles.slice(0, mids.length);
      await env.DB.batch([
        ...out.slice(0, mids.length).map((text, i) =>
          recordSent(env, draft.subscriber_id, text, now, mids[i]),
        ),
        env.DB.prepare(`UPDATE drafts SET status = ?2, bubbles = ?3 WHERE id = ?1`).bind(draft.id, said.length ? "sent" : "superseded", JSON.stringify(said)),
      ]);
      if (opts.replyTo && mids[0]) await saveReplyTo(env.DB, mids[0], opts.replyTo);
      await clearOutgoing(env.DB, lead.subscriber_id, now);
      return;
    }
    await env.DB.batch(out.map((text, i) => recordSent(env, draft.subscriber_id, text, now, mids[i])));
    // The first bubble went out quoting their message (deliver passes replyTo on it only); the echo may say so too.
    if (opts.replyTo && mids[0]) await saveReplyTo(env.DB, mids[0], opts.replyTo);
    await clearOutgoing(env.DB, lead.subscriber_id, now);
  }
  if (draft.action === "react") {
    // Nothing to say, like after "appreciate it" once it's wrapped: heart their message and leave it there.
    try {
      await heart(env, lead, draft.after_message_id);
    } catch (e) {
      await db.setDraftStatus(env.DB, draft.id, "failed", redactSecrets(String(e)));
      return;
    }
  }
  await env.DB.prepare(`UPDATE drafts SET status = 'sent', bubbles = ?2 WHERE id = ?1`)
    .bind(draft.id, JSON.stringify(bubbles))
    .run();
  if (disclose) await env.DB.prepare(`UPDATE leads SET disclosed_at = ?2 WHERE subscriber_id = ?1`).bind(lead.subscriber_id, now).run();
  await ping(env, draft.subscriber_id);
  if (draft.action === "stop" || draft.action === "react") await db.setLeadStatus(env.DB, draft.subscriber_id, "done");
  else if (bubbles.length && (draft.action === "reply" || draft.action === "follow_up")) await scheduleFollowUp(env.DB, lead, draft, now);
}

// A bubble we sent. The echo webhook can land before this insert: with a mid, OR IGNORE drops the copy; without one
// (Manychat sends), skip it when an echo of the same text already arrived since the send began.
function recordSent(env: Env, leadId: string, text: string, now: number, mid: string | null): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO messages (subscriber_id, role, text, created_at, mid) SELECT ?1, 'bot', ?2, ?3, ?4
     WHERE ?4 IS NOT NULL OR NOT EXISTS (SELECT 1 FROM messages WHERE subscriber_id = ?1 AND role = 'bot' AND text = ?2 AND mid IS NOT NULL AND created_at >= ?3)`,
  ).bind(leadId, text, now, mid);
}

// ❤️ on one of their messages, through Instagram (Manychat's API can't react, so a Manychat-routed lead gets nothing).
async function heart(env: Env, lead: db.Lead, messageId: number): Promise<void> {
  const row = await env.DB.prepare(`SELECT mid, reactions FROM messages WHERE id = ?1`).bind(messageId).first<{ mid: string | null; reactions: string | null }>();
  const token = await db.getSetting(env.DB, "ig_token");
  if (!row?.mid || !token || lead.mc_id || env.TRANSPORT !== "meta") return;
  await react(token, lead.subscriber_id, row.mid, "❤️");
  const rx = { ...(JSON.parse(row.reactions ?? "{}") as object), you: "❤️" };
  await env.DB.prepare(`UPDATE messages SET reactions = ?2 WHERE id = ?1`).bind(messageId, JSON.stringify(rx)).run();
}

// Instagram Login tokens last 60 days; refresh weekly so one never lapses. Unified Login system-user tokens
// (EA…) are not rotated here: ig_refresh_token does not apply, and writing a failed refresh over the row would
// wipe a token that still works. null from refreshToken means "keep the saved value".
async function keepTokenFresh(env: Env, now: number): Promise<void> {
  const token = await db.getSetting(env.DB, "ig_token");
  const at = Number((await db.getSetting(env.DB, "ig_token_at")) ?? 0);
  if (!token || now - at < TOKEN_REFRESH_MS) return;
  const next = await refreshToken(token);
  if (!next) {
    if (isUnifiedLoginToken(token)) await db.setSetting(env.DB, "ig_token_at", String(now));
    return;
  }
  await db.setSetting(env.DB, "ig_token", next);
  await db.setSetting(env.DB, "ig_token_at", String(now));
}

export async function tick(env: Env, now: number): Promise<void> {
  if (env.TRANSPORT === "meta") {
    await keepTokenFresh(env, now).catch((e) => logError(env.DB, "token refresh", null, e, now));
    await refreshProfiles(env, now).catch((e) => logError(env.DB, "profiles", null, e, now));
    await syncRecent(env, now).catch((e) => logError(env.DB, "DM sync", null, e, now)); // DMs the webhook dropped
  }

  // 1. Expire drafts whose 24h window has closed.
  await env.DB.prepare(
    `UPDATE drafts SET status = 'expired' WHERE status = 'pending'
     AND subscriber_id IN (SELECT subscriber_id FROM leads WHERE last_inbound_at <= ?1)`,
  )
    .bind(now - db.WINDOW_MS)
    .run();
  await resumeManualPauses(env.DB, now);
  await settleStuckSends(env, now);
  await env.DB.prepare(`DELETE FROM outbox WHERE created_at < ?1`).bind(now - db.WINDOW_MS).run();
  await pruneMediaCache(env.DB, now);

  // 2. Draft replies for threads that went quiet. One failure must not block the rest. There is no approval queue:
  // the AI is either on (autopilot, below) or off, and off means it writes nothing, except on threads the owner
  // switched on one at a time (ai_on).
  // A few at a time, so a backlog clears in a fraction of the time (each draft is a model call of several seconds).
  const onlyAiOn = env.AUTOPILOT !== "true";
  const waiting = await db.leadsNeedingDraft(env.DB, now, QUIET_MS, onlyAiOn);
  for (let i = 0; i < waiting.length; i += DRAFTS_AT_ONCE) {
    await Promise.all(
      waiting.slice(i, i + DRAFTS_AT_ONCE).map((lead) => draftFor(env, lead, now).catch((e) => logError(env.DB, "AI draft", lead.subscriber_id, e, now))),
    );
  }
  for (const lead of await leadsNeedingFollowUp(env.DB, now, onlyAiOn)) {
    try {
      // One shot: sending the nudge books the next one.
      await env.DB.prepare(`UPDATE leads SET followup_due_at = NULL WHERE subscriber_id = ?1`).bind(lead.subscriber_id).run();
      await draftFor(env, lead, now, "follow_up");
    } catch (e) {
      await logError(env.DB, "AI follow-up", lead.subscriber_id, e, now);
    }
  }

  // 3. Autopilot: send drafts that came due before this pass (ones drafted just now go out on the next one; live chats
  // are answered by the webhook fast path, src/fastpath.ts, without waiting on the cron).
  const { results: due } = await env.DB.prepare(
    `SELECT d.* FROM drafts d JOIN leads l ON l.subscriber_id = d.subscriber_id
     WHERE d.status = 'pending' AND d.send_after IS NOT NULL AND d.send_after < ?1
       AND (l.status = 'active' OR (d.action = 'handoff' AND l.status = 'paused' AND l.paused_reason = 'handoff'))`,
  )
    .bind(now)
    .all<db.Draft>();
  // Fresh ones go to the queue (typing pauses); a draft still pending 90s past due (lost job) is sent right here.
  for (const draft of due) {
    if (env.SEND_QUEUE && draft.send_after! > now - 90_000) await env.SEND_QUEUE.send({ draft_id: draft.id });
    else await sendDraft(env, draft, now, undefined, { auto: true });
  }
}

// A send job that dies mid-reply leaves its draft 'sending' for good: no nudge, typing dots in the Inbox, the rest of
// the reply never sent (@ig_kofi.0, 2026-10-30). A send takes seconds, so after STUCK_MS keep what went out (its
// echoes are in the thread) like an interrupted reply. Nothing went out = superseded, so their message gets redrafted.
const STUCK_MS = 10 * 60 * 1000;

async function settleStuckSends(env: Env, now: number): Promise<void> {
  const { results } = await env.DB.prepare(`SELECT * FROM drafts WHERE status = 'sending' AND created_at < ?1`).bind(now - STUCK_MS).all<db.Draft>();
  for (const draft of results) {
    const lead = await db.getLead(env.DB, draft.subscriber_id);
    const bubbles = JSON.parse(draft.bubbles) as string[];
    const out = lead ? await fillTracked(env, draft.subscriber_id, bubbles, now) : [];
    const { results: ours } = await env.DB.prepare(`SELECT text FROM messages WHERE subscriber_id = ?1 AND role = 'bot' AND id > ?2`)
      .bind(draft.subscriber_id, draft.after_message_id)
      .all<{ text: string }>();
    const went = new Set(ours.map((m) => m.text));
    let n = 0;
    while (n < out.length && went.has(out[n])) n++;
    const said = bubbles.slice(0, n);
    await env.DB.prepare(`UPDATE drafts SET status = ?2, bubbles = ?3 WHERE id = ?1`).bind(draft.id, said.length ? "sent" : "superseded", JSON.stringify(said)).run();
    const answered = await env.DB.prepare(`SELECT 1 FROM messages WHERE subscriber_id = ?1 AND role = 'lead' AND id > ?2 LIMIT 1`)
      .bind(draft.subscriber_id, draft.after_message_id)
      .first();
    if (lead && said.length && !answered) {
      if (draft.action === "stop") await db.setLeadStatus(env.DB, lead.subscriber_id, "done");
      else if (draft.action === "reply" || draft.action === "follow_up") await scheduleFollowUp(env.DB, lead, draft, now);
    }
    await ping(env, draft.subscriber_id);
  }
}

// Queue consumer: one autopilot send per job, a batch's jobs side by side (each types for seconds, and one lead
// shouldn't wait on another's typing). The send claims the draft, so a job that lost the race does nothing.
export async function runSendJobs(env: Env, jobs: SendJob[]): Promise<void> {
  await Promise.all(
    jobs.map(async (job) => {
      const draft = await db.getDraft(env.DB, job.draft_id);
      if (draft?.status !== "pending") return;
      const lead = await db.getLead(env.DB, draft.subscriber_id);
      if (!lead || !sendable(lead, draft)) return;
      await sendDraft(env, draft, Date.now(), undefined, { auto: true, typingAt: job.typing_at }).catch((e) => logError(env.DB, "send job", `draft ${job.draft_id}`, e));
    }),
  );
}
