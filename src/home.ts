// Home: how the DMs are doing. Messages in and out per day, who's new, and what people did with the automation DMs
// (opened, tapped, clicked a link, replied), for a range and against the range before it. Nothing here is about the AI
// setter: that has its own page (src/dashboard.ts aiPage). The reviewer login sees test threads only.
//
// Days are the viewer's own: the browser leaves its UTC offset in a `tz` cookie (theme.ts HEAD) and a range is whole
// local days ending today, so "7 days" is today plus the six before it and the chart's buckets match the calendar.

import { esc, me, page, type Role } from "./admin";
import { barRow, CHART_JS, lineChart } from "./charts";
import { agoLong, RANGE_LABEL, RANGES, type Range } from "./dashboard";
import * as db from "./db";
import { recentProblems } from "./health";
import type { Env } from "./setter";
import { icon } from "./theme";

const DAY = 24 * 60 * 60 * 1000;
const SCOPE = `(?2 = 'admin' OR l.test = 1) AND l.members IS NULL`; // group chats aren't contacts
const NOT_TAP = `m.text NOT LIKE '[tapped]%'`; // a button tap lands as a lead message; it isn't one
const SOURCE: Record<string, string> = { comment: "Comment keyword", dm: "DM keyword", story: "Story reply", mention: "Story mention", welcome: "Welcome message", none: "Started by another automation" };

interface Inbound {
  msgs: number;
  people: number;
}
interface Reach {
  people: number; // got at least one automation DM
  opened: number; // a read receipt covered it (only people who share receipts: a floor)
  tapped: number; // tapped any button or quick reply, link buttons included
  hadLink: number; // got a message with a link button (the only links that can be counted)
  linked: number; // opened one
  replied: number; // wrote back after it
}

export interface HomeWindow {
  since: number; // ms, start of the range (0 = all time)
  prev: number | null; // start of the range before it, null for all time
  days: number | null;
  today: number; // local day number of `now`
  off: number; // the viewer's UTC offset in ms (positive = behind UTC)
}

// The range as whole local days ending today.
export function homeWindow(range: Range, now: number, tzMin: number): HomeWindow {
  const off = tzMin * 60_000;
  const today = Math.floor((now - off) / DAY);
  if (range === "all") return { since: 0, prev: null, days: null, today, off };
  const days = RANGES[range] / DAY;
  const since = (today - days + 1) * DAY + off;
  return { since, prev: since - days * DAY, days, today, off };
}

