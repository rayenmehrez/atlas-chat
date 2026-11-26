// One-off history import from the Instagram API into D1: every DM conversation (all messages) and every comment
// on every post. Writes SQL files; it never touches D1 itself. Run:
//   IG_TOKEN=... [SKOOL_GROUP=<slug>] node scripts/backfill.mjs <out dir> [--since=<ISO date>]
// --since: only conversations active since then (whole threads), no comments. For a quick first look.
// Each API page is written to its own numbered .sql file as soon as it's fetched, with a checkpoint in state.json,
// so a run that gets killed picks up where it stopped when started again with the same <out dir>.
// A thread is ordered by message id, so each message only goes in if its thread has nothing newer yet: imports never
// land after messages the webhook recorded meanwhile, and threads we already have just get their missing tail.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const unified = String(process.env.IG_TOKEN ?? "").startsWith("EA");
const G = unified ? "https://graph.facebook.com/v27.0" : "https://graph.instagram.com/v26.0";
const SKOOL = process.env.SKOOL_GROUP ? `skool.com/${process.env.SKOOL_GROUP}` : null; // marks threads that got the link
const [out] = process.argv.slice(2);
const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const since = sinceArg ? Date.parse(sinceArg.slice(8)) : null;
const token = process.env.IG_TOKEN;
if (!out || !token) throw new Error("usage: IG_TOKEN=... node scripts/backfill.mjs <out dir> [--since=<ISO date>]");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let meId = null;

function resolve(url) {
  let path = url.startsWith("http") ? url.replace(/^https:\/\/graph\.(?:instagram|facebook)\.com(?:\/v[\d.]+)?/, "") : url;
  path = path.replace(/([?&])access_token=[^&]*&?/, "$1").replace(/[?&]$/, "");
  if (unified && meId && /^\/me(?=\/|\?|$)/.test(path) && !path.startsWith("/me/assigned_instagram_accounts")) {
    path = path.replace(/^\/me(?=\/|\?|$)/, `/${meId}`);
  }
  return `${G}${path}`;
}

