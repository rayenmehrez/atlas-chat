// Contacts: everyone who has DMed or commented, newest activity first, with their tags.
// Tags (with counts) down the left as the filter, search and the list on the right. A row opens that
// person's thread in the Inbox. Group chats aren't contacts; the reviewer login sees test threads only.

import { esc, page, type Role } from "./admin";
import { avatar } from "./dashboard";
import type { Env } from "./setter";
import { icon } from "./theme";

const PAGE = 50;
const SCOPE = `(?1 = 'admin' OR l.test = 1) AND l.members IS NULL`;

interface Row {
  subscriber_id: string;
  username: string | null;
  first_name: string | null;
  profile_pic: string | null;
  created_at: number;
  last_at: number | null;
  last_inbound_at: number | null;
  status: string;
  tags: string | null;
}

const SEGMENTS = ["engaged", "handoff", "paused"] as const;
type Seg = (typeof SEGMENTS)[number];
const segSql = (seg: Seg | "") =>
  seg === "engaged"
    ? `AND (EXISTS (SELECT 1 FROM clicks c WHERE c.subscriber_id = l.subscriber_id) OR EXISTS (SELECT 1 FROM flow_taps tp JOIN flow_sends fs ON fs.id = tp.send_id WHERE fs.subscriber_id = l.subscriber_id))`
    : seg === "handoff"
      ? `AND l.status = 'paused' AND l.paused_reason = 'handoff'`
      : seg === "paused"
        ? `AND l.status = 'paused'`
        : "";

