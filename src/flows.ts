// Automations on the Instagram API: comment / DM / story keywords, story mentions, a welcome message
// for new conversations, ice breakers and the main menu. Each automation is a node graph (src/graph.ts) walked here:
// Send Message nodes send (buttons and quick replies each branch to their own next node when tapped), Smart Delays
// wait for the cron in flow_runs, Conditions and Randomizers pick a branch, Actions tag / stage / pause the lead or
// hand them to the AI setter, which ends the flow. These send instantly, outside the approval queue: the owner wrote
// them. Whatever a flow sends lands in the thread, so the AI setter sees it and only drafts once the lead says
// something the flow didn't answer.

import { markOutgoing } from "./autonomy";
import { matches, type Trigger } from "./comments";
import * as db from "./db";
import { logError } from "./health";
import { findByName, loadGraph, publish, type ActionItem, type Bubble, type Graph, type MessageData, type Node, type QuickReply, type Rule, type Variant } from "./graph";
import { fillLink } from "./manychat";
import { fetchProfile, graph, normalizeWebhook, redactSecrets, senderAction, subscribe, type MetaEvent } from "./meta";
import { pace, type Env } from "./setter";

const INLINE_DELAY_S = 15; // webhook work gets about 30s after the response
const WALK_SLEEP_MS = 20_000; // pauses + typing one walk may spend; the sends themselves need the rest of those 30s

// How long the typing dots show before a flow message: far faster than a person (a whole automation has to fit in one
// walk), but still in step with its length, so a one-liner pops out and a paragraph takes a moment. 18ms a character,
// 0.7s to 2.5s, never the same twice. (The AI setter's replies keep the slower, human typingMs.)
export function flowTypingMs(text: string, rand = Math.random()): number {
  return Math.round(Math.min(2500, Math.max(700, text.length * 18)) * (0.85 + rand * 0.3));
}

export { findByName };

// Button links go through /f/<send id>/<button> on the Worker so clicks count; cron sends have no request to read it from.
import { ORIGIN } from "./brand";
export { ORIGIN };

export interface FlowSend {
  id: number;
  trigger_id: number;
  step_id: number | null;
  node_id: string | null;
  subscriber_id: string;
  status: "sending" | "sent" | "failed";
  url: string | null;
  urls: string | null;
  mid: string | null;
  clicked_at: number | null;
  tapped_at: number | null;
}

type Recipient = { id: string } | { comment_id: string };
type FlowEnv = Pick<Env, "DB" | "SKOOL_LINK">;

// What parseWebhook flattens away: the raw text (story replies get a prefix there), quick-reply payloads, and
// whether it was a story reply (and to which story) or a story mention. Keyed by mid.
export interface Signal {
  text: string;
  payload: string | null;
  story: boolean;
  storyId: string | null;
  mention: boolean;
}

interface RawEntry {
  id?: string;
  messaging?: {
    sender?: { id?: string };
    timestamp?: number;
    read?: { mid?: string };
    message?: { mid?: string; text?: string; is_echo?: boolean; quick_reply?: { payload?: string }; reply_to?: { story?: { id?: string } }; attachments?: { type?: string }[] };
    postback?: { mid?: string; title?: string; payload?: string };
  }[];
}

const entries = (payload: unknown): RawEntry[] => {
  const p = normalizeWebhook(payload) as { object?: string; entry?: RawEntry[] };
  return p?.object === "instagram" && Array.isArray(p.entry) ? p.entry : [];
};

export function flowSignals(payload: unknown): Map<string, Signal> {
  const out = new Map<string, Signal>();
  for (const entry of entries(payload)) {
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      if (!m?.mid || m.is_echo) continue;
      out.set(m.mid, {
        text: m.text ?? "",
        payload: m.quick_reply?.payload ?? null,
        story: Boolean(m.reply_to?.story),
        storyId: m.reply_to?.story?.id ?? null,
        mention: (m.attachments ?? []).some((a) => a.type === "story_mention"),
      });
    }
  }
  return out;
}

// Taps on template buttons and ice breakers (messaging_postbacks). They arrive without a message.
export interface Postback {
  lead_id: string;
  title: string;
  payload: string;
  at: number;
}

export function parsePostbacks(payload: unknown): Postback[] {
  const out: Postback[] = [];
  for (const entry of entries(payload)) {
    for (const ev of entry.messaging ?? []) {
      const pb = ev.postback;
      const lead_id = ev.sender?.id;
      if (!pb?.payload || !lead_id || lead_id === entry.id) continue;
      out.push({ lead_id, title: pb.title ?? "", payload: pb.payload, at: ev.timestamp ?? Date.now() });
    }
  }
  return out;
}