const num = (n: number) => n.toLocaleString("en-US");
const rate = (part: number, whole: number) => (whole ? (100 * part) / whole : null);
const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 10) / 10}%`);

// "+12%", colored by direction, against the same number of days just before (the line above the tiles says so once).
// Rates compare in points. No prior range (all time) = the range's name.
function delta(cur: number | null, prev: number | null | undefined, kind: "count" | "pts", w: HomeWindow, label: string): string {
  if (w.days === null || prev === undefined) return `<small>${label}</small>`;
  if (cur === null || prev === null) return `<small>No earlier data</small>`;
  if (kind === "count" && !prev) return cur ? `<small class="up">${icon("up", 12, 2.4)}Up from 0</small>` : `<small>No change</small>`;
  const d = kind === "pts" ? Math.round((cur - prev) * 10) / 10 : Math.round((100 * (cur - prev)) / prev);
  if (!d) return `<small>No change</small>`;
  return `<small class="${d > 0 ? "up" : "down"}">${icon(d > 0 ? "up" : "down", 12, 2.4)}${d > 0 ? "+" : ""}${d}${kind === "pts" ? " pts" : "%"}</small>`;
}

export async function homePage(env: Env, who: Role, range: Range, now: number, tzMin = 0): Promise<Response> {
  const D = env.DB;
  const w = homeWindow(range, now, tzMin);
  const one = async <T>(sql: string, ...binds: unknown[]) => (await D.prepare(sql).bind(...binds).first<T>()) as T;

  const inbound = (from: number, to: number) =>
    one<Inbound>(
      `SELECT COUNT(*) AS msgs, COUNT(DISTINCT m.subscriber_id) AS people FROM messages m JOIN leads l ON l.subscriber_id = m.subscriber_id
       WHERE m.role = 'lead' AND m.created_at >= ?1 AND m.created_at < ?3 AND ${NOT_TAP} AND ${SCOPE}`,
      from,
      who,
      to,
    );
  const fresh = async (from: number, to: number) =>
    (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM leads l WHERE l.created_at >= ?1 AND l.created_at < ?3 AND ${SCOPE}`, from, who, to)).n;
  const reach = (from: number, to: number) =>
    one<Reach>(
      `SELECT COUNT(DISTINCT s.subscriber_id) AS people,
         COUNT(DISTINCT CASE WHEN s.seen_at IS NOT NULL THEN s.subscriber_id END) AS opened,
         COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM flow_taps t WHERE t.send_id = s.id) THEN s.subscriber_id END) AS tapped,
         COUNT(DISTINCT CASE WHEN s.url IS NOT NULL OR (s.urls IS NOT NULL AND s.urls NOT IN ('', '{}')) THEN s.subscriber_id END) AS hadLink,
         COUNT(DISTINCT CASE WHEN s.clicked_at IS NOT NULL OR EXISTS (SELECT 1 FROM flow_taps t WHERE t.send_id = s.id
           AND (t.port = 'url' OR json_extract(s.urls, '$."' || t.port || '"') IS NOT NULL)) THEN s.subscriber_id END) AS linked,
         COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM messages m WHERE m.subscriber_id = s.subscriber_id AND m.role = 'lead'
           AND m.created_at > s.created_at AND ${NOT_TAP}) THEN s.subscriber_id END) AS replied
       FROM flow_sends s JOIN leads l ON l.subscriber_id = s.subscriber_id
       WHERE s.status = 'sent' AND s.trigger_id > 0 AND s.created_at >= ?1 AND s.created_at < ?3 AND ${SCOPE}`,
      from,
      who,
      to,
    );

  const end = now + 1;
  const [inNow, newNow, reachNow] = [await inbound(w.since, end), await fresh(w.since, end), await reach(w.since, end)];
  const [inPrev, newPrev, reachPrev] = w.prev === null ? [null, null, null] : [await inbound(w.prev, w.since), await fresh(w.prev, w.since), await reach(w.prev, w.since)];

  // Messages per local day, both directions.
  const { results: daily } = await D.prepare(
    `SELECT CAST((m.created_at - ?3) / ${DAY} AS INTEGER) AS d, m.role, COUNT(*) AS n FROM messages m JOIN leads l ON l.subscriber_id = m.subscriber_id
     WHERE m.created_at >= ?1 AND ${NOT_TAP} AND ${SCOPE} GROUP BY d, m.role`,
  )
    .bind(w.since, who, w.off)
    .all<{ d: number; role: string; n: number }>();
  const first = w.days === null ? Math.min(w.today, ...daily.map((r) => r.d)) : w.today - w.days + 1;
  const span = w.today - first + 1;
  const weekly = span > 120; // all time on a long history: one point a week
  const size = weekly ? 7 : 1;
  const buckets = Math.ceil(span / size);
  const got = new Array<number>(buckets).fill(0);
  const sent = new Array<number>(buckets).fill(0);
  for (const r of daily) {
    const i = Math.floor((r.d - first) / size);
    if (i >= 0 && i < buckets) (r.role === "lead" ? got : sent)[i] += r.n;
  }
  const dayLabel = (d: number) => new Date(d * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const labels = got.map((_, i) => (weekly ? `Week of ${dayLabel(first + i * size)}` : dayLabel(first + i)));
  const sentTotal = sent.reduce((a, b) => a + b, 0);

  // The automations that reached the most people in the range.
  const { results: top } = await D.prepare(
    `SELECT s.trigger_id AS id, COUNT(DISTINCT s.subscriber_id) AS people,
       COUNT(DISTINCT CASE WHEN s.seen_at IS NOT NULL THEN s.subscriber_id END) AS opened,
       COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM flow_taps t WHERE t.send_id = s.id) THEN s.subscriber_id END) AS tapped
     FROM flow_sends s JOIN leads l ON l.subscriber_id = s.subscriber_id
     WHERE s.status = 'sent' AND s.trigger_id > 0 AND s.created_at >= ?1 AND ${SCOPE} GROUP BY s.trigger_id ORDER BY people DESC LIMIT 8`,
  )
    .bind(w.since, who)
    .all<{ id: number; people: number; opened: number; tapped: number }>();
  const { results: triggers } = await D.prepare(`SELECT id, name, keyword, source, enabled, deleted_at FROM triggers WHERE id > 0`).all<{
    id: number;
    name: string | null;
    keyword: string;
    source: string;
    enabled: number;
    deleted_at: number | null;
  }>();
  const byId = new Map(triggers.map((t) => [t.id, t]));
  const live = triggers.filter((t) => t.enabled && !t.deleted_at).length;

  const { results: starts } = await D.prepare(
    `SELECT t.source, COUNT(*) AS n FROM flow_starts f JOIN triggers t ON t.id = f.trigger_id JOIN leads l ON l.subscriber_id = f.subscriber_id
     WHERE f.status = 'sent' AND f.trigger_id > 0 AND f.created_at >= ?1 AND ${SCOPE} GROUP BY t.source ORDER BY n DESC`,
  )
    .bind(w.since, who)
    .all<{ source: string; n: number }>();
  const startTotal = starts.reduce((a, s) => a + s.n, 0);
  const comments = await one<{ total: number; sent: number | null; failed: number | null; queued: number | null }>(
    `SELECT COUNT(*) AS total, SUM(c.status = 'sent') AS sent, SUM(c.status = 'failed') AS failed, SUM(c.status = 'queued') AS queued
     FROM comments c WHERE c.created_at >= ?1 AND (?2 = 'admin' OR c.text LIKE '%settertest%')`,
    w.since,
    who,
  );

  const contacts = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM leads l WHERE ?1 = ?1 AND ${SCOPE}`, 0, who)).n;
  const open = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM leads l WHERE l.last_inbound_at > ?1 AND ${SCOPE}`, now - db.WINDOW_MS, who)).n;
  const problems = who === "admin" ? await recentProblems(D, now - DAY) : [];

  const label = RANGE_LABEL[range];
  const stat = (name: string, value: string, sub: string) => `<div class="stat"><div class="lbl">${name}</div><b>${value}</b>${sub}</div>`;
  const replyNow = rate(reachNow.replied, reachNow.people);
  const ctrNow = rate(reachNow.tapped, reachNow.people);
  const kpis = [
    stat("Messages received", num(inNow.msgs), delta(inNow.msgs, inPrev?.msgs, "count", w, label)),
    stat("People who messaged", num(inNow.people), delta(inNow.people, inPrev?.people, "count", w, label)),
    stat("New contacts", num(newNow), delta(newNow, newPrev ?? undefined, "count", w, label)),
    stat("Automation reach", num(reachNow.people), delta(reachNow.people, reachPrev?.people, "count", w, label)),
    stat("Reply rate", pct(replyNow), delta(replyNow, reachPrev ? rate(reachPrev.replied, reachPrev.people) : undefined, "pts", w, label)),
    stat("Click-through rate", pct(ctrNow), delta(ctrNow, reachPrev ? rate(reachPrev.tapped, reachPrev.people) : undefined, "pts", w, label)),
  ].join("");

  const chart = lineChart(
    [
      { name: "Received", color: "var(--pri)", values: got, fill: true },
      { name: "Sent", color: "var(--series2)", values: sent },
    ],
    labels,
    {
      label: `Messages per ${weekly ? "week" : "day"}, ${label.toLowerCase()}: ${num(inNow.msgs)} received, ${num(sentTotal)} sent`,
      empty: "No messages in this range yet. They show up here as soon as someone DMs you.",
    },
  );

  const share = (n: number) => (reachNow.people ? n / reachNow.people : null);
  const funnel = reachNow.people
    ? [
        barRow("Got an automation DM", reachNow.people, 1),
        barRow("Opened it", reachNow.opened, share(reachNow.opened), "at least"),
        barRow("Tapped a button", reachNow.tapped, share(reachNow.tapped)),
        // Only link buttons go through our redirect; a link typed into the message text can't be counted.
        reachNow.hadLink ? barRow("Opened a link button", reachNow.linked, reachNow.linked / reachNow.hadLink, `of ${num(reachNow.hadLink)} who got one`) : "",
        barRow("Replied", reachNow.replied, share(reachNow.replied)),
        reachNow.hadLink ? "" : `<p class="foot-note">Link opens aren't shown: no link buttons went out. A link typed into a message can't be counted, a link button can.</p>`,
      ].join("")
    : `<p class="none">No automation DMs went out in this range.${who === "admin" ? ` <a href="/admin/automations">Set up an automation</a> and its numbers land here.` : ""}</p>`;

  const topRows = top
    .map((r) => {
      const t = byId.get(r.id);
      const name = t ? t.name || t.keyword : `Automation ${r.id}`;
      const state = !t || t.deleted_at ? "In Trash" : t.enabled ? "Live" : "Off";
      return `<tr><td><a class="nm" href="/admin/flows/${r.id}">${esc(name)}</a><small>${esc(t ? (SOURCE[t.source] ?? t.source) : "")}${t?.keyword && t.keyword !== "*" && t.source !== "none" ? ` · ${esc(t.keyword)}` : ""} · ${state}</small></td>
<td class="r">${num(r.people)}</td><td class="r wide">${pct(rate(r.opened, r.people))}</td><td class="r wide">${num(r.tapped)}</td><td class="r">${pct(rate(r.tapped, r.people))}</td></tr>`;
    })
    .join("");
  const topTable = top.length
    ? `<table class="tbl"><thead><tr><th>Automation</th><th class="r">People</th><th class="r wide">Opened</th><th class="r wide">Clicked</th><th class="r">CTR</th></tr></thead><tbody>${topRows}</tbody></table>`
    : `<p class="none">Nothing ran in this range. Once an automation sends its first DM, it's ranked here by how many people it reached.</p>`;

  const startRows = starts.map((s) => barRow(SOURCE[s.source] ?? s.source, s.n, startTotal ? s.n / startTotal : null, "", true)).join("");
  const commentLine = comments.total
    ? `<p class="foot-note">${num(comments.total)} comments read · ${num(comments.sent ?? 0)} got a DM${comments.queued ? ` · ${num(comments.queued)} waiting to send` : ""}${
        comments.failed ? ` · ${num(comments.failed)} failed` : ""
      }</p>`
    : "";

  const problemsCard = problems.length
    ? `<div class="card"><div class="ph"><div><h2>Delivery problems</h2><p>What failed to send in the last 24 hours. Your phone gets an alert when one keeps happening.</p></div></div>
${problems.map((p) => `<div class="row"><span><b>${esc(p.kind)} ×${p.n}</b><br><small>${esc((p.detail ?? "").split("\n")[0].slice(0, 200))}</small></span><span class="st">${agoLong(now - p.last_at)}</span></div>`).join("")}</div>`
    : "";

  const ranges = (Object.keys(RANGES) as Range[])
    .map((r) => `<a href="?range=${r}"${r === range ? ' class="on" aria-current="true"' : ""} aria-label="${RANGE_LABEL[r]}"><span class="w">${r === "all" ? "All time" : r.replace("d", " days")}</span><span class="n">${r === "all" ? "All" : r}</span></a>`)
    .join("");

  const acct = await me(env);
  const token = await db.getSetting(D, "ig_token");
  const connected = Boolean(token || acct?.username);
  const helloName = (acct?.name || "").trim().split(/\s+/)[0] || "Rayen";
  const aiOn = ((await db.getSetting(D, "autopilot")) ?? env.AUTOPILOT) === "true";
  const commentLive = triggers.some((t) => t.source === "comment" && t.enabled && !t.deleted_at);
  const replyOn = aiOn || triggers.some((t) => (t.source === "dm" || t.source === "welcome") && t.enabled && !t.deleted_at);
  const openFlow = (source: string) => {
    const t = triggers.find((x) => x.source === source && !x.deleted_at);
    return t ? `/admin/flows/${t.id}` : "/admin/automations";
  };
  const steps: { done: boolean; title: string; href: string }[] = [
    { done: connected, title: "Connect your Instagram account", href: connected ? "/admin/profile" : "/auth/start" },
    { done: commentLive, title: "Turn on a comment automation", href: openFlow("comment") },
    { done: replyOn, title: "Reply to every DM", href: "/admin/ai" },
  ];
  const doneN = steps.filter((s) => s.done).length;
  const start = (href: string, title: string, popular = false) =>
    `<a class="start" href="${href}"><span class="start-t">${title}</span><span class="start-f">${icon("automations", 14, 2)}<span>Quick Automation</span>${popular ? `<span class="pop">POPULAR</span>` : ""}</span></a>`;
  const checklist = steps
    .map(
      (s) => `<a class="move${s.done ? " done" : ""}" href="${s.href}"><span class="tick">${s.done ? icon("check", 12, 2.6) : ""}</span><span class="grow">${s.title}</span><span class="chev">${icon("chevron", 16, 2)}</span></a>`,
    )
    .join("");

  let waiting = "";
  try {
    const { results: hold } = await D.prepare(
      `SELECT l.subscriber_id, l.username, l.first_name, m.text AS last_text
       FROM leads l JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE subscriber_id = l.subscriber_id AND role = 'lead')
       WHERE l.status = 'paused' AND l.members IS NULL AND (?1 = 'admin' OR l.test = 1)
       ORDER BY m.created_at DESC LIMIT 5`,
    )
      .bind(who)
      .all<{ subscriber_id: string; username: string | null; first_name: string | null; last_text: string }>();
    const rows = hold
      .map((r) => {
        const name = r.first_name || (r.username ? `@${r.username}` : r.subscriber_id);
        return `<a class="li" href="/admin/inbox/${esc(r.subscriber_id)}"><div class="grow"><div class="t">${esc(name)}</div><div class="s">${esc(r.last_text.slice(0, 140))}</div></div>${icon("chevron")}</a>`;
      })
      .join("");
    waiting = `<div class="card flush"><div class="ph"><div><h2>Waiting on you</h2><p>Conversations paused until someone replies in person.</p></div></div>${rows || `<p class="none">Nothing is waiting on you.</p>`}</div>`;
  } catch {
    waiting = "";
  }

  return page(
    "Dashboard",
    `<h2 class="hello">Hello, ${esc(helloName)}!</h2>
<p class="hello-meta">${connected ? "1 connected channel" : "No channel connected"} · <b>${num(contacts)}</b> contacts · <a href="#insights">See Insights</a></p>
<div class="sec-h"><h3>Start here</h3><a href="/admin/automations">Explore all Templates</a></div>
<div class="start-grid">${start(openFlow("comment"), "Auto-DM links from comments", true)}${start(openFlow("story"), "Generate leads with stories")}${start("/admin/ai", "Respond to all your DMs")}</div>
<h3 class="sec-title">Your next best moves</h3>
<div class="moves"><div class="k">First steps</div><b>You're nailing it! Keep your audience's attention with the remaining automations</b>
<div class="bar" role="progressbar" aria-valuenow="${doneN}" aria-valuemin="0" aria-valuemax="3"><i style="width:${Math.round((100 * doneN) / 3)}%"></i></div>
<div class="cap">${doneN} of 3 completed</div>${checklist}</div>
<div id="insights"><p class="meta"><span><b>${num(contacts)}</b> contacts</span><span><b>${num(live)}</b> automations live</span><span><b>${num(open)}</b> conversations open for replies</span>${w.days ? `<span class="cmp">Arrows compare with the ${w.days} days before</span>` : ""}</p>
<div class="stats">${kpis}</div>
<div class="cols"><div class="card"><div class="ph"><div><h2>Messages per ${weekly ? "week" : "day"}</h2></div>
<div class="lgd"><span><i style="background:var(--pri)"></i>Received<b>${num(inNow.msgs)}</b></span><span><i style="background:var(--series2)"></i>Sent<b>${num(sentTotal)}</b></span></div></div>
${chart}</div>
<div class="card"><div class="ph"><div><h2>What people did with your automation DMs</h2><p>Share of everyone who got one.</p></div></div>${funnel}</div></div>
<div class="cols"><div class="card"><div class="ph"><div><h2>Top automations</h2></div><a href="/admin/automations">All automations</a></div>${topTable}</div>
<div class="card"><div class="ph"><div><h2>What started them</h2><p>Automation runs by trigger.</p></div></div>${startRows || `<p class="none">No runs in this range.</p>`}${commentLine}</div></div>
${problemsCard}${waiting}</div>${CHART_JS}`,
    who,
    env,
    { actions: `<nav class="seg" aria-label="Date range">${ranges}</nav>` },
  );
}
