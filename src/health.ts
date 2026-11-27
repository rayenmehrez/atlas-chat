// Alerts to the owner's phone (ntfy.sh, a free push app: install it, subscribe to the topic in ALERT_TOPIC). Failures here
// used to be silent until someone went looking (the D1 read-limit outage, a stalled cron step). Each kind of alert
// sends at most once an hour.

import { ORIGIN } from "./brand";
import { APP_NAME } from "./theme";
import * as db from "./db";
import { redactSecrets } from "./meta";
import type { Env } from "./setter";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const QUIET_MS = 60 * MIN; // Instagram sends something (DMs, seen receipts, comments) far more often than this
const CRON_STRIKES = 5;
const WAITING_MS = 30 * MIN; // a lead who spoke last this long ago with no draft: the AI isn't answering
const KEEP_ERRORS_MS = 30 * DAY;

export async function alert(env: Env, kind: string, title: string, body: string, now: number, every = HOUR): Promise<boolean> {
  if (!env.ALERT_TOPIC) return false;
  const last = Number((await db.getSetting(env.DB, `alert_at:${kind}`)) ?? 0);
  if (now - last < every) return false;
  await db.setSetting(env.DB, `alert_at:${kind}`, String(now));
  const res = await fetch(`https://ntfy.sh/${env.ALERT_TOPIC}`, {
    method: "POST",
    headers: { Title: `${APP_NAME}: ${title}`, Tags: "warning", Click: `${ORIGIN}/admin/dashboard` },
    body: body.slice(0, 900),
  }).catch(() => null);
  return Boolean(res?.ok);
}

// A failure that used to reach only console.error (gone unless someone was tailing the Worker at that moment): also kept
// in D1 `errors`, so the Dashboard's Problems card and checkHealth see it. Never throws: logging must not break the caller.
export async function logError(d1: D1Database, kind: string, ref: string | null, e: unknown, now = Date.now()): Promise<void> {
  const detail = redactSecrets(e instanceof Error ? [e.message, ...(e.stack?.split("\n").slice(1, 4) ?? [])].join("\n") : String(e));
  console.error(`${kind}${ref ? ` (${ref})` : ""}:`, detail);
  await d1
    .prepare(`INSERT INTO errors (kind, ref, detail, created_at) VALUES (?1, ?2, ?3, ?4)`)
    .bind(kind, ref, detail.slice(0, 2000), now)
    .run()
    .catch((err) => console.error("errors insert:", err));
}

export type Problem = { kind: string; n: number; last_at: number; detail: string | null };

// Everything that failed to deliver since `since`, one row per kind, newest first. A comment DM that failed also leaves a
// failed flow_sends row for the same person; those are counted once, as the comment DM.
const notComment = (f: string) =>
  `NOT EXISTS (SELECT 1 FROM comments c WHERE c.status = 'failed' AND c.trigger_id = ${f}.trigger_id AND c.subscriber_id = ${f}.subscriber_id)`;

export async function recentProblems(d1: D1Database, since: number): Promise<Problem[]> {
  const { results } = await d1
    .prepare(
      `SELECT kind, COUNT(*) n, MAX(created_at) last_at, (SELECT detail FROM errors x WHERE x.kind = e.kind ORDER BY id DESC LIMIT 1) detail
         FROM errors e WHERE created_at > ?1 GROUP BY kind
       UNION ALL
       SELECT 'comment DM', COUNT(*), MAX(created_at), (SELECT error FROM comments WHERE status = 'failed' AND created_at > ?1 ORDER BY created_at DESC LIMIT 1)
         FROM comments WHERE status = 'failed' AND created_at > ?1 HAVING COUNT(*) > 0
       UNION ALL
       SELECT 'flow message', COUNT(*), MAX(f.created_at), (SELECT error FROM flow_sends g WHERE g.status = 'failed' AND g.created_at > ?1 AND ${notComment("g")} ORDER BY g.created_at DESC, g.id DESC LIMIT 1)
         FROM flow_sends f WHERE f.status = 'failed' AND f.created_at > ?1 AND ${notComment("f")}
         HAVING COUNT(*) > 0
       UNION ALL
       SELECT 'AI reply send', COUNT(*), MAX(created_at), (SELECT error FROM drafts WHERE status = 'failed' AND created_at > ?1 ORDER BY created_at DESC LIMIT 1)
         FROM drafts WHERE status = 'failed' AND created_at > ?1 HAVING COUNT(*) > 0
       ORDER BY last_at DESC`,
    )
    .bind(since)
    .all<Problem>();
  return results;
}

// Leads who spoke last 30+ min ago (inside the 24h window) with no draft. With the AI on these mean the setter is broken;
// with it off they're waiting on the owner. Threads switched on one at a time (ai_on) count as "on" either way.
export async function waitingLeads(env: Env, now: number): Promise<{ broken: number; offWaiting: number }> {
  const aiOn = env.AUTOPILOT === "true";
  const shouldDraft = await db.leadsNeedingDraft(env.DB, now, WAITING_MS, !aiOn);
  const all = aiOn ? shouldDraft : await db.leadsNeedingDraft(env.DB, now, WAITING_MS, false);
  return { broken: shouldDraft.length, offWaiting: all.length - shouldDraft.length };
}