// Read receipts (messaging_seen): the lead saw the message with this mid, so everything we sent them up to it.
// Instagram only sends them when the person has read receipts on, so Opened is a floor.
export interface Read {
  lead_id: string;
  mid: string;
  at: number;
}

export function parseReads(payload: unknown): Read[] {
  const out: Read[] = [];
  for (const entry of entries(payload)) {
    for (const ev of entry.messaging ?? []) {
      const lead_id = ev.sender?.id;
      if (!ev.read?.mid || !lead_id || lead_id === entry.id) continue;
      out.push({ lead_id, mid: ev.read.mid, at: ev.timestamp ?? Date.now() });
    }
  }
  return out;
}

export async function handleRead(d: D1Database, r: Read): Promise<void> {
  const seen = await d.prepare(`SELECT created_at FROM messages WHERE mid = ?1 AND subscriber_id = ?2`).bind(r.mid, r.lead_id).first<{ created_at: number }>();
  await d
    .prepare(`UPDATE flow_sends SET seen_at = ?3 WHERE subscriber_id = ?1 AND status = 'sent' AND seen_at IS NULL AND created_at <= ?2`)
    .bind(r.lead_id, seen?.created_at ?? r.at, r.at)
    .run();
}

// Payloads: b:<send>:<button> = next-step button, q:<send>:<quick reply> = quick reply, go:<automation> = ice
// breaker / menu item. With a button the bubble is a button template (max 3 buttons; quick replies ride along as
// postback buttons); otherwise quick replies hang under the text.
export function buildMessage(
  b: Bubble,
  qrs: QuickReply[],
  sendId: number,
  link: string,
): { message: object; text: string; url: string | null; urls: Record<string, string> } {
  const [text] = fillLink([b.text], link);
  const buttons: object[] = [];
  const labels: string[] = [];
  const urls: Record<string, string> = {};
  for (const x of b.buttons) {
    if (x.url !== undefined) {
      const url = fillLink([x.url], link)[0];
      urls[x.id] = url;
      buttons.push({ type: "web_url", url: `${ORIGIN}/f/${sendId}/${x.id}`, title: x.title });
      labels.push(`${x.title} (${url})`);
    } else {
      buttons.push({ type: "postback", title: x.title, payload: `b:${sendId}:${x.id}` });
      labels.push(x.title);
    }
  }
  const quick = qrs.map((q) => ({ title: q.title, payload: `q:${sendId}:${q.id}` }));
  const url = Object.values(urls)[0] ?? null;
  // What the thread (and so the AI) sees: the text plus the buttons it came with.
  const shown = (extra: string[]) => (extra.length ? `${text}\n[buttons: ${extra.join(" | ")}]` : text);
  if (buttons.length) {
    for (const q of quick.slice(0, 3 - buttons.length)) {
      buttons.push({ type: "postback", ...q });
      labels.push(q.title);
    }
    return { message: { attachment: { type: "template", payload: { template_type: "button", text, buttons } } }, text: shown(labels), url, urls };
  }
  if (quick.length) return { message: { text, quick_replies: quick.map((q) => ({ content_type: "text", ...q })) }, text: shown(quick.map((q) => q.title)), url, urls };
  return { message: { text }, text, url, urls };
}

async function post(token: string, recipient: Recipient, message: object): Promise<{ recipient_id?: string; message_id: string }> {
  return graph<{ recipient_id?: string; message_id: string }>("/me/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient, message }),
  });
}

export interface Sent {
  mid: string;
  text: string;
  lead_id: string;
}