async function get(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(resolve(url), { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (res.ok && !body.error) return body;
    if (attempt >= 6) throw new Error(`${res.status} ${JSON.stringify(body.error ?? body).replaceAll(token, "[token]")}`);
    await sleep(2000 * 2 ** attempt); // rate limits: back off and retry
  }
}
const ME = unified
  ? (await get("/me/assigned_instagram_accounts?fields=id,username")).data?.find((a) => a.id)?.id
  : (await get("/me?fields=user_id")).user_id; // the account the token belongs to
if (!ME) throw new Error(unified ? "no assigned Instagram account on this Unified Login token" : "instagram: no user id");
meId = ME;

const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const ms = (t) => Date.parse(t);
// Paging URLs carry the token; the checkpoint never stores it (the header carries it on every call anyway).
const strip = (u) => (u ? u.replace(/([?&])access_token=[^&]*&?/, "$1").replace(/[?&]$/, "") : null);

mkdirSync(out, { recursive: true });
const STATE = `${out}/state.json`;
const fields = "participants,updated_time,messages.limit(100){id,created_time,from,message,attachments{mime_type}}";
const st = existsSync(STATE)
  ? JSON.parse(readFileSync(STATE, "utf8"))
  : {
      phase: "dm",
      next: `/me/conversations?platform=instagram&limit=50&fields=${encodeURIComponent(fields)}`,
      media: since ? null : `/me/media?fields=id&limit=50`,
      seq: 0,
      stats: { conversations: 0, leads: 0, messages: 0, link_sent: 0, comments: 0, posts: 0 },
    };
const { stats } = st;
const save = (sql, kind) => {
  if (sql.length) writeFileSync(`${out}/${String(st.seq++).padStart(5, "0")}-${kind}.sql`, sql.join("\n") + "\n");
  writeFileSync(STATE, JSON.stringify(st));
};

// --- DMs ---
while (st.phase === "dm" && st.next) {
  const page = await get(st.next);
  const sql = [];
  let done = false;
  for (const c of page.data) {
    // Conversations come newest-active first, so the first one older than --since ends the run.
    if (since && ms(c.updated_time) < since) {
      done = true;
      break;
    }
    stats.conversations++;
    const others = (c.participants?.data ?? []).filter((p) => p.id !== ME);
    if (others.length !== 1) continue; // group chats: the live sync files them as their own conversation (src/sync.ts)
    const lead = others[0];
    const msgs = [...(c.messages?.data ?? [])];
    let more = c.messages?.paging?.next;
    while (more && msgs.length % 100 === 0) {
      const p = await get(more);
      msgs.push(...p.data);
      more = p.paging?.next;
    }
    if (!msgs.length) continue;
    msgs.sort((a, b) => ms(a.created_time) - ms(b.created_time)); // ids order the thread, so insert oldest first
    const leadMsgs = msgs.filter((m) => m.from?.id !== ME);
    const lastInbound = leadMsgs.length ? ms(leadMsgs.at(-1).created_time) : null;
    const linkSent = Boolean(SKOOL) && msgs.some((m) => m.from?.id === ME && (m.message ?? "").includes(SKOOL));
    stats.leads++;
    if (linkSent) stats.link_sent++;
    sql.push(
      `INSERT OR IGNORE INTO leads (subscriber_id, username, stage, last_inbound_at, created_at) VALUES (${q(lead.id)}, ${q(lead.username)}, ${q(linkSent ? "link_sent" : "opener")}, ${q(lastInbound)}, ${q(ms(msgs[0].created_time))});`,
      // A lead we already had may have written while the webhook missed it.
      `UPDATE leads SET last_inbound_at = ${q(lastInbound)}, username = COALESCE(username, ${q(lead.username)}) WHERE subscriber_id = ${q(lead.id)} AND ${q(lastInbound)} IS NOT NULL AND COALESCE(last_inbound_at, 0) < ${q(lastInbound)};`,
    );
    for (const m of msgs) {
      const text = m.message || (m.attachments?.data?.length ? `[${(m.attachments.data[0].mime_type ?? "attachment").split("/")[0]}]` : "[attachment]");
      const at = ms(m.created_time);
      sql.push(
        `INSERT OR IGNORE INTO messages (subscriber_id, role, text, created_at, mid) SELECT ${q(lead.id)}, ${q(m.from?.id === ME ? "bot" : "lead")}, ${q(text)}, ${at}, ${q(m.id)} WHERE NOT EXISTS (SELECT 1 FROM messages WHERE subscriber_id = ${q(lead.id)} AND created_at > ${at});`,
      );
      stats.messages++;
    }
  }
  st.next = done ? null : strip(page.paging?.next);
  if (!st.next) st.phase = "comments";
  save(sql, "dm");
  process.stderr.write(`\rconversations ${stats.conversations}  messages ${stats.messages}   `);
  await sleep(250);
}

// --- Comments (history only: status 'imported', no trigger fires). One checkpoint per page of 50 posts. ---
while (st.phase === "comments" && st.media) {
  const page = await get(st.media);
  const sql = [];
  for (const p of page.data) {
    stats.posts++;
    let cnext = `/${p.id}/comments?fields=id,text,timestamp,from&limit=50`;
    while (cnext) {
      const cp = await get(cnext);
      for (const c of cp.data) {
        if (!c.from?.id || c.from.id === ME || !c.text) continue; // our own replies (Manychat's "sent" etc.)
        sql.push(
          `INSERT OR IGNORE INTO comments (comment_id, subscriber_id, username, media_id, text, status, created_at) VALUES (${q(c.id)}, ${q(c.from.id)}, ${q(c.from.username)}, ${q(p.id)}, ${q(c.text)}, 'imported', ${q(ms(c.timestamp))});`,
        );
        stats.comments++;
      }
      cnext = cp.paging?.next;
      await sleep(150);
    }
  }
  st.media = strip(page.paging?.next);
  save(sql, "comments");
  process.stderr.write(`\rposts ${stats.posts}  comments ${stats.comments}   `);
}
st.phase = "done";
save([], "");
process.stderr.write("\n");
console.log(JSON.stringify(stats));
