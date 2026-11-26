// The console's pages that live here: AI (the setter's switch, its numbers, handoffs, the setting funnel and its
// settings), Inbox (every thread, manual replies inside the 24h window, pause/resume, tags) and Settings, plus the
// routing for all of them. Home is src/home.ts, Contacts src/contacts.ts, My Profile and Help src/console_pages.ts.
// The reviewer login sees only test threads (leads.test = 1) and never Settings. Styles: theme.ts.

import { esc, page, type Role } from "./admin";
import { helpPage, profilePage } from "./console_pages";
import { contactsPage } from "./contacts";
import { homePage } from "./home";
import { STAGES } from "./brain";
import * as db from "./db";
import { BASE_URL } from "./links";
import { COMMUNITY, skoolLinkSql } from "./brand";
import { clearInstagramToken, crossSite, igNote, instagramLink, isPreviewHost, storeInstagramToken, verifyInstagramToken, type IgLink } from "./ig_token";
import { react } from "./meta";
import { flowChart } from "./flowchart";
import { waitingLeads } from "./health";
import { aiBlocker } from "./ready";
import { getConfig, saveConfig } from "./settings";
import { ping } from "./live";
import { sendDraft, type Env } from "./setter";
import { icon, STAGE_COLOR } from "./theme";
import { resolveThread, type MediaRow, type Resolved } from "./attachments";
import { actsHtml, messageHtml, previewText, quoteHtml, THREAD_ASSETS } from "./thread_view";

// Marks drafts that are really the owner typing in the inbox, so they don't count as AI messages.
export const MANUAL_NOTE = "sent by hand from the inbox";

const DAY = 24 * 60 * 60 * 1000;
export const RANGES = { "7d": 7 * DAY, "30d": 30 * DAY, "90d": 90 * DAY, all: Infinity } as const;
export type Range = keyof typeof RANGES;
export const RANGE_LABEL: Record<Range, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" };