// Sends one bubble and logs it in flow_sends. Does not write the thread; callers do (comment-to-DM puts the comment
// in first). Throws on failure, after marking the send failed.
export async function sendFlowMessage(
  env: FlowEnv,
  token: string,
  recipient: Recipient,
  leadId: string,
  triggerId: number,
  nodeId: string,
  part: number,
  b: Bubble,
  qrs: QuickReply[],
  now: number,
): Promise<Sent> {
  const row = await env.DB.prepare(`INSERT INTO flow_sends (trigger_id, node_id, part, subscriber_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`)
    .bind(triggerId, nodeId, part, leadId, now)
    .first<{ id: number }>();
  const sendId = row!.id;
  const built = buildMessage(b, qrs, sendId, env.SKOOL_LINK);
  const fail = (e: unknown) => env.DB.prepare(`UPDATE flow_sends SET status = 'failed', error = ?2 WHERE id = ?1`).bind(sendId, redactSecrets(String(e))).run();
  let res: { recipient_id?: string; message_id: string };
  let text = built.text;
  // Its echo can beat our insert: park the text it will echo as ("[template]" for button cards) so autonomy.ts
  // doesn't take a flow send for the owner replying by hand.
  await markOutgoing(env.DB, leadId, ["attachment" in built.message ? "[template]" : built.text], now);
  try {
    res = await post(token, recipient, built.message);
  } catch (e) {
    // Meta only documents text for private replies to comments. If a template is refused there, a failed call
    // doesn't use up the one reply: send the text with the links inline instead.
    if (!("comment_id" in recipient) || !("attachment" in built.message || "quick_replies" in built.message)) {
      await fail(e);
      throw e;
    }
    const [plain] = fillLink([[b.text, ...Object.values(built.urls)].filter(Boolean).join("\n")], env.SKOOL_LINK);
    await markOutgoing(env.DB, leadId, [plain], now);
    try {
      res = await post(token, recipient, { text: plain });
    } catch (e2) {
      await fail(e2);
      throw e2;
    }
    text = plain;
  }
  // A private reply's recipient_id is the commenter's IGSID, which is what the thread is keyed on.
  const lead_id = res.recipient_id ?? leadId;
  await env.DB.prepare(`UPDATE flow_sends SET status = 'sent', mid = ?2, url = ?3, urls = ?4, subscriber_id = ?5 WHERE id = ?1`)
    .bind(sendId, res.message_id, built.url, Object.keys(built.urls).length ? JSON.stringify(built.urls) : null, lead_id)
    .run();
  return { mid: res.message_id, text, lead_id };
}

// Our row wins over the echo: if the echo landed first it stored "[template]", so overwrite the text.
export const recordBot = (d: D1Database, leadId: string, text: string, mid: string, now: number) =>
  d
    .prepare(`INSERT INTO messages (subscriber_id, role, text, created_at, mid) VALUES (?1, 'bot', ?2, ?3, ?4) ON CONFLICT (mid) DO UPDATE SET text = excluded.text`)
    .bind(leadId, text, now, mid);

const inWindow = (lead: db.Lead | null, now: number) => Boolean(lead?.last_inbound_at && now - lead.last_inbound_at <= db.WINDOW_MS);

const getTrigger = (d: D1Database, id: number) => d.prepare(`SELECT * FROM triggers WHERE id = ?1`).bind(id).first<Trigger>();
// A test copy (negative id, see startTestRun) is hidden from every list by deleted_at but still runs.
const live = (t: Trigger | null): t is Trigger => Boolean(t?.enabled && (!t.deleted_at || t.id < 0));

// ---------- walking the graph ----------

interface Run {
  env: FlowEnv;
  token: string;
  t: Trigger;
  g: Graph;
  lead: string;
  now: number;
  text: string | null; // what set it off (DM or comment text), for "keyword" conditions
  comment: string | null; // comment-to-DM: the first message goes out as the private reply, then the run stops
  first: Sent | null;
  typing: boolean; // a short pause ran in this walk: every message after it is typed out (dots, then the text), not pasted
  slept: number; // ms this walk has spent pausing and typing
  budget: number; // steps left: a loop in the graph can't spin forever
}

const target = (g: Graph, from: string, port: string) => g.edges.find((e) => e.from === from && e.port === port)?.to ?? null;

async function lastLeadText(d: D1Database, lead: string): Promise<string> {
  const row = await d.prepare(`SELECT text FROM messages WHERE subscriber_id = ?1 AND role = 'lead' ORDER BY id DESC LIMIT 1`).bind(lead).first<{ text: string }>();
  return (row?.text ?? "").replace(/^\[replying to your story\]\s*/, "");
}

// Needs the lead's consent (they've messaged or tapped), which every DM-started flow has. Anything else = no.
async function follows(token: string, lead: string): Promise<boolean> {
  try {
    const p = await graph<{ is_user_follow_business?: boolean }>(`/${lead}?fields=is_user_follow_business`, { headers: { Authorization: `Bearer ${token}` } });
    return p.is_user_follow_business === true;
  } catch {
    return false;
  }
}