export async function contactsPage(env: Env, who: Role, q: URLSearchParams): Promise<Response> {
  const search = (q.get("q") ?? "").trim().replace(/^@/, "").slice(0, 60);
  const tag = (q.get("tag") ?? "").trim().toLowerCase().slice(0, 40);
  const seg = SEGMENTS.includes(q.get("seg") as Seg) ? (q.get("seg") as Seg) : "";
  const auto = /^\d+$/.test(q.get("auto") ?? "") ? q.get("auto")! : "";
  const pageNo = Math.max(1, Math.floor(Number(q.get("page")) || 1));
  const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const where = `${SCOPE}${search ? ` AND (l.username LIKE ?2 ESCAPE '\\' OR l.first_name LIKE ?2 ESCAPE '\\')` : " AND ?2 = ?2"}${
    tag ? ` AND EXISTS (SELECT 1 FROM lead_tags t WHERE t.subscriber_id = l.subscriber_id AND t.tag = ?3)` : " AND ?3 = ?3"
  }${auto ? ` AND EXISTS (SELECT 1 FROM flow_starts f WHERE f.trigger_id = ?4 AND f.subscriber_id = l.subscriber_id AND f.status = 'sent')` : " AND ?4 = ?4"}${segSql(seg)}`;
  const binds = [who, like, tag, auto || "0"] as const;
  const { results: rows } = await env.DB.prepare(
    `SELECT l.subscriber_id, l.username, l.first_name, l.profile_pic, l.created_at, l.last_at, l.last_inbound_at, l.status,
       (SELECT group_concat(t.tag, char(10)) FROM lead_tags t WHERE t.subscriber_id = l.subscriber_id) AS tags
     FROM leads l WHERE ${where} ORDER BY l.last_at DESC, l.subscriber_id LIMIT ${PAGE + 1} OFFSET ${(pageNo - 1) * PAGE}`,
  )
    .bind(...binds)
    .all<Row>();
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM leads l WHERE ${where}`).bind(...binds).first<{ n: number }>())?.n ?? 0;
  const { results: tags } = await env.DB.prepare(
    `SELECT t.tag, COUNT(*) AS n FROM lead_tags t JOIN leads l ON l.subscriber_id = t.subscriber_id WHERE ${SCOPE} GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT 30`,
  )
    .bind(who)
    .all<{ tag: string; n: number }>();
  const count = async (extra: string) =>
    (await env.DB.prepare(`SELECT COUNT(*) AS n FROM leads l WHERE ${SCOPE} ${extra}`).bind(who).first<{ n: number }>())?.n ?? 0;
  const segCounts = {
    all: await count(""),
    engaged: await count(segSql("engaged")),
    handoff: await count(segSql("handoff")),
    paused: await count(segSql("paused")),
  };
  const { results: autos } = await env.DB.prepare(
    `SELECT t.id, COALESCE(NULLIF(t.name, ''), t.keyword) AS name, COUNT(DISTINCT f.subscriber_id) AS n
     FROM triggers t JOIN flow_starts f ON f.trigger_id = t.id AND f.status = 'sent'
     JOIN leads l ON l.subscriber_id = f.subscriber_id
     WHERE t.deleted_at IS NULL AND ${SCOPE} GROUP BY t.id, t.name, t.keyword ORDER BY n DESC, name LIMIT 12`,
  )
    .bind(who)
    .all<{ id: number; name: string; n: number }>();

  const link = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const next = { q: search, tag, seg, auto, ...over };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/contacts${s ? `?${s}` : ""}`;
  };
  const more = rows.length > PAGE;
  const list = rows
    .slice(0, PAGE)
    .map((r) => {
      const name = r.first_name || (r.username ? `@${r.username}` : r.subscriber_id);
      const chips = (r.tags ?? "").split("\n").filter(Boolean);
      const fresh = r.last_inbound_at && Date.now() - r.last_inbound_at < 24 * 60 * 60 * 1000;
      const pill = r.status === "paused" ? "paused" : r.status === "active" && fresh ? "active" : "subscribed";
      const pillLabel = pill === "paused" ? "Paused" : pill === "active" ? "Active" : "Subscribed";
      return `<a class="ct-row" href="/admin/inbox/${esc(r.subscriber_id)}"><span class="nm">${avatar(r)}<div><b>${esc(name)}</b>${r.first_name && r.username ? `<small>@${esc(r.username)}</small>` : ""}${
        chips.length ? `<span class="chips">${chips.slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join("")}${chips.length > 3 ? `<span class="chip">+${chips.length - 3}</span>` : ""}</span>` : ""
      }</div></span>
<span class="stpill ${pill}">${pillLabel}</span>
<span class="when">${r.last_at ? `<time data-t="${r.last_at}" data-day></time>` : "–"}<small class="first">Joined <time data-t="${r.created_at}" data-day></time></small></span></a>`;
    })
    .join("");
  const empty = search || tag ? `Nobody matches${search ? ` "${esc(search)}"` : ""}${tag ? ` with the tag ${esc(tag)}` : ""}. <a href="/admin/contacts">Show everyone</a>` : "No contacts yet. Anyone who DMs you or comments a keyword shows up here.";
  const segLink = (id: Seg | "", label: string, n: number) =>
    `<a href="${link({ seg: id || null, tag: null, auto: null, page: null })}"${(id || "") === seg && !tag && !auto ? ' class="on"' : ""} aria-label="${label}, ${n} contacts"><span>${label}</span><span>${n.toLocaleString("en-US")}</span></a>`;
  const side = `<aside class="ct-side"><h3>Segments</h3>${segLink("", "All Contacts", segCounts.all)}${segLink("engaged", "Engaged", segCounts.engaged)}${segLink("handoff", "Needs Handoff", segCounts.handoff)}${segLink("paused", "Paused", segCounts.paused)}
<h3>Tags</h3>${
    tags.map((t) => `<a href="${link({ tag: t.tag, seg: null, auto: null, page: null })}"${t.tag === tag ? ' class="on"' : ""}><span>${esc(t.tag)}</span><span>${t.n.toLocaleString("en-US")}</span></a>`).join("") ||
    `<p class="none">No tags yet. Automations and the Inbox can tag people.</p>`
  }${
    autos.length
      ? `<h3>Automations</h3>${autos
          .map(
            (a) =>
              `<a href="${link({ auto: String(a.id), tag: null, seg: null, page: null })}"${auto === String(a.id) ? ' class="on"' : ""}><span>${esc(a.name)}</span><span>${a.n.toLocaleString("en-US")}</span></a>`,
          )
          .join("")}`
      : ""
  }</aside>`;
  const pager =
    pageNo > 1 || more
      ? `<div class="pager">${pageNo > 1 ? `<a href="${link({ page: pageNo > 2 ? String(pageNo - 1) : null })}">Newer</a>` : "<span></span>"}${more ? `<a href="${link({ page: String(pageNo + 1) })}">Older</a>` : ""}</div>`
      : "";

  return page(
    "Contacts",
    `<div class="ct">${side}<div class="ct-main"><div class="ct-bar"><button type="button" class="ct-filter" onclick="this.closest('.ct').classList.toggle('hide-side')">Filter</button>
<form method="get" action="/admin/contacts" role="search">${tag ? `<input type="hidden" name="tag" value="${esc(tag)}">` : ""}${seg ? `<input type="hidden" name="seg" value="${esc(seg)}">` : ""}${auto ? `<input type="hidden" name="auto" value="${esc(auto)}">` : ""}
<div class="srch">${icon("search", 16)}<input type="search" name="q" value="${esc(search)}" placeholder="Search" aria-label="Search contacts"></div></form>
<span class="ct-count"><b>${total.toLocaleString("en-US")}</b> total</span></div>
<div class="ct-tbl"><div class="ct-h"><span>Name</span><span>Status</span><span>Last active</span></div>${list || `<p class="none">${empty}</p>`}</div>${pager}</div></div>`,
    who,
    env,
  );
}