export function ago(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

export function agoLong(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const [n, unit] = m < 60 ? [m, "minute"] : m < 1440 ? [Math.floor(m / 60), "hour"] : [Math.floor(m / 1440), "day"];
  return m < 1 ? "just now" : `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

// Time left to reply to this lead (Instagram's 24h window from their last message), 0 when closed.
export function windowLeft(lead: Pick<db.Lead, "last_inbound_at">, now: number): number {
  return lead.last_inbound_at ? Math.max(0, lead.last_inbound_at + db.WINDOW_MS - now) : 0;
}

const hm = (ms: number) => `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;

type Named = { username: string | null; first_name: string | null; subscriber_id: string };
const nameOf = (l: Named) => esc(l.username ? `@${l.username}` : l.first_name || l.subscriber_id);
const initial = (l: Named) => esc((l.username || l.first_name || "?").replace(/^[^\p{L}\p{N}]+/u, "").charAt(0).toUpperCase() || "?");
const AV = ["#5764fa", "#9b62de", "#ec5aa5", "#f5a83a", "#2bca62", "#4b8ef0", "#e5484d", "#14b8a6"];
// Their Instagram picture when we have one (an expired CDN link falls back to the initial underneath).
export const avatar = (l: Named & { profile_pic?: string | null }, cls = "") =>
  `<span class="av ${cls}" style="background:${AV[[...l.subscriber_id].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length]}">${initial(l)}${
    l.profile_pic ? `<img src="${esc(l.profile_pic)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""
  }</span>`;
// Group chats (src/sync.ts): everyone in it but you, as Instagram listed them. A people icon for a picture.
type Member = { id: string; username: string | null };
const membersOf = (l: { members?: string | null }): Member[] => {
  try {
    return l.members ? (JSON.parse(l.members) as Member[]) : [];
  } catch {
    return [];
  }
};
const groupName = (ms: Member[]) => esc(ms.slice(0, 3).map((m) => m.username ?? "someone").join(", ") + (ms.length > 3 ? ` +${ms.length - 3}` : ""));
const groupAvatar = (cls = "") => `<span class="av grp ${cls}">${icon("users", 20, 1.8)}</span>`;
// Whether the AI will answer this thread: the master switch, then the lead's own state.
export const aiState = (aiOn: boolean, status: string) =>
  status === "flagged" ? "Flagged" : status === "done" ? "Closed" : !aiOn ? "AI off" : status === "paused" ? "Paused" : "AI on";
const stageName = (s: string) => esc(s.charAt(0).toUpperCase() + s.slice(1).replace("_", " "));
const stageTag = (s: string) => `<span class="stg" style="color:${STAGE_COLOR[s] ?? "#8e8e8e"}">${stageName(s)}</span>`;

// ---------- AI ----------

// Stage funnel: a lead "reached" a stage if any draft (or its current stage) put it there or further along.
const FUNNEL = STAGES.filter((s) => s !== "closed");
const MOVES: Record<(typeof FUNNEL)[number], [label: string, desc: string, pipe: string, icon: string]> = {
  opener: ["Opener", "First message and the reply", "Leads", "star"],
  lead: ["Get to know them", "What they make and where they're at", "Engaged", "comment"],
  qualify: ["Qualify", "Their goal, the gap, and if they're ready", "Qualifying", "hourglass"],
  pitch: ["Pitch", "The community and why it fits them", "Pitched", "megaphone"],
  link_sent: ["Link sent", "The Skool link is in their DMs", "Link sent", "send"],
  joined: ["Joined", "A verified Skool join that came out of the DMs", "Joined", "trophy"],
};

export function funnel(rows: { subscriber_id: string; stage: string | null }[]): { stage: string; reached: number; through: number }[] {
  const best = new Map<string, number>();
  for (const r of rows) {
    const i = FUNNEL.indexOf(r.stage as (typeof FUNNEL)[number]);
    best.set(r.subscriber_id, Math.max(best.get(r.subscriber_id) ?? 0, i));
  }
  const reached = FUNNEL.map((_, i) => [...best.values()].filter((b) => b >= i).length);
  return FUNNEL.map((stage, i) => ({ stage, reached: reached[i], through: reached[i + 1] ?? 0 }));
}

// The AI setter's own page: its master switch, what it sent and what that led to, who's waiting on a human, the
// setting funnel, then how it behaves, what it learned and who it must never answer.
export async function aiPage(env: Env, who: Role, range: Range, now: number, saved = false): Promise<Response> {
  // D1 can't bind -Infinity (it came back as no rows), so "all time" starts at 0.
  const since = range === "all" ? 0 : now - RANGES[range];
  const D = env.DB;
  const scope = `(?2 = 'admin' OR l.test = 1) AND l.members IS NULL`; // group chats aren't leads
  const n = async (sql: string, ...more: unknown[]) => (await D.prepare(sql).bind(since, who, ...more).first<{ n: number }>())?.n ?? 0;

  const conversations = await n(
    `SELECT COUNT(DISTINCT m.subscriber_id) n FROM messages m JOIN leads l ON l.subscriber_id = m.subscriber_id WHERE m.created_at >= ?1 AND ${scope}`,
  );
  const aiSent = await n(
    `SELECT COALESCE(SUM(json_array_length(d.bubbles)), 0) n FROM drafts d JOIN leads l ON l.subscriber_id = d.subscriber_id
     WHERE d.status = 'sent' AND d.created_at >= ?1 AND d.note IS NOT ?3 AND ${scope}`,
    MANUAL_NOTE,
  );
  const linksSent = await n(
    `SELECT COUNT(*) n FROM messages m JOIN leads l ON l.subscriber_id = m.subscriber_id
     WHERE m.role = 'bot' AND m.created_at >= ?1 AND ${scope}
       AND (instr(m.text, ?3) > 0 OR instr(m.text, ?4) > 0 OR ${skoolLinkSql("m.text")})`,
    env.SKOOL_LINK,
    `${BASE_URL}/l/`,
  );
  const clicks = await D.prepare(
    `SELECT COUNT(*) n, COUNT(DISTINCT c.subscriber_id) people FROM clicks c JOIN leads l ON l.subscriber_id = c.subscriber_id WHERE c.created_at >= ?1 AND ${scope}`,
  )
    .bind(since, who)
    .first<{ n: number; people: number }>();
  const flagged = await n(`SELECT COUNT(*) n FROM leads l WHERE l.status = 'flagged' AND ?1 = ?1 AND ${scope}`);

  // Handoffs: the AI (or the owner) paused the thread and the lead is waiting on a human. Friends & family are the owner's by
  // hand and never the AI's, so they're never "handed off".
  const { results: handoffs } = await D.prepare(
    `SELECT l.*, m.text AS last_text, m.created_at AS last_at FROM leads l
     JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE subscriber_id = l.subscriber_id AND role = 'lead')
     WHERE l.status = 'paused' AND ${db.leadSpokeLast("l")} AND ?1 = ?1 AND ${scope}
       AND NOT EXISTS (SELECT 1 FROM lead_tags t WHERE t.subscriber_id = l.subscriber_id AND t.tag = '${db.FRIEND}') ORDER BY m.created_at`,
  )
    .bind(since, who)
    .all<db.Lead & { last_text: string; last_at: number }>();

  const active = `l.subscriber_id IN (SELECT subscriber_id FROM messages WHERE created_at >= ?1)`;
  // Furthest move each lead actually reached in their thread (src/moves.ts, kept current by the cron).
  // Joined only counts when the join itself landed in this range: a member from weeks ago who comments today stops at Link sent.
  const { results: stageRows } = await D.prepare(
    `SELECT l.subscriber_id, CASE WHEN l.move = 'joined' AND NOT EXISTS (SELECT 1 FROM joins j WHERE j.subscriber_id = l.subscriber_id
       AND j.confidence = 'confirmed' AND j.path IN ('set', 'asked') AND j.joined_at >= ?1) THEN 'link_sent' ELSE l.move END AS stage
     FROM leads l WHERE ${active} AND ${scope}`,
  )
    .bind(since, who)
    .all<{ subscriber_id: string; stage: string | null }>();
  const closed = await n(`SELECT COUNT(*) n FROM leads l WHERE l.stage = 'closed' AND ${active} AND ${scope}`);
  const steps = funnel(stageRows);

  const { results: recentClicks } = await D.prepare(
    `SELECT l.subscriber_id, l.username, l.first_name, COUNT(*) n, MAX(c.created_at) at FROM clicks c JOIN leads l ON l.subscriber_id = c.subscriber_id
     WHERE c.created_at >= ?1 AND ${scope} GROUP BY l.subscriber_id ORDER BY at DESC LIMIT 10`,
  )
    .bind(since, who)
    .all<Named & { n: number; at: number }>();

  const trackOn = (await getConfig(env)).track_links;
  // Claude spend (src/usage.ts), admin only.
  const spend = (await n(`SELECT COALESCE(SUM(cost_micros), 0) n FROM ai_usage WHERE created_at >= ?1 AND ?2 = 'admin'`)) / 1e6;
  // Leads nobody is answering (admin only). Delivery failures are on Home.
  const waiting = who === "admin" ? await waitingLeads(env, now) : { broken: 0, offWaiting: 0 };

  const label = RANGE_LABEL[range];
  const stat = (v: number, name: string, ic: string, sub = label) =>
    `<div class="stat"><div class="lbl">${name}</div><b>${v.toLocaleString("en-US")}</b><small>${sub}</small></div>`;
  const leadRow = (l: Named, line: string, right: string) =>
    `<a class="li" href="/admin/inbox/${esc(l.subscriber_id)}">${avatar(l)}
     <div class="grow"><div class="t">${nameOf(l)}</div>${line ? `<div class="s">${line}</div>` : ""}</div>
     <span class="st">${right}</span>${icon("chevron")}</a>`;
  const pipe = steps
    .map((s, i) => {
      const [, , name, ic] = MOVES[s.stage as keyof typeof MOVES];
      const prev = i ? steps[i - 1].reached : s.reached;
      const pct = prev ? ((100 * s.reached) / prev).toFixed(1) : "0.0";
      return `<div><div class="lbl">${name}</div><span class="ic">${icon(ic, 14)}</span><div class="n">${s.reached}</div>
        <span class="pct" style="border-color:${STAGE_COLOR[s.stage]}">${i ? pct : "100"}%</span></div>`;
    })
    .join("");
  const problemRow = (title: string, line: string, right: string) =>
    `<div class="row"><span><b>${esc(title)}</b><br><small>${esc(line)}</small></span><span class="st">${right}</span></div>`;
  const aiOn = env.AUTOPILOT === "true";
  const ranges = (Object.keys(RANGES) as Range[])
    .map((r) => `<a href="?range=${r}"${r === range ? ' class="on" aria-current="true"' : ""} aria-label="${RANGE_LABEL[r]}"><span class="w">${r === "all" ? "All time" : r.replace("d", " days")}</span><span class="n">${r === "all" ? "All" : r}</span></a>`)
    .join("");
  const aiRows = [
    waiting.broken ? problemRow("AI not answering", `${waiting.broken} leads wrote 30+ min ago and the AI is on for them, but nothing was drafted.`, "now") : "",
    waiting.offWaiting ? problemRow("AI is off", `${waiting.offWaiting} leads wrote 30+ min ago and nobody has answered them.`, "now") : "",
  ].join("");
  // No script or no API key yet: the switch says what's missing and can't be turned on (turning off always works).
  const blocker = aiBlocker(env);
  const canSwitch = aiOn || !blocker;
  return page(
    "AI",
    `<div class="card aisw"><div><h2>AI replies ${aiOn ? "on" : "off"}</h2><p class="sub">${
      blocker && !aiOn
        ? `${esc(blocker)} Everything else works without it: automations still run and you reply from the Inbox.`
        : aiOn
          ? "The AI answers DMs on its own within seconds, in your voice, from your script."
          : "The AI writes nothing. Automations still run and you reply from the Inbox. You can turn it on for one conversation from its thread."
    }</p></div>
<form method="post" action="/admin/ai"><button type="${who === "admin" && canSwitch ? "submit" : "button"}" aria-pressed="${aiOn}"${canSwitch ? "" : " disabled"}>${aiOn ? "Turn off" : canSwitch ? "Turn on" : "Not set up yet"}<span class="tog${aiOn ? " on" : ""}"></span></button></form></div>
<div class="stats">${[
      stat(conversations, "Conversations", "users"),
      stat(aiSent, "AI messages sent", "bot", who === "admin" ? `$${spend.toFixed(2)} in AI · ${label}` : label),
      stat(linksSent, "Skool links sent", "link"),
      stat(clicks?.n ?? 0, "Link clicks", "click", clicks?.people ? `${clicks.people} ${clicks.people === 1 ? "person" : "people"} · ${label}` : label),
      stat(handoffs.length, "Handoffs waiting", "hand", "Right now"),
      stat(flagged, "Flagged", "flag", "Right now"),
    ].join("")}</div>
${aiRows ? `<div class="card flush"><div class="ch"><div><h2>Needs attention</h2><p>Leads who wrote a while ago and got no answer.</p></div></div>${aiRows}</div>` : ""}
<div class="card flush"><div class="ch"><div><h2>Handoffs</h2><p>Conversations your AI passed to you that are waiting for your reply.</p></div>
  <div style="text-align:right"><span class="big">${handoffs.length}</span> <span class="amber">waiting</span></div></div>
${handoffs.map((h) => leadRow(h, esc(previewText(h.last_text).slice(0, 140)), agoLong(now - h.last_at))).join("") || '<div class="empty">Nobody waiting on you.</div>'}</div>
<div class="card"><div class="ch"><div><h2>Setting moves</h2><p>Every lead active in this range, by the furthest move they reached.${closed ? ` ${closed} closed out.` : ""}</p></div>
  <a href="/admin/inbox">Open the inbox →</a></div>
${flowChart(steps, Object.fromEntries(steps.map((s) => [s.stage, MOVES[s.stage as keyof typeof MOVES][0]])), STAGE_COLOR)}
<p class="foot-note">From Get to know them on, bar height is to scale (the openers lead in). Hover or tap a move for how many made it through.</p>
<div class="pipe">${pipe}</div></div>
<div class="card flush"><div class="ch"><div><h2>Links</h2><p>Who opened the ${esc(COMMUNITY)} link your AI sent. Link previews are not counted.</p></div></div>
${
  recentClicks.map((c) => leadRow(c, `opened ${c.n}×`, agoLong(now - c.at))).join("") ||
  `<div class="empty">${trackOn ? "No clicks in this range yet." : 'Link tracking is off. <a href="/admin/settings">Turn on Track link clicks in Settings</a> to count who opens your link.'}</div>`
}</div>
${who === "admin" ? await aiSettings(env, saved) : ""}`,
    who,
    env,
    { actions: `<nav class="seg" aria-label="Date range">${ranges}</nav>` },
  );
}

// ---------- Inbox ----------

// Instagram's own composer icons (instagram.com/direct, 2026-10-29).
const EMOJI_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.83 10.997a1.167 1.167 0 1 0 1.167 1.167 1.167 1.167 0 0 0-1.167-1.167Zm-6.5 1.167a1.167 1.167 0 1 0-1.166 1.167 1.167 1.167 0 0 0 1.166-1.167Zm5.163 3.24a3.406 3.406 0 0 1-4.982.007 1 1 0 1 0-1.557 1.256 5.397 5.397 0 0 0 8.09 0 1 1 0 0 0-1.55-1.263ZM12 .503a11.5 11.5 0 1 0 11.5 11.5A11.513 11.513 0 0 0 12 .503Zm0 21a9.5 9.5 0 1 1 9.5-9.5 9.51 9.51 0 0 1-9.5 9.5Z"/></svg>`;
const SEND_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.513 3.576C21.826 2.552 20.617 2 19.384 2H4.621c-1.474 0-2.878.818-3.46 2.173-.6 1.398-.297 2.935.784 3.997l3.359 3.295a1 1 0 0 0 1.195.156l8.522-4.849a1 1 0 1 1 .988 1.738l-8.526 4.851a1 1 0 0 0-.477 1.104l1.218 5.038c.343 1.418 1.487 2.534 2.927 2.766.208.034.412.051.616.051 1.26 0 2.401-.644 3.066-1.763l7.796-13.118a3.572 3.572 0 0 0-.116-3.863Z"/></svg>`;
const X_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><polyline fill="none" points="20.643 3.357 12 12 3.353 20.647" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" x1="20.649" x2="3.354" y1="20.649" y2="3.354"/></svg>`;

interface InboxRow extends db.Lead {
  last_text: string | null;
  last_role: string | null;
  last_sender: string | null;
  waiting: number;
  last_at: number | null;
}

const FILTERS = ["q", "status", "stage", "tag"] as const;
const PAGE = 50;

// The list's filters as a query string, rebuilt from known keys only (it rides along in redirects).
function filterQs(q: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const k of FILTERS) if (q.get(k)) out.set(k, q.get(k)!);
  const s = out.toString();
  return s ? `?${s}` : "";
}