async function check(run: Run, r: Rule): Promise<boolean> {
  const d = run.env.DB;
  let yes: boolean;
  switch (r.field) {
    case "tag":
      yes = Boolean(await d.prepare(`SELECT 1 FROM lead_tags WHERE subscriber_id = ?1 AND lower(tag) = lower(?2)`).bind(run.lead, r.value.trim()).first());
      break;
    case "stage":
      yes = (await db.getLead(d, run.lead))?.stage === r.value;
      break;
    case "keyword":
      yes = matches(r.value, run.text ?? (await lastLeadText(d, run.lead)));
      break;
    case "follows":
      yes = await follows(run.token, run.lead);
      break;
    case "paused":
      yes = (await db.getLead(d, run.lead))?.status === "paused";
      break;
  }
  return r.op === "not" ? !yes : yes;
}

const hit = (run: Run, node: string, port: string) =>
  run.env.DB.prepare(`INSERT INTO flow_hits (trigger_id, node_id, subscriber_id, port, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(run.t.id, node, run.lead, port, run.now).run();

// One node. Returns the next node to run, or null when the run stops here (end, waiting on a tap or the cron).
async function step(run: Run, n: Node): Promise<string | null> {
  const d = run.env.DB;
  switch (n.kind) {
    case "trigger":
      return target(run.g, n.id, "next");
    case "message": {
      const m = n.data as MessageData;
      const bubbles = m.bubbles.filter((b) => b.text.trim());
      if (run.comment !== null) {
        // Instagram allows one private reply per comment and a comment doesn't open the 24h window: the first
        // bubble goes out, and the rest of the flow waits for them to tap or answer.
        if (run.first) return null;
        if (!bubbles.length) return target(run.g, n.id, "next");
        run.first = await sendFlowMessage(run.env, run.token, { comment_id: run.comment }, run.lead, run.t.id, n.id, 0, bubbles[0], m.quick_replies, run.now);
        return null;
      }
      if (!inWindow(await db.getLead(d, run.lead), run.now)) return null;
      for (const [i, b] of bubbles.entries()) {
        const ms = flowTypingMs(b.text);
        // Out of time for this walk: the rest still goes out, just without the dots.
        if (run.typing && run.slept + ms <= WALK_SLEEP_MS) {
          await senderAction(run.token, run.lead, "typing_on").catch(() => {});
          await pace.sleep(ms);
          run.now += ms;
          run.slept += ms;
        }
        const sent = await sendFlowMessage(run.env, run.token, { id: run.lead }, run.lead, run.t.id, n.id, i, b, i === bubbles.length - 1 ? m.quick_replies : [], run.now);
        await recordBot(d, run.lead, sent.text, sent.mid, run.now).run();
      }
      return target(run.g, n.id, "next");
    }
    case "delay": {
      // A short delay (a few seconds) is a person pausing, then typing: a quiet wait, then every message after it in
      // this walk shows typing dots first (flowTypingMs), all inside this walk. Longer ones park for the minute cron.
      const secs = n.data.seconds ?? 0;
      if (secs <= INLINE_DELAY_S && !run.comment) {
        await pace.sleep(secs * 1000);
        run.now += secs * 1000;
        run.slept += secs * 1000;
        run.typing = true;
        return target(run.g, n.id, "next");
      }
      const last = await d.prepare(`SELECT MAX(id) AS id FROM messages WHERE subscriber_id = ?1`).bind(run.lead).first<{ id: number | null }>();
      await d
        .prepare(`INSERT INTO flow_runs (trigger_id, subscriber_id, after_position, node_id, after_msg_id, run_at, created_at) VALUES (?1, ?2, 0, ?3, ?4, ?5, ?6)`)
        .bind(run.t.id, run.lead, n.id, last?.id ?? 0, run.now + secs * 1000, run.now)
        .run();
      return null;
    }
    case "condition": {
      const rules = n.data.rules as Rule[];
      let ok = n.data.match !== "any" || !rules.length;
      for (const r of rules) {
        const yes = await check(run, r);
        if (n.data.match === "any" && yes) ok = true;
        if (n.data.match !== "any" && !yes) ok = false;
      }
      const port = ok ? "yes" : "no";
      await hit(run, n.id, port);
      return target(run.g, n.id, port);
    }
    case "randomizer": {
      const vs = (n.data.variants as Variant[]).filter((v) => v.weight > 0);
      let r = Math.random() * vs.reduce((s, v) => s + v.weight, 0);
      const pick = vs.find((v) => (r -= v.weight) < 0) ?? vs.at(-1);
      if (!pick) return null;
      await hit(run, n.id, pick.id);
      return target(run.g, n.id, pick.id);
    }
    case "action": {
      await hit(run, n.id, "next");
      for (const a of n.data.actions as ActionItem[]) {
        const v = a.value.trim();
        if (a.type === "add_tag" && v) await d.prepare(`INSERT OR IGNORE INTO lead_tags (subscriber_id, tag, created_at) VALUES (?1, ?2, ?3)`).bind(run.lead, v, run.now).run();
        if (a.type === "remove_tag") await d.prepare(`DELETE FROM lead_tags WHERE subscriber_id = ?1 AND lower(tag) = lower(?2)`).bind(run.lead, v).run();
        if (a.type === "set_stage" && v) await d.prepare(`UPDATE leads SET stage = ?2 WHERE subscriber_id = ?1`).bind(run.lead, v).run();
        if (a.type === "pause_ai") await db.setLeadStatus(d, run.lead, "paused", "admin");
        if (a.type === "resume_ai") await db.setLeadStatus(d, run.lead, "active");
        if (a.type === "start_automation" && Number(v)) await startFlow(run.env, run.token, Number(v), run.lead, run.now);
        // The AI setter takes it from here: make sure it's on for them, and the flow ends.
        if (a.type === "handoff") {
          await d.prepare(`UPDATE leads SET status = 'active', paused_reason = NULL, paused_at = NULL WHERE subscriber_id = ?1 AND status = 'paused'`).bind(run.lead).run();
          return null;
        }
      }
      return target(run.g, n.id, "next");
    }
  }
}

// Follows the edge out of (from, port) and keeps going. False = nothing connected there.
async function walk(run: Run, from: string, port: string): Promise<boolean> {
  let id = target(run.g, from, port);
  if (!id) return false;
  while (id && run.budget-- > 0) {
    const n = run.g.nodes.find((x) => x.id === id);
    if (!n) break;
    id = await step(run, n);
  }
  return true;
}

const makeRun = async (env: FlowEnv, token: string, t: Trigger, lead: string, now: number, extra: Partial<Run> = {}): Promise<Run> => ({
  env,
  token,
  t,
  g: await loadGraph(env.DB, t),
  lead,
  now,
  text: null,
  comment: null,
  first: null,
  typing: false,
  slept: 0,
  budget: 50,
  ...extra,
});

// One run per person per automation (a second keyword DM from the same lead goes to the AI instead); a run that
// failed before it got anywhere can be retried.
async function claim(d: D1Database, triggerId: number, lead: string, now: number): Promise<boolean> {
  const ins = await d.prepare(`INSERT OR IGNORE INTO flow_starts (trigger_id, subscriber_id, status, created_at) VALUES (?1, ?2, 'sending', ?3)`).bind(triggerId, lead, now).run();
  if (ins.meta.changes) return true;
  const retry = await d.prepare(`UPDATE flow_starts SET status = 'sending', created_at = ?3 WHERE trigger_id = ?1 AND subscriber_id = ?2 AND status = 'failed'`).bind(triggerId, lead, now).run();
  return Boolean(retry.meta.changes);
}

async function enter(env: FlowEnv, token: string, t: Trigger, lead: string, now: number, extra: Partial<Run>): Promise<Run | null> {
  if (!(await claim(env.DB, t.id, lead, now))) return null;
  const run = await makeRun(env, token, t, lead, now, extra);
  const done = (status: string) => env.DB.prepare(`UPDATE flow_starts SET status = ?3 WHERE trigger_id = ?1 AND subscriber_id = ?2`).bind(t.id, lead, status).run();
  try {
    await walk(run, "trigger", "next");
  } catch (e) {
    await done(run.first ? "sent" : "failed");
    throw e;
  }
  await done("sent");
  return run;
}

export async function startFlow(env: FlowEnv, token: string, triggerId: number, leadId: string, now: number, text: string | null = null): Promise<boolean> {
  const t = await getTrigger(env.DB, triggerId);
  if (!live(t)) return false;
  return Boolean(await enter(env, token, t, leadId, now, { text }));
}

// Comment-to-DM: the flow's first message goes out as the private reply. Null = nothing sent (already ran for them,
// or the flow has no message before a delay); throws if Instagram refused it.
export async function startCommentFlow(env: FlowEnv, token: string, t: Trigger, commentId: string, leadId: string, text: string, now: number): Promise<Sent | null> {
  const run = await enter(env, token, t, leadId, now, { comment: commentId, text });
  return run?.first ?? null;
}

// A button or quick-reply tap. False = nothing to do (unknown payload, a button already tapped, nothing connected
// to it): the tap stays in the thread as a lead message and the AI answers it.
export async function handleTap(env: FlowEnv, token: string, leadId: string, payload: string, now: number): Promise<boolean> {
  const go = payload.match(/^go:(\d+)$/);
  if (go) return startFlow(env, token, Number(go[1]), leadId, now);
  // n:<send> and q:<send>:<automation id> are what the old linear builder sent; they still work.
  const tap = payload.match(/^(n|b|q):(\d+)(?::([A-Za-z0-9_-]+))?$/);
  if (!tap) return false;
  const send = await env.DB.prepare(`SELECT * FROM flow_sends WHERE id = ?1 AND subscriber_id = ?2`).bind(Number(tap[2]), leadId).first<FlowSend>();
  if (!send) return false;
  const port = tap[1] === "n" ? "nx" : tap[3];
  if (!port) return false;
  const first = await env.DB.prepare(`INSERT OR IGNORE INTO flow_taps (send_id, port, created_at) VALUES (?1, ?2, ?3)`).bind(send.id, port, now).run();
  if (!first.meta.changes) return false;
  await env.DB.prepare(`UPDATE flow_sends SET tapped_at = COALESCE(tapped_at, ?2) WHERE id = ?1`).bind(send.id, now).run();
  if (tap[1] === "q" && /^\d+$/.test(port)) return Number(port) > 0 && startFlow(env, token, Number(port), leadId, now);
  const t = await getTrigger(env.DB, send.trigger_id);
  if (!live(t)) return false;
  const node = send.node_id ?? (send.step_id ? `s${send.step_id}` : "m0");
  return walk(await makeRun(env, token, t, leadId, now), node, port);
}

// Called for each new inbound DM after it's recorded. Quick-reply taps first, then keyword automations (story
// replies try story automations, the ones pinned to that story before any-story ones, then DM ones; mentions only
// mention ones), then the welcome message for a lead who has never messaged before.
export async function handleInboundFlow(env: Env, token: string, ev: MetaEvent, sig: Signal | undefined, isNew: boolean, now: number): Promise<boolean> {
  if (sig?.payload && (await handleTap(env, token, ev.lead_id, sig.payload, now))) return true;
  if (sig?.payload) return false; // a tap that did nothing is still not a keyword message
  if (await startTestRun(env, token, ev.lead_id, sig?.text ?? ev.text, now)) return true;
  const sources = sig?.mention ? ["mention"] : sig?.story ? ["story", "dm"] : ["dm"];
  const text = sig?.text ?? ev.text;
  // A comment DM Instagram refused as too many new conversations, whose public reply told them to DM the keyword,
  // runs the automation for the post they commented on (several posts can share a keyword).
  const owed = await env.DB.prepare(
    `SELECT t.* FROM comments c JOIN triggers t ON t.id = c.trigger_id
     WHERE c.status = 'queued' AND c.subscriber_id = ?1 AND c.error LIKE '%thread does not exist%' AND t.enabled = 1 AND t.deleted_at IS NULL
     ORDER BY c.created_at DESC`,
  )
    .bind(ev.lead_id)
    .all<Trigger>();
  const due = owed.results.find((t) => t.keyword.split(",").some((k) => k.trim() !== "*" && matches(k, text)));
  if (due && (await startFlow(env, token, due.id, ev.lead_id, now, text))) return true;
  const { results } = await env.DB.prepare(`SELECT * FROM triggers WHERE enabled = 1 AND deleted_at IS NULL AND source IN (SELECT value FROM json_each(?1)) ORDER BY id`)
    .bind(JSON.stringify(sources))
    .all<Trigger>();
  const found = sources
    .flatMap((s) =>
      results
        .filter((t) => t.source === s && (s !== "story" || !t.media_id || t.media_id === sig?.storyId))
        .sort((a, b) => Number(!a.media_id) - Number(!b.media_id)),
    )
    .find((t) => t.source === "mention" || matches(t.keyword, text));
  if (found) return startFlow(env, token, found.id, ev.lead_id, now, text);
  if (!isNew) return false;
  const welcome = await env.DB.prepare(`SELECT id FROM triggers WHERE enabled = 1 AND deleted_at IS NULL AND source = 'welcome' ORDER BY id LIMIT 1`).first<{ id: number }>();
  return welcome ? startFlow(env, token, welcome.id, ev.lead_id, now, text) : false;
}

// Postbacks become lead messages ("[tapped] Send me the link") so the thread shows them and they open the 24h
// window, then run their payload.
export async function handlePostback(env: Env, token: string, pb: Postback, now: number): Promise<void> {
  const known = await db.getLead(env.DB, pb.lead_id);
  const profile = known?.username ? { username: known.username, name: null } : await fetchProfile(token, pb.lead_id);
  const fresh = await db.recordInbound(
    env.DB,
    { subscriber_id: pb.lead_id, username: profile.username, first_name: profile.name, text: `[tapped] ${pb.title}`.trim(), mid: `pb:${pb.lead_id}:${pb.at}` },
    pb.at,
  );
  if (fresh) await handleTap(env, token, pb.lead_id, pb.payload, now).catch((e) => logError(env.DB, "button tap", `${pb.lead_id} ${pb.payload}`, e, now));
}

// Cron: smart delays that are due. Cancelled when the lead has said anything since (they're in a live chat now).
export async function runDueFlows(env: Env, now: number): Promise<void> {
  const { results } = await env.DB.prepare(`SELECT * FROM flow_runs WHERE status = 'scheduled' AND run_at <= ?1 ORDER BY id`)
    .bind(now)
    .all<{ id: number; trigger_id: number; subscriber_id: string; after_position: number; node_id: string | null; after_msg_id: number }>();
  if (!results.length) return;
  const token = await db.getSetting(env.DB, "ig_token");
  for (const r of results) {
    const claimed = await env.DB.prepare(`UPDATE flow_runs SET status = 'done' WHERE id = ?1 AND status = 'scheduled'`).bind(r.id).run();
    if (!claimed.meta.changes) continue;
    const moved = await env.DB.prepare(`SELECT 1 FROM messages WHERE subscriber_id = ?1 AND role = 'lead' AND id > ?2`)
      .bind(r.subscriber_id, r.after_msg_id)
      .first();
    const t = await getTrigger(env.DB, r.trigger_id);
    if (moved || !token || !live(t)) {
      await env.DB.prepare(`UPDATE flow_runs SET status = 'cancelled' WHERE id = ?1`).bind(r.id).run();
      continue;
    }
    const step = r.node_id
      ? null
      : await env.DB.prepare(`SELECT id FROM flow_steps WHERE trigger_id = ?1 AND position = ?2`).bind(r.trigger_id, r.after_position).first<{ id: number }>();
    const node = r.node_id ?? (step ? `s${step.id}` : null);
    if (!node) continue;
    await makeRun(env, token, t, r.subscriber_id, now)
      .then((run) => walk(run, node, "next"))
      .catch((e) => logError(env.DB, "flow run", `run ${r.id} #${r.trigger_id}`, e, now));
  }
}