// Every webhook bumps this (at most once a minute), so silence is measurable.
export async function webhookSeen(d1: D1Database, now: number): Promise<void> {
  const last = Number((await db.getSetting(d1, "webhook_at")) ?? 0);
  if (now - last > MIN) await db.setSetting(d1, "webhook_at", String(now));
}

// A cron step: run it, and after CRON_STRIKES failures in a row say which one and why.
export async function cronStep(env: Env, name: string, now: number, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    await db.setSetting(env.DB, `cron_fail:${name}`, "0");
  } catch (e) {
    const detail = redactSecrets(e instanceof Error ? e.message : String(e));
    console.error(`${name}:`, detail);
    const n = Number((await db.getSetting(env.DB, `cron_fail:${name}`)) ?? 0) + 1;
    await db.setSetting(env.DB, `cron_fail:${name}`, String(n));
    if (n >= CRON_STRIKES) await alert(env, `cron:${name}`, `${name} keeps failing`, `${n} runs in a row. Last error: ${detail}`, now);
  }
}

// Cron: sends failing, comment DMs backing up, the webhook gone quiet.
export async function checkHealth(env: Env, now: number): Promise<void> {
  const since = now - 15 * MIN;
  const failed = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM comments WHERE status = 'failed' AND created_at > ?1)
          + (SELECT COUNT(*) FROM drafts WHERE status = 'failed' AND created_at > ?1)
          + (SELECT COUNT(*) FROM flow_sends WHERE status = 'failed' AND created_at > ?1) AS n,
            (SELECT error FROM comments WHERE status = 'failed' AND created_at > ?1 ORDER BY created_at DESC LIMIT 1) AS comment_error,
            (SELECT error FROM drafts WHERE status = 'failed' AND created_at > ?1 ORDER BY created_at DESC LIMIT 1) AS draft_error`,
  )
    .bind(since)
    .first<{ n: number; comment_error: string | null; draft_error: string | null }>();
  if ((failed?.n ?? 0) >= 3) {
    await alert(env, "sends", `${failed!.n} sends failed in 15 min`, `Last error: ${redactSecrets(failed!.comment_error ?? failed!.draft_error ?? "see the console")}`, now);
  }

  const queue = await env.DB.prepare(`SELECT COUNT(*) n, MIN(created_at) oldest FROM comments WHERE status = 'queued'`).first<{ n: number; oldest: number | null }>();
  if (queue && (queue.n > 50 || (queue.oldest && now - queue.oldest > 30 * MIN))) {
    await alert(env, "queue", `${queue.n} comment DMs waiting`, `Instagram's 750/hour private-reply cap or errors are holding them; the oldest has waited ${Math.round((now - (queue.oldest ?? now)) / MIN)} min. They keep retrying for 7 days.`, now);
  }

  const heard = Number((await db.getSetting(env.DB, "webhook_at")) ?? 0);
  if (heard && now - heard > QUIET_MS) {
    await alert(env, "webhook", "Instagram webhook is quiet", `Nothing from Instagram for ${Math.round((now - heard) / MIN)} min. The DM and comment backfills keep catching up, but check the Meta app's webhook subscription.`, now);
  }

  // Failures that leave no send row (public replies, AI drafts, button taps, flow runs, token refresh): 3 of a kind in 15 min.
  const { results: kinds } = await env.DB.prepare(
    `SELECT kind, COUNT(*) n, (SELECT detail FROM errors x WHERE x.kind = e.kind ORDER BY id DESC LIMIT 1) detail
     FROM errors e WHERE created_at > ?1 GROUP BY kind HAVING COUNT(*) >= 3`,
  )
    .bind(since)
    .all<{ kind: string; n: number; detail: string }>();
  for (const k of kinds) await alert(env, `errors:${k.kind}`, `${k.kind} failing (${k.n} in 15 min)`, `Last error: ${redactSecrets(k.detail ?? "")}`, now);

  // The AI on (master switch or a thread switched on by hand) and not drafting is a fault. The AI being off is the owner's
  // choice (off until further notice since 2026-11-19), so that only shows on the Dashboard's Problems card, no alert.
  const waiting = await waitingLeads(env, now);
  if (waiting.broken) {
    await alert(env, "unanswered", `${waiting.broken} leads waiting on the AI`, `They wrote 30+ min ago, the AI is on for them, and no reply was drafted. See Problems on the Dashboard.`, now);
  }

  // Automations stuck mid-flow: a smart delay that never ran, a message that never settled.
  const flows = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM flow_runs WHERE status = 'scheduled' AND run_at < ?1) overdue,
            (SELECT COUNT(*) FROM flow_sends WHERE status = 'sending' AND created_at < ?1) sending`,
  )
    .bind(now - 10 * MIN)
    .first<{ overdue: number; sending: number }>();
  if ((flows?.overdue ?? 0) + (flows?.sending ?? 0) > 0) {
    await alert(env, "flows", "Automations stuck", `${flows!.overdue} smart delays overdue, ${flows!.sending} flow messages stuck sending for 10+ min.`, now);
  }

  await env.DB.prepare(`DELETE FROM errors WHERE created_at < ?1`).bind(now - KEEP_ERRORS_MS).run();
}