export async function inboxPage(env: Env, who: Role, q: URLSearchParams, now: number, lead: db.Lead | null = null): Promise<Response> {
  const aiOn = env.AUTOPILOT === "true";
  const search = (q.get("q") ?? "").trim().replace(/^@/, "");
  const status = q.get("status") ?? "";
  const stage = q.get("stage") ?? "";
  const tag = q.get("tag") ?? "";
  const pageNo = Math.max(0, Math.floor(Number(q.get("p")) || 0));
  // Sorted on leads.last_at (kept current by a trigger on messages), 50 a page: fine at tens of thousands of threads.
  const where = `(?1 = 'admin' OR l.test = 1)
       AND (?2 = '' OR l.username LIKE ?2 OR l.first_name LIKE ?2 OR l.members LIKE ?2)
       AND (?3 = '' OR l.status = ?3) AND (?4 = '' OR l.stage = ?4)
       AND (?5 = '' OR EXISTS (SELECT 1 FROM lead_tags WHERE subscriber_id = l.subscriber_id AND tag = ?5))`;
  const args = [who, search ? `%${search}%` : "", status, stage, tag] as const;
  const { results } = await env.DB.prepare(
    `SELECT l.*, m.text AS last_text, m.role AS last_role, m.sender AS last_sender, m.created_at AS last_at, ${db.leadSpokeLast("l")} AS waiting
     FROM leads l LEFT JOIN messages m ON m.id = COALESCE(l.last_msg_id, (SELECT MAX(id) FROM messages WHERE subscriber_id = l.subscriber_id))
     WHERE ${where}
     ORDER BY COALESCE(l.last_at, l.created_at) DESC LIMIT ${PAGE + 1} OFFSET ${pageNo * PAGE}`,
  )
    .bind(...args)
    .all<InboxRow>();
  const more = results.length > PAGE;
  if (more) results.pop();
  const total = (await env.DB.prepare(`SELECT COUNT(*) n FROM leads l WHERE ${where}`).bind(...args).first<{ n: number }>())?.n ?? 0;
  const { results: allTags } = await env.DB.prepare(
    `SELECT DISTINCT t.tag FROM lead_tags t JOIN leads l ON l.subscriber_id = t.subscriber_id WHERE ?1 = 'admin' OR l.test = 1 ORDER BY t.tag`,
  )
    .bind(who)
    .all<{ tag: string }>();

  const fq = filterQs(q);
  const chipHref = (k: "status" | "stage" | "", v: string) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (tag) p.set("tag", tag);
    if (k) p.set(k, v);
    return `/admin/inbox${p.toString() ? `?${p}` : ""}`;
  };
  const tab = (text: string, k: "status" | "", v: string, on: boolean) => `<a class="${on ? "on" : ""}" href="${esc(chipHref(k, v))}">${text}</a>`;
  const tabs = [
    tab("All", "", "", !status),
    tab("Active", "status", "active", status === "active"),
    tab("Paused", "status", "paused", status === "paused"),
    tab("Flagged", "status", "flagged", status === "flagged"),
    tab("Done", "status", "done", status === "done"),
  ].join("");
  // Stage options open the same URLs the stage chips did; "Any stage" keeps the status tab.
  const stageSelect = `<select aria-label="Stage" onchange="location.href=this.value"><option value="${esc(chipHref(status ? "status" : "", status))}">Any stage</option>${STAGES.map(
    (s) => `<option value="${esc(chipHref("stage", s))}"${stage === s ? " selected" : ""}>${stageName(s)}</option>`,
  ).join("")}</select>`;
  const tagSelect = allTags.length
    ? `<form method="get">${search ? `<input type="hidden" name="q" value="${esc(search)}">` : ""}${status ? `<input type="hidden" name="status" value="${esc(status)}">` : ""}${
        stage ? `<input type="hidden" name="stage" value="${esc(stage)}">` : ""
      }<select name="tag" aria-label="Tag" onchange="this.form.submit()"><option value="">Any tag</option>${allTags
        .map((t) => `<option${t.tag === tag ? " selected" : ""}>${esc(t.tag)}</option>`)
        .join("")}</select></form>`
    : "";

  const rows = results
    .map((l) => {
      const group = db.isGroup(l.subscriber_id) ? membersOf(l) : null;
      const by = group && l.last_role === "lead" ? group.find((m) => m.id === l.last_sender)?.username : null;
      const last = l.last_text ? `${l.last_role === "bot" ? "You: " : by ? `${esc(by)}: ` : ""}${esc(previewText(l.last_text).slice(0, 90))}` : "";
      const ai = group ? "Group" : aiState(aiOn, l.status);
      // AI on / AI off just repeat the master switch, so only screen readers get them; Paused/Flagged/Closed show.
      const aiCls = ai.startsWith("AI") ? "sr" : ai.toLowerCase();
      const waiting = l.waiting === 1 && l.status !== "done"; // a handoff's hold-on line still leaves them waiting
      return `<a class="conv${lead?.subscriber_id === l.subscriber_id ? " on" : ""}${waiting ? " unread" : ""}" href="/admin/inbox/${esc(l.subscriber_id)}${esc(fq)}"><span class="avw">${group ? groupAvatar() : avatar(l)}${
        windowLeft(l, now) ? '<i class="wo" title="Reply window open"></i>' : ""
      }</span>
        <div class="grow"><div class="top1"><b>${group ? groupName(group) : nameOf(l)}</b>${group ? "" : stageTag(l.stage)}</div>
        <div class="prev"><span class="ai ${aiCls}">${ai}</span><span class="txt">${last}</span>${l.last_at ? `<span class="when">${ago(now - l.last_at)}</span>` : ""}</div></div>${
          waiting ? '<i class="ud" title="Waiting on a reply"></i>' : ""
        }</a>`;
    })
    .join("");

  const list = `<section class="pane ib-list"><div class="lh"><h1>Inbox</h1>
    <nav class="tabs">${tabs}</nav>
    <form method="get" class="srch">${icon("search")}
    <input name="q" value="${esc(search)}" placeholder="Search @username" aria-label="Search">${status ? `<input type="hidden" name="status" value="${esc(status)}">` : ""}${
      stage ? `<input type="hidden" name="stage" value="${esc(stage)}">` : ""
    }${tag ? `<input type="hidden" name="tag" value="${esc(tag)}">` : ""}</form>
    <div class="count"><span>${total.toLocaleString("en-US")} conversation${total === 1 ? "" : "s"}</span><span class="fl">${stageSelect}${tagSelect}</span></div></div>
    <div class="convs">${rows || '<div class="empty" style="padding:16px 24px">No conversations match.</div>'}${pager(q, pageNo, more)}</div></section>`;

  const body = lead
    ? await threadPanes(env, lead, now, q.get("msg"), fq)
    : `<section class="pane ib-thread"><div class="placeholder"><span class="ring">${icon("send", 44, 1.4)}</span><b>Your messages</b>Select a conversation to start chatting</div></section>`;
  return page("Inbox", `${THREAD_ASSETS}<div class="ib${lead ? " open" : ""}">${list}${body}</div>${INBOX_JS}`, who, env);
}