// GET /f/<send id>[/<button>]: count the click, then off to the real link.
export async function flowClick(env: Env, id: number, button: string | null, now: number): Promise<Response> {
  const send = await env.DB.prepare(`SELECT url, urls FROM flow_sends WHERE id = ?1`).bind(id).first<{ url: string | null; urls: string | null }>();
  const url = button ? (JSON.parse(send?.urls ?? "{}") as Record<string, string>)[button] : send?.url;
  if (!url) return new Response("not found", { status: 404 });
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO flow_taps (send_id, port, created_at) VALUES (?1, ?2, ?3)`).bind(id, button ?? "url", now),
    env.DB.prepare(`UPDATE flow_sends SET clicked_at = COALESCE(clicked_at, ?2) WHERE id = ?1`).bind(id, now),
  ]);
  return Response.redirect(url, 302);
}

// Ice breakers (Conversation Starters): up to 4 questions on the empty-chat screen of someone who has never
// messaged. "Question > automation" runs that automation when tapped; without a target the AI answers the question.
export async function saveIceBreakers(env: Env, token: string, lines: string): Promise<void> {
  const items = lines
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((l) => l.split(/\s*>\s*/, 2));
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (!items.length) {
    await graph("/me/messenger_profile", { method: "DELETE", headers: auth, body: JSON.stringify({ fields: ["ice_breakers"] }) });
  } else {
    const ctas = await Promise.all(
      items.map(async ([question, target]) => {
        const id = target ? await findByName(env.DB, target) : 0;
        return { question, payload: id ? `go:${id}` : "ice" };
      }),
    );
    await graph("/me/messenger_profile", { method: "POST", headers: auth, body: JSON.stringify({ platform: "instagram", ice_breakers: [{ call_to_actions: ctas }] }) });
  }
  // Taps arrive as messaging_postbacks; make sure the account is subscribed to it (older connections weren't).
  await subscribe(token);
  await db.setSetting(env.DB, "ice_breakers", items.map((p) => p.join(" > ")).join("\n"));
}

// Main Menu (persistent menu): the hamburger menu in the chat. "Title > automation" runs it (else the AI gets
// the tap), "Title | https://..." opens a link. Meta suggests 5 items at most; changes show after an inbox refresh.
export async function saveMenu(env: Env, token: string, lines: string): Promise<void> {
  const rows = lines
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (!rows.length) {
    await graph("/me/messenger_profile", { method: "DELETE", headers: auth, body: JSON.stringify({ fields: ["persistent_menu"] }) });
  } else {
    const ctas = await Promise.all(
      rows.map(async (l) => {
        const [title, url] = l.split(/\s*\|\s*/, 2);
        if (url) return { type: "web_url", title, url: fillLink([url], env.SKOOL_LINK)[0] };
        const [label, target] = l.split(/\s*>\s*/, 2);
        const id = target ? await findByName(env.DB, target) : 0;
        return { type: "postback", title: label, payload: id ? `go:${id}` : "menu" };
      }),
    );
    await graph("/me/messenger_profile", { method: "POST", headers: auth, body: JSON.stringify({ platform: "instagram", persistent_menu: [{ locale: "default", call_to_actions: ctas }] }) });
  }
  await subscribe(token);
  await db.setSetting(env.DB, "main_menu", rows.join("\n"));
}

// ---------- testing from a DM (the editor's Test button) ----------
// The editor hands out a 3-digit code. Whoever DMs it gets the automation as it is in the editor right now
// (unpublished changes included), as often as they like. It runs on a hidden copy with id -<automation id>, so test
// sends and taps never count in the real automation's stats, and its once-per-person rule doesn't apply.

export const TEST_CODE_MS = 15 * 60_000;

export async function testCode(d1: D1Database, triggerId: number, graph: Graph, now: number): Promise<string> {
  const shadow = -triggerId;
  await d1
    .prepare(
      `INSERT OR REPLACE INTO triggers (id, source, keyword, name, dm, enabled, deleted_at, created_at, updated_at) VALUES (?1, 'none', '*', ?2, '', 1, ?3, ?3, ?3)`,
    )
    .bind(shadow, `test of #${triggerId}`, now)
    .run();
  // A comment trigger's first message can only be a private reply to a real comment; in a test it's a plain DM.
  await publish(d1, shadow, { ...graph, trigger: { ...graph.trigger, source: "none", keyword: "*", media_id: null, public_reply: null } }, now);
  await d1.prepare(`UPDATE triggers SET deleted_at = ?2 WHERE id = ?1`).bind(shadow, now).run();
  const { results: taken } = await d1.prepare(`SELECT key FROM settings WHERE key LIKE 'test_code:%'`).all<{ key: string }>();
  const used = new Set(taken.map((r) => r.key.slice(10)));
  let code = "";
  for (let i = 0; i < 50 && (!code || used.has(code)); i++) code = String(100 + Math.floor(Math.random() * 900));
  await db.setSetting(d1, `test_code:${code}`, JSON.stringify({ trigger: shadow, exp: now + TEST_CODE_MS }));
  return code;
}

async function startTestRun(env: FlowEnv, token: string, lead: string, text: string, now: number): Promise<boolean> {
  const code = text.trim().match(/^\d{3}$/)?.[0];
  if (!code) return false;
  const raw = await db.getSetting(env.DB, `test_code:${code}`);
  const t = raw ? (JSON.parse(raw) as { trigger: number; exp: number }) : null;
  if (!t || t.exp < now) return false;
  // Every test is a fresh run: forget the last one for this person.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM flow_starts WHERE trigger_id = ?1 AND subscriber_id = ?2`).bind(t.trigger, lead),
    env.DB.prepare(`UPDATE flow_runs SET status = 'cancelled' WHERE trigger_id = ?1 AND subscriber_id = ?2 AND status = 'scheduled'`).bind(t.trigger, lead),
  ]);
  return startFlow(env, token, t.trigger, lead, now, text);
}
