// Admin basics behind basic auth: roles, the page shell, the Automations page, and the form posts for triggers and
// pausing/resuming a lead. There is no approval queue: the AI is on (autopilot) or off.

import { automationsBody } from "./admin_flows";
import * as db from "./db";
import { fetchAccount, recentMedia, type Media } from "./meta";
import { hasSession } from "./session";
import type { Env } from "./setter";
import { APP_NAME, HEAD, icon, LOGO } from "./theme";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function authorized(req: Request, password: string): boolean {
  const header = req.headers.get("Authorization") ?? "";
  if (!password || !header.startsWith("Basic ")) return false;
  const [, pass] = atob(header.slice(6)).split(/:(.*)/s);
  return pass === password;
}

export type Role = "admin" | "review";

// The Instagram-login cookie (src/session.ts) or the basic-auth password; the reviewer only has a password.
export async function role(req: Request, env: Env): Promise<Role | null> {
  if (await hasSession(req, env)) return "admin";
  return authorized(req, env.ADMIN_PASSWORD) ? "admin" : authorized(req, env.REVIEW_PASSWORD) ? "review" : null;
}

export function splitBubbles(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export type Section = "Dashboard" | "Contacts" | "Automations" | "AI" | "Inbox" | "Settings" | "Profile" | "Help";
// The sidebar, top to bottom. [section, label, href, icon]
const NAV: [Section, string, string, string][] = [
  ["Dashboard", "Home", "/admin/dashboard", "home"],
  ["Contacts", "Contacts", "/admin/contacts", "user"],
  ["Automations", "Automation", "/admin/automations", "automations"],
  ["AI", "AI", "/admin/ai", "sparkles"],
  ["Inbox", "Inbox", "/admin/inbox", "chat"],
  ["Settings", "Settings", "/admin/settings", "settings"],
];
const TITLE: Record<Section, string> = { Dashboard: "Home", Contacts: "Contacts", Automations: "Automation", AI: "AI", Inbox: "Inbox", Settings: "Settings", Profile: "My Profile", Help: "Help" };

// The connected Instagram account, for the sidebar and My Profile. Asked from Instagram at most every 6 hours (setting
// `ig_profile`); a failed read keeps the last answer, so no page ever waits on or breaks over it.
export interface Me {
  username: string | null;
  name: string | null;
  pic: string | null;
}
const ME_TTL_MS = 6 * 60 * 60 * 1000;
export async function me(env: Env, now = Date.now()): Promise<Me | null> {
  let cur: (Me & { at: number }) | null = null;
  try {
    cur = JSON.parse((await db.getSetting(env.DB, "ig_profile")) ?? "null") as (Me & { at: number }) | null;
  } catch {
    cur = null;
  }
  if (cur && now - cur.at < ME_TTL_MS) return cur;
  try {
    const token = await db.getSetting(env.DB, "ig_token");
    if (!token) return cur;
    const a = await fetchAccount(token);
    // Never cache a field that contains the access token: the sidebar renders username, name and pic.
    if (typeof a?.username !== "string" || a.username.includes(token)) return cur;
    const pic = a.profile_picture_url && !a.profile_picture_url.includes(token) ? a.profile_picture_url : null;
    const name = a.name && !a.name.includes(token) ? a.name : null;
    const next = { username: a.username, name, pic, at: now };
    await db.setSetting(env.DB, "ig_profile", JSON.stringify(next));
    return next;
  } catch {
    return cur;
  }
}
export const meAvatar = (m: Me | null) =>
  `<span class="av" style="background:#5764fa">${esc((m?.name || m?.username || "F").charAt(0).toUpperCase())}${
    m?.pic ? `<img src="${esc(m.pic)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""
  }</span>`;

export interface PageOpts {
  title?: string; // the title bar's heading, when it isn't the section's name
  actions?: string; // buttons or controls on the right of the title bar
}

// The shell every console page renders in: the sidebar (logo, account, the six pages, the
// collapse button, My Profile, the light / dark toggle), a title bar, then the page. On a phone the sidebar is a bottom tab bar and the
// title bar carries the profile picture. The Inbox and the automation editor fill the screen, so they hide the title
// bar (CSS). Styles live in theme.ts.
export async function page(active: Section, body: string, who: Role, env: Env, opts: PageOpts = {}): Promise<Response> {
  const acct = await me(env);
  const nav = NAV.filter(([n]) => who === "admin" || n !== "Settings")
    .map(([n, label, href, ic]) => `<a class="nv${n === active ? " on" : ""}" href="${href}" title="${label}"${n === active ? ' aria-current="page"' : ""}>${icon(ic, 24, 1.7)}<span class="l">${label}</span></a>`)
    .join("");
  const who2 = acct?.username
    ? `<a class="who" href="/admin/profile" title="@${esc(acct.username)}">${meAvatar(acct)}<span class="l">${esc(acct.name || acct.username)}<small>@${esc(acct.username)}</small></span></a>`
    : `<a class="who" href="${who === "admin" ? "/auth/start" : "/admin/profile"}">${meAvatar(null)}<span class="l">${who === "admin" ? "Connect Instagram" : APP_NAME}</span></a>`;
  const key = active.toLowerCase();
  const title = opts.title ?? TITLE[active];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)} · ${APP_NAME}</title>${HEAD}</head><body class="p-${key}">
<aside class="side" aria-label="Main navigation"><a class="brand" href="/admin/dashboard"><span class="logo" aria-hidden="true">${LOGO}</span><span class="l">${APP_NAME}</span></a>
${who2}
<nav>${nav}</nav><div class="gap"></div>
<div class="fold"><button type="button" onclick="foldNav(this)" aria-label="Collapse navigation" aria-expanded="true" title="Collapse">${icon("fold", 20, 1.8)}</button></div>
<div class="foot"><a class="nv${active === "Profile" ? " on" : ""}" href="/admin/profile" title="My Profile">${meAvatar(acct)}<span class="l">My Profile</span></a>
<button type="button" class="nv" onclick="flipTheme()" title="Switch between light and dark" aria-label="Switch between light and dark"><span class="th-d">${icon("moon", 24, 1.7)}<span class="l">Dark mode</span></span><span class="th-l">${icon("sun", 24, 1.7)}<span class="l">Light mode</span></span></button></div></aside>
<main class="m-${key}"><header class="tb"><h1>${esc(title)}</h1><div class="tb-r">${opts.actions ?? ""}<a class="me" href="/admin/profile" aria-label="My Profile">${meAvatar(acct)}</a></div></header>
<div class="wrap">
${body}
</div></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const mediaLabel = (m: Media) => `${(m.caption ?? "").replace(/\s+/g, " ").slice(0, 60) || "(no caption)"} · ${m.timestamp?.slice(0, 10) ?? ""}`;

export async function automationsPage(env: Env, req: Request, who: Role): Promise<Response> {
  const token = await db.getSetting(env.DB, "ig_token");
  const media: Media[] = token ? await recentMedia(token).catch(() => []) : [];
  const label = new Map(media.map((m) => [m.id, mediaLabel(m)]));
  const { results: comments } = await env.DB.prepare(
    `SELECT c.*, t.keyword FROM comments c LEFT JOIN triggers t ON t.id = c.trigger_id
     WHERE ?1 = 'admin' OR c.text LIKE '%settertest%' ORDER BY c.created_at DESC LIMIT 30`,
  ).bind(who).all<{ username: string | null; text: string; status: string; error: string | null; keyword: string | null; created_at: number }>();

  const feed = comments
    .map(
      (c) => `<div class="row"><div>${esc(c.username ? `@${c.username}` : "someone")}: ${esc(c.text)}${c.error ? `<div class="note">${esc(c.error)}</div>` : ""}</div>
        <span class="st ${esc(c.status)}">${esc(c.status === "sent" ? `DM sent (${c.keyword ?? ""})` : c.status)}</span></div>`,
    )
    .join("");
  return page("Automations", await automationsBody(env, req, who, label, Date.now(), `<div class="card"><b>Recent comments</b>${feed || '<p class="note">No comments yet.</p>'}</div>`), who, env);
}

export async function handleAdminPost(env: Env, req: Request, path: string, who: Role = "admin"): Promise<Response> {
  const back = Response.redirect(new URL(req.headers.get("Referer") ?? "/admin/inbox", req.url).toString(), 303);
  const toAutomations = Response.redirect(new URL("/admin/automations", req.url).toString(), 303);
  const forbidden = new Response("not allowed for the reviewer login", { status: 403 });
  const testLead = async (id: string) => Boolean((await db.getLead(env.DB, id))?.test);
  if (who === "review" && path.startsWith("/admin/triggers")) return forbidden;
  if (path === "/admin/triggers") {
    const f = await req.formData();
    const keyword = String(f.get("keyword") ?? "").trim();
    const dm = String(f.get("dm") ?? "").trim();
    if (keyword && dm) {
      await env.DB.prepare(`INSERT INTO triggers (keyword, media_id, dm, public_reply, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
        .bind(keyword, String(f.get("media_id") ?? "") || null, dm, String(f.get("public_reply") ?? "").trim() || null, Date.now())
        .run();
    }
    return toAutomations;
  }
  const triggerMatch = path.match(/^\/admin\/triggers\/(\d+)\/(toggle|delete)$/);
  if (triggerMatch) {
    const sql = triggerMatch[2] === "toggle" ? `UPDATE triggers SET enabled = 1 - enabled WHERE id = ?1` : `DELETE FROM triggers WHERE id = ?1`;
    await env.DB.prepare(sql).bind(Number(triggerMatch[1])).run();
    return toAutomations;
  }
  const leadMatch = path.match(/^\/admin\/leads\/(\d+)\/(pause|resume)$/);
  if (leadMatch) {
    if (who === "review" && !(await testLead(leadMatch[1]))) return forbidden;
    await db.setLeadStatus(env.DB, leadMatch[1], leadMatch[2] === "pause" ? "paused" : "active");
    return back;
  }
  return new Response("not found", { status: 404 });
}