// Newer / Older links under the list, keeping the filters.
function pager(q: URLSearchParams, pageNo: number, more: boolean): string {
  const href = (n: number) => {
    const p = new URLSearchParams(filterQs(q).slice(1));
    if (n) p.set("p", String(n));
    return `/admin/inbox${p.toString() ? `?${p}` : ""}`;
  };
  if (!pageNo && !more) return "";
  return `<div class="pager">${pageNo ? `<a href="${esc(href(pageNo - 1))}">Newer</a>` : "<span></span>"}${more ? `<a href="${esc(href(pageNo + 1))}">Older</a>` : ""}</div>`;
}

async function threadPanes(env: Env, lead: db.Lead, now: number, msg: string | null, fq: string): Promise<string> {
  const id = esc(lead.subscriber_id);
  const history = (await db.history(env.DB, lead.subscriber_id, 1000)) as MediaRow[];
  // Media already in the cache renders inline; the rest loads through the media proxy as it scrolls into view, so
  // opening a thread never waits on Instagram (it took 1.5s with photos or voice notes in it).
  const media = await resolveThread(env.DB, null, lead.subscriber_id, history, now).catch((e) => {
    console.error(`media for ${lead.subscriber_id}:`, e);
    return new Map<string, Resolved>();
  });
  const { results: tags } = await env.DB.prepare(`SELECT tag FROM lead_tags WHERE subscriber_id = ?1 ORDER BY tag`).bind(lead.subscriber_id).all<{ tag: string }>();
  const clicks = await env.DB.prepare(`SELECT COUNT(*) n, MAX(created_at) at FROM clicks WHERE subscriber_id = ?1`)
    .bind(lead.subscriber_id)
    .first<{ n: number; at: number | null }>();
  // Why the AI handed off or flagged, or what it last made of them: its newest note.
  const aiNote = await env.DB.prepare(`SELECT note FROM drafts WHERE subscriber_id = ?1 AND note IS NOT NULL AND note != '' ORDER BY id DESC LIMIT 1`)
    .bind(lead.subscriber_id)
    .first<{ note: string }>();

  const sending = await env.DB.prepare(`SELECT 1 FROM drafts WHERE subscriber_id = ?1 AND status IN ('sending', 'pending') AND send_after IS NOT NULL`)
    .bind(lead.subscriber_id)
    .first();
  const typing = aiWorking(lead, now) || Boolean(sending);
  const left = windowLeft(lead, now);
  const paused = lead.status !== "active";
  const soloOn = lead.ai_on === 1 && !paused; // AI on for just this thread while the master switch is off
  const keep = `<input type="hidden" name="f" value="${esc(fq)}">`;
  // Group chats: everyone in it, with the names and pictures of those who have a thread of their own.
  const group = db.isGroup(lead.subscriber_id) ? membersOf(lead) : null;
  const people = new Map<string, Named & { profile_pic?: string | null }>();
  const ownThread = new Set<string>();
  if (group) {
    for (const m of group) people.set(m.id, { subscriber_id: m.id, username: m.username, first_name: null });
    const ids = [...new Set([...group.map((m) => m.id), ...history.flatMap((m) => (m.sender ? [m.sender] : []))])];
    const { results } = await env.DB.prepare(`SELECT subscriber_id, username, first_name, profile_pic FROM leads WHERE subscriber_id IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(ids))
      .all<Named & { profile_pic: string | null }>();
    for (const r of results) {
      people.set(r.subscriber_id, { ...r, username: r.username ?? people.get(r.subscriber_id)?.username ?? null });
      ownThread.add(r.subscriber_id);
    }
  }
  const who = (m: MediaRow) => (group ? (m.sender ? people.get(m.sender) : undefined) ?? { subscriber_id: "?", username: null, first_name: "Member" } : lead);
  // Swipe-to-reply: the messages being answered, from this page of the thread or looked up when they're older.
  const byMid = new Map(history.flatMap((m) => (m.mid ? [[m.mid, m] as const] : [])));
  const older = [...new Set(history.flatMap((m) => (m.reply_to && !byMid.has(m.reply_to) ? [m.reply_to] : [])))];
  if (older.length) {
    const { results } = await env.DB.prepare(`SELECT * FROM messages WHERE subscriber_id = ?1 AND mid IN (SELECT value FROM json_each(?2))`)
      .bind(lead.subscriber_id, JSON.stringify(older.slice(0, 200)))
      .all<MediaRow>();
    for (const r of results) if (r.mid) byMid.set(r.mid, r);
  }
  const replyName = lead.first_name?.trim().split(/\s+/)[0] || lead.username || "They";
  // IG-style: a centered time above the first message and after any hour-long gap; the sender's picture by the
  // last bubble of each of their runs (same sender, under 10 minutes apart), and in a group their name over the first.
  const same = (a: MediaRow | undefined, b: MediaRow) => Boolean(a && a.role === b.role && (a.sender ?? null) === (b.sender ?? null));
  const msgs = history
    .map((m, i) => {
      const prev = history[i - 1];
      const next = history[i + 1];
      const stamp = !prev || m.created_at - prev.created_at > 60 * 60_000;
      const tail = m.role === "lead" && (!next || !same(next, m) || next.created_at - m.created_at > 10 * 60_000);
      const head = group && m.role === "lead" && (!same(prev, m) || m.created_at - (prev?.created_at ?? 0) > 10 * 60_000);
      const p = who(m);
      const quote = m.reply_to ? quoteHtml(m, byMid.get(m.reply_to) ?? null, replyName) : "";
      return `${stamp ? `<time data-t="${m.created_at}"></time>` : ""}${head ? `<div class="gs">${esc(p.username || p.first_name || "Member")}</div>` : ""}${quote}${messageHtml(
        m,
        m.mid ? media.get(m.mid) : undefined,
        tail ? avatar(p, "xs") : "",
        m.unsent_at || group ? "" : actsHtml(m),
      )}`;
    })
    .join("");
  const tagChips = tags
    .map((t) => `<span class="chip">${esc(t.tag)}<button formaction="/admin/inbox/${id}/untag" name="tag" value="${esc(t.tag)}" title="Remove">×</button></span>`)
    .join("");

  const aiToggle = group
    ? ""
    : `<form method="post">${keep}${
        env.AUTOPILOT === "true"
          ? `<button class="aitog" formaction="/admin/inbox/${id}/${paused ? "resume" : "pause"}" title="${paused ? "Turn the AI back on for this conversation" : "Stop the AI on this conversation"}">
      <span class="tog${paused ? "" : " on"}"></span><span class="lbl">${paused ? "Paused here" : "AI on"}</span></button>`
          : `<button class="aitog" formaction="/admin/inbox/${id}/ai" title="${soloOn ? "Turn the AI off for this conversation" : "Master switch is off: turn the AI on for just this conversation"}">
      <span class="tog${soloOn ? " on" : ""}"></span><span class="lbl">${soloOn ? "AI on here" : "AI off · turn on here"}</span></button>`
      }</form>`;
  // Instagram's Send API only reaches one person, so a group is read-only here.
  const compose = group
    ? `<div class="compose"><div class="note">Group chat: Instagram's API can't send to groups, so reply in the Instagram app. The AI never answers here.</div></div>`
    : `<div class="compose"><form id="rxf" method="post" action="/admin/inbox/${id}/react" hidden>${keep}<input name="mid"><input name="emoji"></form>
  <div class="rpbar" data-name="${esc(lead.first_name || lead.username || "them")}" hidden><div class="rp-t"><div class="rp-to"></div><div class="rp-q"></div></div>
    <button type="button" onclick="unrp()" aria-label="Cancel reply" title="Cancel reply">${X_ICON}</button></div>
  <form class="cbox" method="post" action="/admin/inbox/${id}/reply" onsubmit="return csend(this)">${keep}<input type="hidden" name="reply_to">
    <button type="button" class="c-emo" onclick="emo(this)" aria-label="Choose an emoji" title="Choose an emoji"${left ? "" : " disabled"}>${EMOJI_ICON}</button>
    <textarea name="bubbles" rows="1" oninput="cgrow(this)" onkeydown="ckey(event,this)" placeholder="${left ? "Message..." : "Reply window closed"}"${left ? "" : " disabled"}></textarea>
    ${left ? `<button class="c-send" aria-label="Send" title="Send">${SEND_ICON}</button>` : ""}</form>
  <div class="note">${left ? `${hm(left)} left in the reply window · {{SKOOL_LINK}} works` : "Reply window closed: Instagram only allows replies within 24h of their last message."}</div></div>`;

  const thread = `<section class="pane ib-thread">
  <div class="th-head"><a class="back ibtn" href="/admin/inbox${esc(fq)}" aria-label="Back to inbox">${icon("back", 26, 2)}</a>
    <a class="who" onclick="info()" title="Details">${group ? groupAvatar() : avatar(lead)}<div style="min-width:0"><b>${group ? groupName(group) : esc(lead.first_name || lead.username || lead.subscriber_id)}</b>
    <small>${group ? `Group · ${group.length + 1} people` : lead.username ? `@${esc(lead.username)}` : esc(lead.subscriber_id)}${lead.test ? " · test" : ""}</small></div></a>
    ${aiToggle}
    <button type="button" class="ibtn" onclick="info()" title="Details" aria-label="Details">${icon("info", 24, 1.8)}</button></div>
  ${msg ? `<div class="err">${esc(msg)}</div>` : ""}
  <div class="msgs">${msgs || '<div class="placeholder">No messages yet.</div>'}${typing ? '<div class="m bot typing" title="The AI is writing"><i></i><i></i><i></i></div>' : ""}</div>
  ${compose}
</section>`;

  const kv = (k: string, v: string, cls = "") => `<div class="kv${cls}"><span>${k}</span><span>${v}</span></div>`;
  const tagsSec = `<div class="sd"><h4>Tags</h4><div class="chips"><form method="post">${keep}${tagChips}</form>
    <form method="post" action="/admin/inbox/${id}/tag">${keep}<span class="addtag">${icon("plus", 12)}<input name="tag" placeholder="Add tag" aria-label="Add tag"></span></form></div></div>`;
  const sideHead = `<aside class="pane ib-side"><div class="sd-h">Details<button type="button" class="ibtn" onclick="info()" aria-label="Close details">${icon("close", 22, 1.8)}</button></div>`;
  // A member with a thread of their own links to it; anyone else to their Instagram.
  const memberRow = (m: Member) =>
    `<a class="mem" href="${ownThread.has(m.id) ? `/admin/inbox/${esc(m.id)}` : `https://instagram.com/${esc(m.username ?? "")}`}"${ownThread.has(m.id) ? "" : ' target="_blank" rel="noopener"'}>${avatar(
      people.get(m.id) ?? { subscriber_id: m.id, username: m.username, first_name: null },
      "xs",
    )}<span>@${esc(m.username ?? m.id)}</span></a>`;
  const side = group
    ? `${sideHead}
  <div class="sd-b"><div class="sd-who">${groupAvatar("lg")}<b>${groupName(group)}</b><span>Group chat · the AI never answers here</span></div>
  <div class="sd"><h4>Members · ${group.length + 1} with you</h4>${group.map(memberRow).join("")}</div>
  ${tagsSec}
  <div class="sd"><h4>Activity</h4>${kv("Messages", String(history.length))}${kv("First seen", `<time data-t="${lead.created_at}"></time>`)}</div></div></aside>`
    : `${sideHead}
  <div class="sd-b"><div class="sd-who">${avatar(lead, "lg")}<b>${esc(lead.first_name || lead.username || "")}</b>
  ${lead.username ? `<a href="https://instagram.com/${esc(lead.username)}" target="_blank" rel="noopener">@${esc(lead.username)}</a>` : ""}
  ${stageTag(lead.stage)}</div>
  <div class="sd"><h4>Setter</h4>${kv("AI", aiState(env.AUTOPILOT === "true" || lead.ai_on === 1, lead.status))}${kv("Status", esc(lead.status))}${kv("Reply window", left ? hm(left) : "Closed")}</div>
  ${tagsSec}
  <div class="sd"><h4>Activity</h4>${kv("AI note", aiNote ? esc(aiNote.note) : "None", aiNote ? " blk" : "")}${kv(
    "Link clicks",
    clicks?.n ? `${clicks.n}× · ${ago(now - (clicks.at ?? now))} ago` : "0",
  )}${kv("Messages", String(history.length))}${kv("First seen", `<time data-t="${lead.created_at}"></time>`)}</div></div></aside>`;
  return thread + side;
}

// The owner's reply from the inbox goes through sendDraft like any send: same 24h rule, same {{SKOOL_LINK}} fill.
// Returns an error to show, or null when it went out.
export async function manualReply(env: Env, lead: db.Lead, bubbles: string[], now: number, replyTo?: string): Promise<string | null> {
  if (!windowLeft(lead, now)) return "Not sent: the 24h reply window is closed.";
  const last = await env.DB.prepare(`SELECT MAX(id) id FROM messages WHERE subscriber_id = ?1`).bind(lead.subscriber_id).first<{ id: number | null }>();
  await env.DB.prepare(`UPDATE drafts SET status = 'superseded' WHERE subscriber_id = ?1 AND status = 'pending'`).bind(lead.subscriber_id).run();
  const draft = await env.DB.prepare(
    `INSERT INTO drafts (subscriber_id, after_message_id, action, bubbles, stage, note, created_at) VALUES (?1, ?2, 'reply', ?3, ?4, ?5, ?6) RETURNING *`,
  )
    .bind(lead.subscriber_id, last?.id ?? 0, JSON.stringify(bubbles), lead.stage, MANUAL_NOTE, now)
    .first<db.Draft>();
  await sendDraft(env, draft!, now, bubbles, { replyTo });
  const after = await db.getDraft(env.DB, draft!.id);
  if (after?.status === "sent") return null;
  // A failed hand reply stays here, in the thread.
  await db.setDraftStatus(env.DB, draft!.id, "rejected", after?.error ?? after?.status ?? null);
  return `Not sent: ${after?.error ?? after?.status}`;
}

// ---------- Live updates ----------

// What the Inbox polls every few seconds: changes whenever a message lands, a draft is written or sent, or the open
// thread's AI state moves. Indexed lookups only, so an open tab costs next to nothing.
async function liveStamp(env: Env, leadId: string | null, now: number): Promise<string> {
  const top = await env.DB.prepare(
    `SELECT (SELECT MAX(id) FROM messages) m, (SELECT MAX(id) FROM drafts) d, (SELECT group_concat(id || status) FROM (SELECT id, status FROM drafts ORDER BY id DESC LIMIT 5)) s`,
  ).first<{ m: number; d: number; s: string }>();
  const lead = leadId ? await db.getLead(env.DB, leadId) : null;
  return [top?.m, top?.d, top?.s, lead ? `${lead.status}${lead.ai_on}${aiWorking(lead, now) ? "w" : ""}` : ""].join(":");
}

// The Inbox's client side. Live: polls the stamp every 3s while the tab is visible and, on a change, re-fetches the page
// and swaps the list, messages and details in place (never the box you're typing in), keeping your scroll unless you
// were at the bottom. Switching chats: a conversation starts loading when you hover or touch it, and a click swaps just
// the thread and details panes (history kept), like Instagram; anything odd falls back to a normal page load.
const INBOX_JS = `<script>(function(){var last=null,busy=false,again=false,cache={},ws=null,polled=0,soon=0;
function stampUrl(){var m=location.pathname.match(/\\/admin\\/inbox\\/((?:g:)?\\d+)/);return "/admin/live"+(m?"?lead="+m[1]:"")}
function parse(h){return new DOMParser().parseFromString(h,"text/html")}
function swap(sel,d,keep){var a=document.querySelector(sel),b=d.querySelector(sel);if(!a||!b||a.innerHTML===b.innerHTML||a.contains(document.activeElement))return false;
var bottom=a.scrollHeight-a.scrollTop-a.clientHeight<80,top=a.scrollTop;a.innerHTML=b.innerHTML;a.scrollTop=keep&&bottom?a.scrollHeight:top;return true}
function ready(box){if(!box)return;if(window.fmtTimes)fmtTimes(box);if(window.initMsgs)initMsgs(box)}
function pull(){fetch(location.href,{credentials:"same-origin"}).then(function(r){return r.ok?r.text():null}).then(function(h){if(!h)return;
var d=parse(h);swap(".convs",d,false);swap(".ib-side",d,false);var th=document.querySelector(".th-head form"),nh=d.querySelector(".th-head form");if(th&&nh)th.innerHTML=nh.innerHTML;
if(!document.querySelector(".msgs .pending")&&swap(".msgs",d,true))ready(document.querySelector(".msgs"))}).finally(function(){busy=false;if(again){again=false;now()}})}
function now(){if(busy){again=true;return}busy=true;pull()}
function sock(){try{ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/admin/live/ws")}catch(e){ws=null;return}
ws.onmessage=function(e){if(e.data==="pong")return;clearTimeout(soon);soon=setTimeout(now,100)};ws.onclose=function(){ws=null;setTimeout(sock,2000)}}
function tick(){if(document.hidden||busy)return;if(ws&&ws.readyState===1&&Date.now()-polled<15000)return;polled=Date.now();fetch(stampUrl(),{credentials:"same-origin"}).then(function(r){return r.ok?r.json():null}).then(function(j){if(!j)return;
if(last!==null&&j.v!==last){busy=true;pull()}last=j.v}).catch(function(){})}
function load(href){var c=cache[href];if(c&&Date.now()-c.t<15000)return c.p;var p=fetch(href,{credentials:"same-origin"}).then(function(r){if(!r.ok)throw r;return r.text()});
cache[href]={t:Date.now(),p:p};p.catch(function(){delete cache[href]});return p}
function conv(e){var a=e.target.closest&&e.target.closest("a.conv");return a&&a.origin===location.origin?a:null}
function open(href,push){var ib=document.querySelector(".ib");if(!ib){location.href=href;return}
document.querySelectorAll(".conv.on").forEach(function(x){x.classList.remove("on")});document.querySelectorAll("a.conv").forEach(function(x){if(x.href===href)x.classList.add("on")});
load(href).then(function(h){delete cache[href];var d=parse(h),nb=d.querySelector(".ib");if(!nb)throw 0;
Array.prototype.slice.call(ib.children).forEach(function(c){if(!c.classList.contains("ib-list"))c.remove()});
Array.prototype.slice.call(nb.children).forEach(function(c){if(!c.classList.contains("ib-list"))ib.appendChild(document.adoptNode(c))});
ib.className=nb.className;document.title=d.title;if(push)history.pushState(null,"",href);last=null;
var box=document.querySelector(".msgs");ready(box);if(box)box.scrollTop=box.scrollHeight}).catch(function(){location.href=href})}
document.addEventListener("mouseover",function(e){var a=conv(e);if(a)load(a.href)});
document.addEventListener("touchstart",function(e){var a=conv(e);if(a)load(a.href)},{passive:true});
document.addEventListener("click",function(e){var a=conv(e);if(!a||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();open(a.href,true)});
window.addEventListener("popstate",function(){open(location.href,false)});
sock();setInterval(function(){if(ws&&ws.readyState===1)ws.send("ping")},25000);
setInterval(tick,3000);document.addEventListener("visibilitychange",function(){if(!document.hidden)now()});tick()})()</script>`;

// The AI is drafting (lock held) or a draft of its own is about to go or going out.
function aiWorking(lead: db.Lead, now: number): boolean {
  return (lead.drafting_until ?? 0) > now;
}

// ---------- Settings ----------

type Toggle = "autopilot" | "track_links" | "pause_on_manual_reply";
const settingsBits = (c: Awaited<ReturnType<typeof getConfig>>) => {
  const sw = (k: Toggle) => `<label class="switch"><input type="checkbox" name="${k}" value="true"${c[k] ? " checked" : ""}><span></span></label>`;
  return {
    opt: (k: Toggle, title: string, desc: string) => `<div class="opt"><div><div class="t">${title}</div><div class="d">${desc}</div></div>${sw(k)}</div>`,
    sec: (ic: string, title: string, desc: string, inner: string) =>
      `<div class="card sec"><div class="ch"><span class="ic">${icon(ic)}</span><div><h2>${title}</h2><p>${desc}</p></div></div>${inner}</div>`,
  };
};

// The token field is its own form. Putting it inside #set would submit an empty password with every Save, and the
// title-bar Save button (form="set") would post the token field too.
function igConnectionCard(link: IgLink, note: string): string {
  const detail = !link.connected
    ? "No access token is stored yet."
    : link.username
      ? "FewChat sends and reads as this account."
      : "A token is stored. Use Verify connection to confirm the account.";
  return `<div class="card sec igc"><div class="ch"><span class="ic">${icon("instagram")}</span><div><h2>Instagram connection</h2><p>Paste a long-lived access token, or connect with Instagram.</p></div></div>
${note ? `<p class="ig-note" role="status">${esc(note)}</p>` : ""}
<div class="opt"><div><div class="t ig-status"><span class="ig-dot${link.connected ? " on" : ""}" aria-hidden="true"></span>${esc(link.label)}</div><div class="d">${detail}</div></div></div>
<form method="post" action="/admin/settings/instagram" autocomplete="off">
<label for="ig_access_token">Instagram access token</label>
<input id="ig_access_token" name="ig_access_token" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" maxlength="2000" placeholder="Paste a long-lived access token">
<div class="ig-actions"><button class="ig-save" name="intent" value="save">Save token</button><button class="ghost" name="intent" value="verify">Verify connection</button></div>
</form>
<form method="post" action="/admin/settings/instagram"><button class="ghost" name="intent" value="remove">Remove token</button></form>
<p class="ig-alt"><a href="/auth/start">Connect with Instagram</a></p></div>`;
}

// Settings: the account and the link. Everything about the AI setter is on the AI page. The form names its section,
// so saving here never touches the AI's settings (and the other way round).
export async function settingsPage(env: Env, saved: boolean, ig = ""): Promise<Response> {
  const c = await getConfig(env);
  const { opt, sec } = settingsBits(c);
  const link = await instagramLink(env);
  return page(
    "Settings",
    `<form id="set" method="post" action="/admin/settings" oninput="document.getElementById('save').textContent='Save'"><input type="hidden" name="section" value="general">
${sec(
  "user",
  "Account",
  "Instagram and the link you send",
  `<div class="opt"><div><div class="t">Instagram account</div><div class="d">The account FewChat sends from. Reconnect if the token ever expires.</div></div><a href="/auth/start">Reconnect</a></div>
  <label style="margin-top:14px">Your link ({{SKOOL_LINK}} in automations and AI replies)</label><input type="url" name="skool_link" value="${esc(c.skool_link)}" required>`,
)}
${sec(
  "click",
  "Links",
  "Count who opens the link you send",
  opt(
    "track_links",
    "Track link clicks",
    "Your link goes out as a short FewChat link, so you can see who opened it. Instagram's link preview is not counted. The message shows the FewChat address instead of the real one.",
  ),
)}
</form>
${igConnectionCard(link, igNote(ig))}`,
    "admin",
    env,
    { actions: `<button id="save" form="set">${saved ? "Saved" : "Save"}</button>` },
  );
}

// The AI page's settings: how the setter behaves, what it learned from the owner's hand answers, who it never answers.
async function aiSettings(env: Env, saved: boolean): Promise<string> {
  const c = await getConfig(env);
  const { opt, sec } = settingsBits(c);
  const inMinutes = c.reply_delay_max_s > 0 && c.reply_delay_min_s % 60 === 0 && c.reply_delay_max_s % 60 === 0;
  const div = inMinutes ? 60 : 1;
  return `<form method="post" action="/admin/settings" oninput="document.getElementById('save-ai').textContent='Save'"><input type="hidden" name="section" value="ai">
${sec(
  "bot",
  "How the AI replies",
  "Pacing, and what it does when you step in",
  `<div class="opt hl"><div class="t">${icon("clock", 15)} Response time</div>
    <div class="d">Random delay before the AI replies (feels more human)</div>
    <div class="inl"><input type="number" min="0" name="reply_delay_min_s" value="${c.reply_delay_min_s / div}"> to <input type="number" min="0" name="reply_delay_max_s" value="${
      c.reply_delay_max_s / div
    }"><select name="delay_unit"><option value="seconds"${inMinutes ? "" : " selected"}>seconds</option><option value="minutes"${inMinutes ? " selected" : ""}>minutes</option></select></div></div>
  ${opt("pause_on_manual_reply", "Pause AI when you reply yourself", "The AI turns off for that conversation so it doesn't talk over you.")}
  <div class="opt"><div><div class="t">Resume AI after</div><div class="d">The AI takes over again after this wait, unless you've replied again. 0 = stay paused.</div></div>
  <div class="inl" style="margin:0"><input type="number" min="0" step="0.5" name="auto_resume_hours" value="${c.auto_resume_hours}"> hours</div></div>
  <div class="opt"><div></div><button id="save-ai" style="margin:0">${saved ? "Saved" : "Save"}</button></div>`,
)}
</form>
${sec(
  "sparkles",
  "What the AI learned",
  "When the AI hands you a question and you answer it yourself, it saves your answer here and uses it with everyone after. One fact per line: edit or delete anything.",
  `<form method="post" action="/admin/settings/learned"><textarea name="learned" rows="8" placeholder="Nothing yet.">${esc((await db.getSetting(env.DB, "learned_knowledge")) ?? "")}</textarea><button>Save</button></form>`,
)}
${sec("users", "Friends & family", "The AI never DMs these people: no replies, no follow-ups, not even a seen receipt. Automations they trigger still run.", await friendsSection(env))}`;
}

// Tagged leads plus @usernames saved before they ever DMed. Add by @username or Instagram link; remove with ×.
async function friendsSection(env: Env): Promise<string> {
  const { results } = await env.DB.prepare(
    `SELECT l.subscriber_id, l.username, l.first_name FROM lead_tags t JOIN leads l ON l.subscriber_id = t.subscriber_id WHERE t.tag = ?1 ORDER BY lower(COALESCE(l.first_name, l.username))`,
  )
    .bind(db.FRIEND)
    .all<{ subscriber_id: string; username: string | null; first_name: string | null }>();
  const known = new Set(results.map((r) => (r.username ?? "").toLowerCase()));
  const waiting = (await db.friendHandles(env.DB)).filter((h) => !known.has(h));
  const drop = (key: string, value: string) =>
    `<form method="post" action="/admin/settings/friends"><input type="hidden" name="remove_${key}" value="${esc(value)}"><button class="ghost">Remove</button></form>`;
  const rows = [
    ...results.map(
      (r) =>
        `<div class="opt"><div><div class="t"><a href="/admin/inbox/${r.subscriber_id}">${esc(r.first_name || r.username || r.subscriber_id)}</a></div><div class="d">@${esc(r.username ?? "")}</div></div>${drop("lead", r.subscriber_id)}</div>`,
    ),
    ...waiting.map((h) => `<div class="opt"><div><div class="t">@${esc(h)}</div><div class="d">Hasn't DMed you yet</div></div>${drop("handle", h)}</div>`),
  ].join("");
  return `${rows || '<div class="opt"><div class="d">Nobody yet.</div></div>'}
<form method="post" action="/admin/settings/friends" class="opt"><input name="add" placeholder="@username" autocomplete="off" style="margin:0" required><button style="margin:0">Add</button></form>`;
}

// "@x", "x", "instagram.com/x/" -> "x"
const handleOf = (s: string) => s.trim().replace(/^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com\/)?@?/i, "").replace(/[/?#].*$/, "").toLowerCase();

export async function saveFriends(env: Env, form: FormData, now: number): Promise<void> {
  const handles = await db.friendHandles(env.DB);
  const add = handleOf(String(form.get("add") ?? ""));
  if (/^[a-z0-9._]{1,30}$/.test(add)) {
    const lead = await env.DB.prepare(`SELECT subscriber_id FROM leads WHERE lower(username) = ?1`).bind(add).first<{ subscriber_id: string }>();
    if (lead) await env.DB.prepare(`INSERT OR IGNORE INTO lead_tags (subscriber_id, tag, created_at) VALUES (?1, ?2, ?3)`).bind(lead.subscriber_id, db.FRIEND, now).run();
    else if (!handles.includes(add)) handles.push(add); // no thread yet: held by username until they DM
  }
  const lead = String(form.get("remove_lead") ?? "");
  let gone = String(form.get("remove_handle") ?? "").toLowerCase();
  if (lead) {
    await env.DB.prepare(`DELETE FROM lead_tags WHERE subscriber_id = ?1 AND tag = ?2`).bind(lead, db.FRIEND).run();
    gone = ((await db.getLead(env.DB, lead))?.username ?? "").toLowerCase();
  }
  await db.setSetting(env.DB, "friends", JSON.stringify(handles.filter((h) => h !== gone)));
}

// A form saves its own section ("general" = the link and tracking, "ai" = the setter's pacing and pauses) and leaves
// the rest as it is; a post with no section saves everything it carries, unchecked boxes included.
export async function saveSettings(env: Env, form: FormData): Promise<void> {
  const cur = await getConfig(env);
  const section = String(form.get("section") ?? "");
  const general = section !== "ai";
  const ai = section !== "general";
  const unit = form.get("delay_unit") === "minutes" ? 60 : 1;
  const numOr = (k: string, fallback: number, mult = 1) => {
    const v = Number(form.get(k));
    return form.get(k) !== null && form.get(k) !== "" && Number.isFinite(v) && v >= 0 ? v * mult : fallback;
  };
  const min = numOr("reply_delay_min_s", cur.reply_delay_min_s, unit);
  const max = numOr("reply_delay_max_s", cur.reply_delay_max_s, unit);
  const link = String(form.get("skool_link") ?? "").trim();
  await saveConfig(env.DB, {
    autopilot: section ? cur.autopilot : form.get("autopilot") === "true", // the AI page's switch owns it (POST /admin/ai)
    reply_delay_min_s: ai ? Math.min(min, max) : cur.reply_delay_min_s,
    reply_delay_max_s: ai ? Math.max(min, max) : cur.reply_delay_max_s,
    skool_link: general && /^https:\/\/\S+$/.test(link) ? link : cur.skool_link,
    track_links: general ? form.get("track_links") === "true" : cur.track_links,
    pause_on_manual_reply: ai ? form.get("pause_on_manual_reply") === "true" : cur.pause_on_manual_reply,
    auto_resume_hours: ai ? numOr("auto_resume_hours", cur.auto_resume_hours) : cur.auto_resume_hours,
  });
}

// ---------- Routing ----------

// Handles the console's own routes; null = not ours (automations and form posts in admin.ts take it from there).
export async function consoleRoute(env: Env, req: Request, pathname: string, who: Role, now = Date.now()): Promise<Response | null> {
  const url = new URL(req.url);
  const to = (path: string) => Response.redirect(new URL(path, req.url).toString(), 303);
  const forbidden = new Response("not allowed for the reviewer login", { status: 403 });

  const r = url.searchParams.get("range") ?? "7d";
  const range = (r in RANGES ? r : "7d") as Range;
  if (pathname === "/admin/dashboard" && req.method === "GET") {
    // The browser's UTC offset (theme.ts HEAD leaves it in a cookie), so Home's days are the viewer's days.
    const tz = Number((req.headers.get("Cookie") ?? "").match(/(?:^|;\s*)tz=(-?\d{1,4})(?:;|$)/)?.[1] ?? 0);
    return homePage(env, who, range, now, Math.abs(tz) <= 840 ? tz : 0);
  }
  if (pathname === "/admin/ai" && req.method === "GET") return aiPage(env, who, range, now, url.searchParams.has("saved"));
  if (pathname === "/admin/contacts" && req.method === "GET") return contactsPage(env, who, url.searchParams);
  if (pathname === "/admin/profile" && req.method === "GET") return profilePage(env, who);
  if (pathname === "/admin/help" && req.method === "GET") return helpPage(env, who);
  if (pathname === "/admin/inbox" && req.method === "GET") return inboxPage(env, who, url.searchParams, now);
  if (pathname === "/admin/live" && req.method === "GET") return Response.json({ v: await liveStamp(env, url.searchParams.get("lead"), now) });
  // The master AI switch in the sidebar: one tap flips autopilot for every thread.
  if (pathname === "/admin/ai" && req.method === "POST") {
    if (who !== "admin") return forbidden;
    const c = await getConfig(env);
    if (!c.autopilot && aiBlocker(env)) return Response.redirect(new URL("/admin/ai", req.url).toString(), 303); // the page says what's missing
    await saveConfig(env.DB, { ...c, autopilot: !c.autopilot });
    return Response.redirect(new URL(req.headers.get("Referer") ?? "/admin/ai", req.url).toString(), 303);
  }
  if (pathname === "/admin/settings/learned" && req.method === "POST") {
    if (who !== "admin") return forbidden;
    await db.setSetting(env.DB, "learned_knowledge", String((await req.formData()).get("learned") ?? "").trim());
    return to("/admin/ai");
  }
  if (pathname === "/admin/settings/friends" && req.method === "POST") {
    if (who !== "admin") return forbidden;
    await saveFriends(env, await req.formData(), now);
    return to("/admin/ai");
  }
  if (pathname === "/admin/settings/instagram") {
    if (who !== "admin") return forbidden;
    if (req.method !== "POST") return to("/admin/settings");
    if (crossSite(req)) return new Response("cross-origin request refused", { status: 403 });
    const form = await req.formData();
    const intent = String(form.get("intent") ?? "");
    const preview = isPreviewHost(req);
    const pasted = String(form.get("ig_access_token") ?? "");
    let code = "invalid";
    if (intent === "remove") {
      await clearInstagramToken(env);
      code = "removed";
    } else if (intent === "verify" && !pasted.trim()) {
      code = await verifyInstagramToken(env, { preview, now });
    } else if (intent === "save" || intent === "verify") {
      code = await storeInstagramToken(env, pasted, { preview, now });
    } else return new Response("not found", { status: 404 });
    return to(`/admin/settings?ig=${code}`);
  }
  if (pathname === "/admin/settings") {
    if (who !== "admin") return forbidden;
    if (req.method === "GET") return settingsPage(env, url.searchParams.has("saved"), url.searchParams.get("ig") ?? "");
    const form = await req.formData();
    await saveSettings(env, form);
    return to(form.get("section") === "ai" ? "/admin/ai?saved=1" : "/admin/settings?saved=1");
  }

  const m = pathname.match(/^\/admin\/inbox\/((?:g:)?\d+)(?:\/(reply|pause|resume|ai|react|tag|untag))?$/); // g: = a group chat
  if (!m) return null;
  const lead = await db.getLead(env.DB, m[1]);
  if (!lead) return new Response("not found", { status: 404 });
  if (who === "review" && !lead.test) return forbidden;
  if (!m[2]) return req.method === "GET" ? inboxPage(env, who, url.searchParams, now, lead) : null;
  if (req.method !== "POST") return null;

  const form = await req.formData();
  // Back to the thread with the list filters it was opened with.
  const fq = new URLSearchParams(String(form.get("f") ?? "").replace(/^\?/, ""));
  const back = (extra?: [string, string]) => {
    const p = new URLSearchParams(filterQs(fq).slice(1));
    if (extra) p.set(...extra);
    return to(`/admin/inbox/${lead.subscriber_id}${p.toString() ? `?${p}` : ""}`);
  };
  if (m[2] === "pause" || m[2] === "resume") {
    await db.setLeadStatus(env.DB, lead.subscriber_id, m[2] === "pause" ? "paused" : "active");
  } else if (m[2] === "ai") {
    // Test the AI on one real thread with the master switch off. On: it answers their next message, or nudges now
    // (next cron tick) when we spoke last. Off: anything it had queued is dropped.
    if (lead.ai_on === 1 && lead.status === "active") {
      await env.DB.batch([
        env.DB.prepare(`UPDATE leads SET ai_on = 0, followup_due_at = NULL WHERE subscriber_id = ?1`).bind(lead.subscriber_id),
        env.DB.prepare(`UPDATE drafts SET status = 'superseded' WHERE subscriber_id = ?1 AND status = 'pending'`).bind(lead.subscriber_id),
      ]);
    } else {
      if (aiBlocker(env)) return Response.redirect(new URL("/admin/ai", req.url).toString(), 303); // nothing to answer with yet
      await env.DB.prepare(
        `UPDATE leads SET ai_on = 1, status = 'active', paused_reason = NULL, paused_at = NULL,
           followup_due_at = CASE WHEN (SELECT role FROM messages WHERE subscriber_id = ?1 ORDER BY id DESC LIMIT 1) = 'bot' THEN ?2 END
         WHERE subscriber_id = ?1`,
      )
        .bind(lead.subscriber_id, now)
        .run();
      await db.clearHandoff(env.DB, lead.subscriber_id);
    }
  } else if (m[2] === "react") {
    // Tapping the reaction that's already ours takes it off, like the app.
    const mid = String(form.get("mid") ?? "");
    const row = await env.DB.prepare(`SELECT reactions FROM messages WHERE subscriber_id = ?1 AND mid = ?2`).bind(lead.subscriber_id, mid).first<{ reactions: string | null }>();
    if (!row) return back(["msg", "Not sent: that message isn't in this thread."]);
    const rx = JSON.parse(row.reactions ?? "{}") as { lead?: string; you?: string };
    const pick = String(form.get("emoji") ?? "").slice(0, 16);
    const emoji = pick && pick !== rx.you ? pick : null;
    const token = await db.getSetting(env.DB, "ig_token");
    try {
      if (!token) throw new Error("instagram not connected");
      await react(token, lead.subscriber_id, mid, emoji);
    } catch (e) {
      return back(["msg", `Not sent: ${String(e).replace(/^Error: /, "")}`]);
    }
    const next = { ...rx, you: emoji ?? undefined };
    await env.DB.prepare(`UPDATE messages SET reactions = ?3 WHERE subscriber_id = ?1 AND mid = ?2`).bind(lead.subscriber_id, mid, JSON.stringify(next)).run();
  } else if (m[2] === "tag" || m[2] === "untag") {
    const tag = String(form.get("tag") ?? "").trim().toLowerCase().slice(0, 40);
    if (tag && m[2] === "tag") {
      await env.DB.prepare(`INSERT OR IGNORE INTO lead_tags (subscriber_id, tag, created_at) VALUES (?1, ?2, ?3)`).bind(lead.subscriber_id, tag, now).run();
    } else if (tag) {
      await env.DB.prepare(`DELETE FROM lead_tags WHERE subscriber_id = ?1 AND tag = ?2`).bind(lead.subscriber_id, tag).run();
    }
  } else {
    // Like Instagram: one send = one message, line breaks kept (Shift+Enter in the box).
    const text = String(form.get("bubbles") ?? "").trim();
    const bubbles = text ? [text] : [];
    const err = bubbles.length ? await manualReply(env, lead, bubbles, now, String(form.get("reply_to") ?? "") || undefined) : null;
    if (err) return back(["msg", err]);
  }
  await ping(env, lead.subscriber_id); // your other open tabs and devices
  return back();
}
