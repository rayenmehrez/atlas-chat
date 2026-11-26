// The Automations page and flow editor: My Automations (folders, search, trigger and state
// filters, sort by name / runs / modified, LIVE / DRAFT / OFF, Runs, CTR, on/off switch, rename / duplicate / move /
// delete, bulk move and delete, Trash), templates for the common Instagram automations, Basic Automations (Default
// Reply = the AI setter, Welcome Message, Conversation Starters, Main Menu, Story Mention Reply), and the whiteboard
// editor at /admin/flows/<id> (src/flow_editor.ts) with autosave and Publish. The reviewer login can look but not
// change anything.

import { esc, page, type Role } from "./admin";
import { NEXT_POST, type Trigger } from "./comments";
import * as db from "./db";
import { EDITOR_CSS, EDITOR_JS } from "./flow_editor";
import { saveIceBreakers, saveMenu, testCode } from "./flows";
import { editorGraph, graphStats, loadGraph, publish, sanitize, STAGES, triggerCfg, validate, type Graph, type Node } from "./graph";
import { fetchAccount, recentMedia, recentStories, redactSecrets, type Media, type Story } from "./meta";
import type { Env } from "./setter";
import { icon } from "./theme";

const CSS = `<style>
/* The Automation page: a 196px sub-nav on the left, then a 1070px column: heading + New
   Automation, a 4-column row of search and filters, folders on the same 4 columns, Trash on the right, then a card per
   automation on one grid (name | switch | runs | CTR | modified | menu) with its trigger on a second line. */
.m-automations .wrap:has(.au){max-width:none;padding:0}
.au{display:flex;gap:0;align-items:stretch;min-height:calc(100vh - 56px)}
.au-nav{flex:none;width:200px;padding:16px 12px;display:flex;flex-direction:column;gap:4px;background:var(--bg)}
.au-nav a{display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;border-radius:999px;border:1px solid transparent;color:var(--ink2);font-size:14px;line-height:20px;opacity:1}
.au-nav a svg{color:var(--mut)}
.au-nav a:hover{background:var(--soft);opacity:1;color:var(--ink)}.au-nav a.on{background:var(--soft);border-color:var(--line);color:var(--ink);font-weight:700}
.au-nav a.on svg{color:var(--ink)}
.au-main{flex:1;min-width:0;max-width:none;margin:0;padding:24px 28px 48px;background:var(--bg)}
.au-h{display:flex;justify-content:space-between;min-height:42px;align-items:center;gap:12px;margin:0 0 16px}
.au-h h2{font-size:20px;line-height:28px;font-weight:700;letter-spacing:-.02em;color:var(--ink)}
.au-h h2 a{color:var(--mut)}
.mc-btn{display:inline-flex;align-items:center;gap:8px;height:36px;white-space:nowrap;background:var(--blue);color:#fff;border-radius:8px;padding:0 14px;font-weight:700;font-size:14px;border:0;margin:0;opacity:1;cursor:pointer}
.mc-btn:hover{background:var(--blue2);opacity:1}
.au-f{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 16px}
.au-fds{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
.au-f>*{margin:0}
.au-f input,.au-f select{height:36px;margin:0;padding:0 12px;border-radius:8px;background-color:var(--card);border:1px solid var(--line2);font-size:14px;color:var(--ink)}
.au-f select{width:auto;min-width:180px;padding-right:30px;color:var(--ink2)}
.au-f .srch{margin:0;flex:1 1 240px}.au-f .srch input{padding-left:36px;font-size:14px;border-radius:8px;background:var(--card);border:1px solid var(--line2)}.au-f .srch svg{left:12px;top:10px}
.au-fds{margin-bottom:16px}
.au-fd{position:relative;display:flex;align-items:center;gap:8px;height:36px;border:1px solid var(--line);border-radius:999px;padding:0 8px 0 12px;background:var(--card);box-shadow:none;color:var(--ink);opacity:1;min-width:0}
.au-fd>a{flex:1;color:var(--ink);display:flex;align-items:center;gap:10px;min-width:0;height:100%;opacity:1}.au-fd>a span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.au-fd svg{color:var(--pri)}
.au-fd small{color:var(--mut)}
.au-fd.new{border-color:var(--pri);color:var(--pri);background:none;box-shadow:none;justify-content:flex-start;cursor:pointer;margin:0;font-size:14px;font-weight:500;padding:0 12px}
.au-fd.new:hover{background:color-mix(in srgb,var(--pri) 6%,transparent)}
.au-tr{display:flex;justify-content:flex-end;margin:0 0 40px}
.au-tr a{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:500}
.au-cols,.au-row{display:grid;grid-template-columns:18px minmax(0,1fr) 36px 56px 56px 112px 32px;column-gap:24px;align-items:center}
.au-cols{font-size:12px;line-height:16px;color:var(--mut);font-weight:600;padding:0 20px 8px}.au-cols a{color:var(--mut);opacity:1}.au-cols a:hover,.au-cols a.on{color:var(--ink)}.au-cols .r{text-align:right}
.au-cols>:nth-child(2),.au-row>.nmc,.au-row>.trg{margin-left:-10px}
.au-row{row-gap:12px;border-radius:12px;padding:16px 20px;margin-bottom:10px;background:var(--card);border:1px solid var(--line);box-shadow:0 1px 2px rgba(11,31,75,.04)}
:root[data-theme=dark] .au-row,:root[data-theme=dark] .au-fd:not(.new){box-shadow:none;border:1px solid var(--line)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .au-row,:root:not([data-theme=light]) .au-fd:not(.new){box-shadow:none;border:1px solid var(--line)}}
.au-row input[type=checkbox],.au-cols input[type=checkbox]{width:18px;height:18px;margin:0;display:block;accent-color:var(--pri)}
.au-row .nm{color:var(--ink);font-size:16px;line-height:20px;font-weight:600;opacity:1;display:flex;align-items:center;min-width:0}.au-row .nm span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.au-row .nm:hover span:last-child{color:var(--pri)}
.au-row .trg{font-size:12px;line-height:20px;color:var(--mut);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-num{font-weight:500;text-align:right;font-variant-numeric:tabular-nums}.au-row .mod{color:var(--mut);white-space:nowrap}
.au-row .sub{display:none}
.au-row .sw{display:grid;place-items:center}
.st-b{display:inline-block;font-size:10px;line-height:16px;font-weight:700;letter-spacing:.04em;padding:2px 6px;border-radius:4px;margin-right:8px;flex:none;border:1px solid transparent}
.st-b.live{background:#E03121;color:#fff}.st-b.draft{background:var(--soft);color:var(--mut);border-color:var(--line)}
.st-b.off{font-size:0;line-height:0;background:#EEF2F8;color:transparent;border-color:var(--line2);vertical-align:middle}
.st-b.off::after{content:"PAUSED";font-size:10px;line-height:16px;font-weight:700;letter-spacing:.04em;color:var(--mut)}
.ig{display:inline-block;width:12px;height:12px;border-radius:4px;background:linear-gradient(45deg,#fdb641,#f5543b,#d62a8a,#7b3fe4);vertical-align:-2px;margin-right:6px}
.au-row .trg .chip{padding:1px 6px;line-height:16px;font-weight:600;margin:0 2px;border-radius:6px;color:var(--ink2);background:var(--soft);border:1px solid var(--line2)}
.au .switch{position:relative;display:inline-block;width:36px;height:20px;margin:0}.au .switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;z-index:1}
.au .switch span{position:absolute;inset:0;border-radius:999px;background:var(--track);transition:.15s}.au .switch span:after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}
.au .switch span:before{display:none}.au .switch input:checked+span{background:var(--green)}.au .switch input:checked+span:after{left:18px}
.au-m{position:relative}.au-m summary{list-style:none;cursor:pointer;padding:2px 6px;border-radius:6px;color:var(--mut);font-size:18px;line-height:20px;text-align:center}.au-m summary::-webkit-details-marker{display:none}
.au-m summary:hover{background:var(--soft)}
.au-m>div{position:absolute;right:0;top:32px;z-index:4;background:var(--elev);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.15);padding:6px;min-width:200px}
.au-m form{margin:0}.au-m button,.au-m select{display:block;width:100%;text-align:left;background:none;color:var(--ink);font-weight:500;padding:9px 12px;margin:0;border:0;border-radius:8px}
.au-m button:hover{background:var(--hover)}.au-m button.dz{color:var(--red)}.au-m select{background-color:var(--soft);margin:4px 0}
.au-bulk{display:none;position:sticky;bottom:12px;z-index:3;align-items:center;gap:8px;background:var(--elev);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.15);padding:10px 12px;margin-top:8px}
.au:has(.au-row input[form=bulk]:checked) .au-bulk{display:flex}.au-bulk select{margin:0;width:auto;flex:1}.au-bulk button{margin:0}
.au-empty{border:1px dashed var(--line);border-radius:10px;padding:28px;text-align:center;color:var(--mut)}
.au-main>.card{border-radius:10px;margin-top:24px}
dialog.au-new{border:0;border-radius:18px;padding:0;max-width:720px;width:calc(100% - 32px);background:var(--bg);color:var(--ink);box-shadow:0 20px 60px rgba(0,0,0,.3)}
dialog.au-new::backdrop{background:rgba(0,0,0,.45)}
.au-new .hd{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid var(--line)}.au-new .hd h2{font-size:18px}
.au-new .hd button{margin:0;background:none;color:var(--mut);font-size:22px;padding:0 6px}
.au-tpl{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;padding:20px}
.au-tpl form{margin:0}.au-tpl button{display:block;width:100%;height:100%;margin:0;text-align:left;background:var(--elev);color:var(--ink);border:1px solid var(--line);border-radius:14px;padding:14px;font-weight:600}
.au-tpl button:hover{background:var(--hover);border-color:var(--mut)}.au-tpl small{display:block;color:var(--mut);font-weight:400;font-size:12px;line-height:16px;margin-top:6px}
.au-tpl .em{font-size:22px;display:block;margin-bottom:8px}
.basic .row{align-items:center;padding:16px 0}.basic .row b{font-weight:600}.basic .row p{margin:4px 0 0;color:var(--mut);font-size:13px}.basic .row form{margin:0}
.live-pill{color:var(--green);font-size:13px;font-weight:600;white-space:nowrap;padding:7px 4px}
.off-pill{color:var(--mut);font-size:13px;font-weight:600;white-space:nowrap;padding:7px 4px}
.bk{margin:0 0 4px}.bk a{font-weight:600;color:var(--mut)}.wrap:has(.bk) .ttl{display:none}
.err{color:var(--red);background:color-mix(in srgb,var(--red) 10%,transparent);border-radius:10px;padding:10px 12px;margin-bottom:12px}
@media (max-width:1100px){
  .au-nav{width:150px}
  .au-f,.au-fds{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:767px){
  .m-automations .wrap:has(.au){padding:0 16px 32px}
  .au{flex-direction:column;gap:0;align-items:stretch}
  .au-nav{width:auto;flex-direction:row;gap:6px;padding-top:12px}
  .au-main{padding-top:16px;max-width:none}
  .au-h{margin-bottom:16px}.au-h h2{font-size:20px;line-height:28px}
  .au-f .srch{grid-column:1/-1}
  .au-tr{margin-bottom:20px}
  .au-cols{display:none}
  .au-row{grid-template-columns:minmax(0,1fr) auto auto;column-gap:12px;row-gap:10px;padding:16px;margin-bottom:12px}
  .au-row>.cb,.au-row>.sp,.au-row>.ctr,.au-row>.mod,.au-row>.sub{display:none}
  .au-row>.nmc,.au-row>.trg{margin-left:0}
  .au-row>.trg{white-space:normal}
  .au-row>.sw{grid-column:2/-1;justify-self:end}
}
</style>`;

const SOURCES: { value: Trigger["source"]; label: string }[] = [
  { value: "comment", label: "Post or Reel Comments" },
  { value: "story", label: "Story Reply" },
  { value: "dm", label: "DM Keyword" },
  { value: "mention", label: "Story Mention" },
  { value: "welcome", label: "Welcome Message" },
  { value: "none", label: "Button only" },
];

const chips = (kw: string) =>
  kw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => `<span class="chip">${esc(k === "*" ? "anything" : k)}</span>`)
    .join(" ");

export function triggerLine(t: Pick<Trigger, "source" | "keyword" | "media_id">, label: Map<string, string>): string {
  const anyText = t.keyword.split(",").some((k) => k.trim() === "*") || !t.keyword.trim();
  switch (t.source) {
    case "comment": {
      const where =
        t.media_id === NEXT_POST ? "next Post or Reel" : t.media_id ? `specific Post or Reel <small>(${esc(label.get(t.media_id) ?? t.media_id)})</small>` : "any Post or Reel";
      return `User comments on ${where}${anyText ? "" : ` and comment contains ${chips(t.keyword)}`}`;
    }
    case "dm":
      return `User sends a message${anyText ? "" : ` that contains ${chips(t.keyword)}`}`;
    case "story":
      return `User replies to ${t.media_id ? "a specific Story" : "your Story"}${anyText ? "" : ` with ${chips(t.keyword)}`}`;
    case "mention":
      return "User mentions you in their Story";
    case "welcome":
      return "New conversation: their very first message";
    default:
      return "Only from a button, Conversation Starter or another automation";
  }
}

const pct = (n: number, of: number) => (of ? `${((100 * n) / of).toFixed(1)}%` : "n/a");

function ago(ms: number | null, now: number): string {
  if (!ms) return "";
  const s = Math.max(0, (now - ms) / 1000);
  const unit = ([[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]] as const).find(([n]) => s >= n);
  if (!unit) return "just now";
  const n = Math.floor(s / unit[0]);
  return `${n} ${unit[1]}${n === 1 ? "" : "s"} ago`;
}

export const statusOf = (t: Trigger): "live" | "off" | "draft" => (t.enabled ? "live" : t.published_at ? "off" : "draft");
const badge = (t: Trigger) => `<span class="st-b ${statusOf(t)}">${statusOf(t).toUpperCase()}</span>`;

const DEFAULT_NAME: Partial<Record<Trigger["source"], string>> = { mention: "Story Mention Reply", welcome: "Welcome Message", none: "Button-only automation" };
export const nameOf = (t: Trigger) => t.name || DEFAULT_NAME[t.source] || t.keyword || "Untitled automation";

interface Stats {
  runs: number;
  clicks: number;
}

// Runs = people who entered the automation; CTR = share of them who tapped or clicked anything in it. Comment
// automations count from the comments log too, which predates flow_starts.
async function automationStats(env: Env): Promise<Map<number, Stats>> {
  const { results } = await env.DB.prepare(`SELECT trigger_id, COUNT(*) AS runs FROM flow_starts WHERE status = 'sent' GROUP BY trigger_id`).all<{ trigger_id: number; runs: number }>();
  const { results: clicks } = await env.DB.prepare(
    `SELECT s.trigger_id, COUNT(DISTINCT s.subscriber_id) AS n FROM flow_taps t JOIN flow_sends s ON s.id = t.send_id GROUP BY s.trigger_id`,
  ).all<{ trigger_id: number; n: number }>();
  const { results: comments } = await env.DB.prepare(
    `SELECT trigger_id, COUNT(*) AS runs FROM comments WHERE status = 'sent' AND trigger_id IS NOT NULL GROUP BY trigger_id`,
  ).all<{ trigger_id: number; runs: number }>();
  const out = new Map<number, Stats>(results.map((r) => [r.trigger_id, { runs: r.runs, clicks: 0 }]));
  const get = (id: number) => out.get(id) ?? out.set(id, { runs: 0, clicks: 0 }).get(id)!;
  for (const c of clicks) get(c.trigger_id).clicks = c.n;
  for (const c of comments) get(c.trigger_id).runs = Math.max(get(c.trigger_id).runs, c.runs);
  return out;
}

async function folders(env: Env): Promise<string[]> {
  const saved = JSON.parse((await db.getSetting(env.DB, "automation_folders")) ?? "[]") as string[];
  const { results } = await env.DB.prepare(`SELECT DISTINCT folder FROM triggers WHERE folder IS NOT NULL AND deleted_at IS NULL`).all<{ folder: string }>();
  return [...new Set([...saved, ...results.map((r) => r.folder)])].sort((a, b) => a.localeCompare(b));
}
const setFolders = (env: Env, list: string[]) => db.setSetting(env.DB, "automation_folders", JSON.stringify([...new Set(list)]));

const qs = (base: Record<string, string>, over: Record<string, string | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v) p.set(k, v);
  const s = p.toString();
  return `/admin/automations${s ? `?${s}` : ""}`;
};

// ---------- templates ----------

const msg = (id: string, x: number, y: number, bubbles: { text: string; buttons?: { id: string; title: string; url?: string }[] }[], qrs: string[] = []): Node => ({
  id,
  kind: "message",
  x,
  y,
  data: { bubbles: bubbles.map((b) => ({ text: b.text, buttons: b.buttons ?? [] })), quick_replies: qrs.map((title, i) => ({ id: `${id}q${i}`, title })) },
});
const act = (id: string, x: number, y: number, actions: { type: string; value: string }[]): Node => ({ id, kind: "action", x, y, data: { actions } });
const TRIG: Node = { id: "trigger", kind: "trigger", x: 0, y: 0, data: {} };
const tg = (source: Trigger["source"], keyword: string, nodes: Node[], edges: [string, string, string][], public_reply: string | null = null): Graph => ({
  trigger: { source, keyword, media_id: null, public_reply },
  nodes: [TRIG, ...nodes],
  edges: edges.map(([from, port, to]) => ({ from, port, to })),
});

export const TEMPLATES: Record<string, { name: string; emoji: string; desc: string; graph: () => Graph }> = {
  reel: {
    name: "Reel comment → resource link",
    emoji: "🎬",
    desc: "Someone comments a keyword on a Reel. They get a DM with your link, and a short public reply under the comment.",
    graph: () =>
      tg(
        "comment",
        "LINK",
        [
          msg("m1", 380, 0, [{ text: "Got it. Tap below and I'll send the link.", buttons: [{ id: "send", title: "Send the link" }] }]),
          msg("m2", 760, 0, [{ text: "Here it is.", buttons: [{ id: "open", title: "Open", url: "{{SKOOL_LINK}}" }] }]),
        ],
        [
          ["trigger", "next", "m1"],
          ["m1", "send", "m2"],
        ],
        "Sent you a DM with the link.",
      ),
  },
  comment: {
    name: "Comment keyword → DM link",
    emoji: "💬",
    desc: "Someone comments a keyword, they get a DM with a button that sends the link.",
    graph: () =>
      tg(
        "comment",
        "LINK",
        [
          msg("m1", 380, 0, [{ text: "yoooo! tap below and I'll send it over 👇", buttons: [{ id: "send", title: "Send it" }] }]),
          msg("m2", 760, 0, [{ text: "here you go 🎁", buttons: [{ id: "open", title: "Open", url: "{{SKOOL_LINK}}" }] }]),
        ],
        [["trigger", "next", "m1"], ["m1", "send", "m2"]],
        "sent 📩\ncheck your DMs 👀",
      ),
  },
  followers: {
    name: "Comment keyword → link for followers",
    emoji: "🔒",
    desc: "The link only goes to people who follow you; everyone else is asked to follow first.",
    graph: () =>
      tg(
        "comment",
        "GUIDE",
        [
          msg("m1", 380, 0, [{ text: "hey! tap below for the guide 👇", buttons: [{ id: "send", title: "Send it" }] }]),
          { id: "c1", kind: "condition", x: 760, y: 0, data: { match: "all", rules: [{ field: "follows", op: "is", value: "" }] } },
          msg("m2", 1140, -120, [{ text: "here it is 🎁", buttons: [{ id: "open", title: "Open the guide", url: "{{SKOOL_LINK}}" }] }]),
          msg("m3", 1140, 200, [{ text: "follow me first so you don't miss the next one, then tap below 👇", buttons: [{ id: "done", title: "I followed" }] }]),
        ],
        [["trigger", "next", "m1"], ["m1", "send", "c1"], ["c1", "yes", "m2"], ["c1", "no", "m3"], ["m3", "done", "c1"]],
      ),
  },
  dm: {
    name: "DM keyword → link + follow-up",
    emoji: "✉️",
    desc: "A DM with the keyword gets the link, then a nudge an hour later if they go quiet.",
    graph: () =>
      tg(
        "dm",
        "GUIDE",
        [
          msg("m1", 380, 0, [{ text: "here's the free guide 👇", buttons: [{ id: "open", title: "Get the guide", url: "{{SKOOL_LINK}}" }] }]),
          { id: "d1", kind: "delay", x: 760, y: 0, data: { seconds: 3600 } },
          msg("m2", 1140, 0, [{ text: "did you get a chance to check it out? curious what you think" }]),
        ],
        [["trigger", "next", "m1"], ["m1", "next", "d1"], ["d1", "next", "m2"]],
      ),
  },
  story: {
    name: "Story reply → tag and hand to the AI",
    emoji: "📸",
    desc: "Thank people who reply to your Story, ask what they're after, tag them and let the AI take over.",
    graph: () =>
      tg(
        "story",
        "*",
        [
          msg("m1", 380, 0, [{ text: "appreciate you 🙏 what are you working on right now?" }], ["Growing on YouTube", "AI in my business"]),
          act("a1", 760, -60, [{ type: "add_tag", value: "youtube" }, { type: "handoff", value: "" }]),
          act("a2", 760, 200, [{ type: "add_tag", value: "ai-business" }, { type: "handoff", value: "" }]),
        ],
        [["trigger", "next", "m1"], ["m1", "m1q0", "a1"], ["m1", "m1q1", "a2"]],
      ),
  },
  welcome: {
    name: "Welcome Message",
    emoji: "👋",
    desc: "First DM ever and no keyword matched: say hi, sort them with quick replies, hand off to the AI.",
    graph: () =>
      tg(
        "welcome",
        "*",
        [
          msg("m1", 380, 0, [{ text: "hey! welcome in 👋 what are you building right now?" }], ["A YouTube channel", "An AI business", "Just looking"]),
          act("a1", 760, -120, [{ type: "add_tag", value: "youtube" }, { type: "handoff", value: "" }]),
          act("a2", 760, 120, [{ type: "add_tag", value: "ai-business" }, { type: "handoff", value: "" }]),
          act("a3", 760, 360, [{ type: "handoff", value: "" }]),
        ],
        [["trigger", "next", "m1"], ["m1", "m1q0", "a1"], ["m1", "m1q1", "a2"], ["m1", "m1q2", "a3"]],
      ),
  },
  mention: {
    name: "Story Mention Reply",
    emoji: "🙌",
    desc: "Thank people who mention you in their Story.",
    graph: () => tg("mention", "*", [msg("m1", 380, 0, [{ text: "thanks for the shoutout 🙏 means a lot" }])], [["trigger", "next", "m1"]]),
  },
  blank: {
    name: "Untitled automation",
    emoji: "✨",
    desc: "Start from scratch on an empty canvas.",
    graph: () => tg("dm", "", [msg("m1", 380, 0, [{ text: "" }])], [["trigger", "next", "m1"]]),
  },
};

// A new automation: a DRAFT (off) whose draft is the template. The live graph is just the When... node, so the old
// builder's conversion never touches it.
// The live automation already waiting for the next post, if any other than `id`.
const waitingForNextPost = (env: Env, id: number) =>
  env.DB.prepare(`SELECT * FROM triggers WHERE id != ?1 AND source = 'comment' AND media_id = ?2 AND enabled = 1 AND deleted_at IS NULL LIMIT 1`).bind(id, NEXT_POST).first<Trigger>();

async function create(env: Env, template: string, folder: string | null, now: number): Promise<number> {
  const tpl = TEMPLATES[template] ?? TEMPLATES.blank;
  const g = tpl.graph();
  const row = await env.DB.prepare(
    `INSERT INTO triggers (source, keyword, name, dm, enabled, folder, draft, created_at, updated_at) VALUES (?1, ?2, ?3, '', 0, ?4, ?5, ?6, ?6) RETURNING id`,
  )
    .bind(g.trigger.source, g.trigger.keyword || "*", tpl.name, folder, JSON.stringify(g), now)
    .first<{ id: number }>();
  await env.DB.prepare(`INSERT INTO flow_nodes (trigger_id, id, kind, data, x, y) VALUES (?1, 'trigger', 'trigger', '{}', 0, 0)`).bind(row!.id).run();
  return row!.id;
}

// ---------- the page ----------

// `after` = whatever the page adds under the list (admin.ts's Recent comments), inside the same column.
export async function automationsBody(env: Env, req: Request, who: Role, label: Map<string, string>, now = Date.now(), after = ""): Promise<string> {
  const u = new URL(req.url).searchParams;
  const tab = u.get("tab") === "basic" ? "basic" : u.get("tab") === "trash" ? "trash" : u.get("tab") === "sequences" ? "sequences" : "all";
  const tabs = `<nav class="au-nav" aria-label="Automation">${[
    ["all", "My Automations", "flow"],
    ["basic", "Basic", "shapes"],
    ["sequences", "Sequences", "clock"],
  ]
    .map(([k, l, ic]) => `<a href="/admin/automations${k === "all" ? "" : `?tab=${k}`}"${k === tab || (k === "all" && tab === "trash") ? ' class="on"' : ""}>${icon(ic, 16, 1.8)}${l}</a>`)
    .join("")}</nav>`;
  const body = tab === "basic" ? await basicTab(env, who) : tab === "trash" ? await trashTab(env, who, label, now) : await listTab(env, u, who, label, now, tab === "sequences");
  return `${CSS}<div class="au">${tabs}<div class="au-main">${body}${after}</div></div>${who === "admin" ? newDialog(u.get("folder")) : ""}`;
}

function newDialog(folder: string | null): string {
  const cards = Object.entries(TEMPLATES)
    .filter(([k]) => k !== "mention")
    .map(
      ([k, t]) => `<form method="post" action="/admin/automations/new"><input type="hidden" name="template" value="${k}">${folder ? `<input type="hidden" name="folder" value="${esc(folder)}">` : ""}
<button><span class="em">${t.emoji}</span>${k === "blank" ? "Start from scratch" : esc(t.name)}<small>${esc(t.desc)}</small></button></form>`,
    )
    .join("");
  return `<dialog class="au-new" id="au-new"><div class="hd"><h2>New Automation</h2><form method="dialog"><button aria-label="Close">×</button></form></div><div class="au-tpl">${cards}</div></dialog>`;
}

const menuForm = (id: number, action: string, label: string, extra = "", cls = "") =>
  `<form method="post" action="/admin/automations/${id}/${action}"${extra}><button${cls ? ` class="${cls}"` : ""}>${label}</button></form>`;

async function listTab(env: Env, u: URLSearchParams, who: Role, label: Map<string, string>, now: number, sequences = false): Promise<string> {
  const folder = u.get("folder") || null;
  const q = (u.get("q") ?? "").trim().toLowerCase();
  const source = u.get("trigger") ?? "";
  const state = u.get("state") ?? "";
  const sort = ["name", "runs", "modified"].includes(u.get("sort") ?? "") ? u.get("sort")! : "modified";
  const order = u.get("order") === "asc" ? "asc" : "desc";
  const base: Record<string, string> = { folder: folder ?? "", q, trigger: source, state, sort, order };
  const { results: all } = await env.DB.prepare(`SELECT * FROM triggers WHERE deleted_at IS NULL`).all<Trigger>();
  const stats = await automationStats(env);
  const st = (t: Trigger) => stats.get(t.id) ?? { runs: 0, clicks: 0 };
  // Search covers every folder; otherwise you see the open folder.
  let list = all.filter((t) => (q || sequences ? `${nameOf(t)} ${t.keyword}`.toLowerCase().includes(q) : (t.folder ?? null) === folder));
  if (source) list = list.filter((t) => t.source === source);
  if (sequences) {
    const { results: delays } = await env.DB.prepare(`SELECT DISTINCT trigger_id AS id FROM flow_nodes WHERE kind = 'delay'`).all<{ id: number }>();
    const delayIds = new Set(delays.map((d) => d.id));
    list = list.filter((t) => delayIds.has(t.id) || t.source === "dm" || (t.draft ?? "").includes('"delay"'));
  }
  if (state === "live") list = list.filter((t) => t.enabled);
  if (state === "paused") list = list.filter((t) => statusOf(t) === "off");
  if (state === "draft") list = list.filter((t) => statusOf(t) === "draft" || t.draft);
  if (state === "off") list = list.filter((t) => statusOf(t) === "off");
  const key = (t: Trigger) => (sort === "name" ? nameOf(t).toLowerCase() : sort === "runs" ? st(t).runs : (t.updated_at ?? t.created_at));
  list.sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    const c = x < y ? -1 : x > y ? 1 : b.id - a.id;
    return order === "asc" ? c : -c;
  });
  const all_folders = await folders(env);
  const admin = who === "admin";
  const moveOpts = (cur: string | null) =>
    `<option value="" disabled selected>Move to…</option>${cur ? `<option value="/">Top level</option>` : ""}${all_folders
      .filter((f) => f !== cur)
      .map((f) => `<option value="${esc(f)}">${esc(f)}</option>`)
      .join("")}<option value="+">+ New folder…</option>`;
  const rows = list
    .map((t) => {
      const s = st(t);
      const name = nameOf(t);
      const sw =
        statusOf(t) === "draft"
          ? ""
          : `<form method="post" action="/admin/automations/${t.id}/toggle" class="switch" title="${t.enabled ? "Live: tap to turn off" : "Off: tap to turn on"}"><input type="checkbox"${t.enabled ? " checked" : ""}${admin ? ' onchange="this.form.submit()"' : " disabled"} aria-label="On/off"><span></span></form>`;
      const menu = admin
        ? `<details class="au-m"><summary aria-label="More">⋯</summary><div>
<button type="button" onclick="auRename(${t.id}, this.dataset.n)" data-n="${esc(name)}">Rename</button>
${menuForm(t.id, "duplicate", "Duplicate")}
<form method="post" action="/admin/automations/${t.id}/move"><select name="folder" onchange="auMove(this)">${moveOpts(t.folder)}</select></form>
${menuForm(t.id, "delete", "Delete", ` onsubmit="return confirm('Move to Trash?')"`, "dz")}</div></details>`
        : "<span></span>";
      // Two lines on one grid: the automation, then its trigger with the switch and the trigger's numbers.
      return `<article class="au-row"><span class="cb">${admin ? `<input type="checkbox" name="ids" value="${t.id}" form="bulk" aria-label="Select ${esc(name)}">` : ""}</span>
<div class="nmc"><a class="nm" href="/admin/flows/${t.id}">${badge(t)}<span>${esc(name)}</span></a></div><span class="sp"></span>
<div class="mc-num runs">${s.runs.toLocaleString("en-US")}</div><div class="mc-num ctr">${pct(s.clicks, s.runs)}</div><div class="mod">${ago(t.updated_at ?? t.created_at, now)}</div>${menu}
<span class="sp"></span><div class="trg"><span class="ig"></span>${triggerLine(t, label)}${t.draft && t.published_at ? ` · <i>unpublished changes</i>` : ""}${q && t.folder ? ` · in ${esc(t.folder)}` : ""}</div>
<div class="sw">${sw}</div><div class="sub">${s.runs.toLocaleString("en-US")}</div><div class="sub">${pct(s.clicks, s.runs)}</div><span class="sp"></span><span class="sp"></span></article>`;
    })
    .join("");
  const counts = new Map<string, number>();
  for (const t of all) if (t.folder) counts.set(t.folder, (counts.get(t.folder) ?? 0) + 1);
  const folderTiles =
    folder || q || sequences
      ? ""
      : `<div class="au-fds">${all_folders
          .map(
            (f) => `<div class="au-fd"><a href="${qs({}, { folder: f })}">${icon("folder", 18, 1.8)}<span>${esc(f)}</span> <small>${counts.get(f) ?? 0}</small></a>${
              admin
                ? `<details class="au-m"><summary aria-label="Folder menu">⋯</summary><div>
<button type="button" onclick="auFolder('rename', this.dataset.f)" data-f="${esc(f)}">Rename</button>
<button type="button" class="dz" onclick="auFolder('delete', this.dataset.f)" data-f="${esc(f)}">Delete folder</button></div></details>`
                : ""
            }</div>`,
          )
          .join("")}${admin ? `<button type="button" class="au-fd new" onclick="auFolder('create')">${icon("plus", 18, 1.8)}New Folder</button>` : ""}</div>`;
  const sortLink = (k: string, l: string, cls = "") => {
    const on = sort === k;
    const next = on && order === "desc" ? "asc" : "desc";
    return `<a class="${[cls, on ? "on" : ""].filter(Boolean).join(" ")}" href="${qs(base, { sort: k, order: next })}">${l}${on ? (order === "desc" ? " ↓" : " ↑") : " ↕"}</a>`;
  };
  const title = sequences ? "Sequences" : folder ? `<a href="/admin/automations">My Automations</a> › ${esc(folder)}` : q ? "Search results" : "My Automations";
  return `<div class="au-h"><h2>${title}</h2>${admin ? `<button class="mc-btn" type="button" onclick="document.getElementById('au-new').showModal()">+ New Automation</button>` : ""}</div>
${sequences ? `<p class="note">Follow-ups and multi-step flows: DM keywords, and anything with a delay.</p>` : ""}
<form class="au-f" method="get" action="/admin/automations">${folder ? `<input type="hidden" name="folder" value="${esc(folder)}">` : ""}<input type="hidden" name="sort" value="${sort}"><input type="hidden" name="order" value="${order}">
<div class="srch">${icon("search", 16)}<input type="search" name="q" value="${esc(q)}" placeholder="Search all Automations" aria-label="Search all automations"></div>
<select name="trigger" onchange="this.form.submit()" aria-label="Trigger"><option value="">Any Trigger</option>${SOURCES.map((s) => `<option value="${s.value}"${s.value === source ? " selected" : ""}>${s.label}</option>`).join("")}</select>
<select name="state" onchange="this.form.submit()" aria-label="Trigger state"><option value="">Any Trigger states</option>${[
    ["live", "Live"],
    ["off", "Paused"],
    ["draft", "Draft"],
  ]
    .map(([v, l]) => `<option value="${v}"${v === state ? " selected" : ""}>${l}</option>`)
    .join("")}</select></form>
${folderTiles}
${folder || q || sequences ? "" : `<div class="au-tr"><a href="/admin/automations?tab=trash">${icon("trash", 16, 1.8)}Trash</a></div>`}
${rows ? `<div class="au-cols"><span></span>${sortLink("name", "Name")}<span></span>${sortLink("runs", "Runs", "r")}<span class="r">CTR</span>${sortLink("modified", "Modified")}<span></span></div>${rows}` : `<div class="au-empty">${q || source || state ? "Nothing matches." : sequences ? "No sequences yet. DM keywords and flows with a delay show up here." : folder ? "This folder is empty." : "No automations yet. Comment and DM keywords, story replies and mentions all start here."}</div>`}
${
  admin
    ? `<form id="bulk" method="post" action="/admin/automations/bulk" class="au-bulk"><span>Selected:</span><select name="folder"><option value="">Move to…</option><option value="/">Top level</option>${all_folders.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("")}</select>
<button name="act" value="move" class="ghost">Move</button><button name="act" value="delete" class="ghost" onclick="return confirm('Move the selected automations to Trash?')">Delete</button></form>
<script>
function auPost(action,fields){var f=document.createElement("form");f.method="post";f.action=action;for(var k in fields){var i=document.createElement("input");i.type="hidden";i.name=k;i.value=fields[k];f.appendChild(i)}document.body.appendChild(f);f.submit()}
function auRename(id,cur){var n=prompt("Rename automation",cur);if(n&&n.trim())auPost("/admin/automations/"+id+"/rename",{name:n.trim()})}
function auMove(s){var v=s.value;if(v==="+"){v=prompt("New folder name");if(!v||!v.trim()){s.selectedIndex=0;return}s.options[s.options.length]=new Option(v,v.trim(),true,true)}s.form.submit()}
function auFolder(act,cur){var n=act==="delete"?(confirm("Delete the folder "+cur+"? Its automations move to the top level.")?cur:null):prompt(act==="create"?"Folder name":"Rename folder",cur||"");if(n&&n.trim())auPost("/admin/automations/folders",{act:act,folder:cur||"",name:n.trim()})}
</script>`
    : ""
}`;
}

async function basicTab(env: Env, who: Role): Promise<string> {
  const { results: triggers } = await env.DB.prepare(`SELECT * FROM triggers WHERE deleted_at IS NULL ORDER BY enabled DESC, id`).all<Trigger>();
  const bySource = (s: Trigger["source"]) => triggers.find((t) => t.source === s);
  const setUp = (template: string) =>
    who === "admin" ? `<form method="post" action="/admin/automations/new"><input type="hidden" name="template" value="${template}"><button class="mc-btn">Set Up</button></form>` : "";
  const basic = (title: string, desc: string, t: Trigger | undefined, template: string) =>
    `<div class="row"><div><b>${title}</b><p>${desc}</p></div>${
      t ? `<a href="/admin/flows/${t.id}" class="${t.enabled ? "live-pill" : "off-pill"}">${t.enabled ? "▷ Live" : statusOf(t) === "draft" ? "Draft" : "Off"}</a>` : setUp(template)
    }</div>`;
  const ice = await db.getSetting(env.DB, "ice_breakers");
  const menu = await db.getSetting(env.DB, "main_menu");
  const ai = env.AUTOPILOT === "true";
  return `<div class="au-h"><h2>Basic</h2></div><div class="card basic">
<div class="row"><div><b>Default Reply: the AI setter answers every other DM</b><p>${ai ? "AI replies are on: it answers within seconds." : "AI replies are off: turn them on from the AI page."}</p></div><a href="/admin/ai" class="${ai ? "live-pill" : "mc-btn"}">${ai ? "▷ Live" : "Turn on"}</a></div>
${basic("Welcome Message: first impression for a brand-new conversation", "Sent instantly when someone DMs you for the first time and no keyword matched.", bySource("welcome"), "welcome")}
<div class="row"><div><b>Conversation Starters: questions people can tap before their first DM</b><p>${ice ? esc(ice.split("\n").map((l) => l.split(" > ")[0]).join(" · ")) : "Up to 4 FAQ buttons on the empty chat screen. Not shown on desktop."}</p></div>${
    who === "admin" || ice ? `<a class="${ice ? "live-pill" : "mc-btn"}" href="/admin/flows/icebreakers">${ice ? "▷ Live" : "Set Up"}</a>` : ""
  }</div>
<div class="row"><div><b>Main Menu: the menu button inside every chat</b><p>${menu ? esc(menu.split("\n").map((l) => l.split(/\s*[>|]\s*/)[0]).join(" · ")) : "Links and shortcuts people can open any time."}</p></div>${
    who === "admin" || menu ? `<a class="${menu ? "live-pill" : "mc-btn"}" href="/admin/flows/menu">${menu ? "▷ Live" : "Set Up"}</a>` : ""
  }</div>
${basic("Story Mention Reply: thank people who mention you in their Story", "Say thanks or start a flow when someone tags you.", bySource("mention"), "mention")}
<div class="row"><div><b>Say hi to new followers</b><p>Instagram's API has no follow event, so this can't be built here. If another tool sends your follow DM, it lands in the Inbox and the conversation carries on from there.</p></div><span class="off-pill">Not available</span></div>
</div>`;
}

async function trashTab(env: Env, who: Role, label: Map<string, string>, now: number): Promise<string> {
  const { results } = await env.DB.prepare(`SELECT * FROM triggers WHERE deleted_at IS NOT NULL AND id > 0 ORDER BY deleted_at DESC`).all<Trigger>();
  const rows = results
    .map(
      (t) => `<article class="au-row"><span class="cb"></span><div class="nmc"><span class="nm">${badge(t)}<span>${esc(nameOf(t))}</span></span></div>
<span class="sp"></span><span class="sp"></span><span class="sp"></span><div class="mod">deleted ${ago(t.deleted_at, now)}</div>${
        who === "admin"
          ? `<details class="au-m"><summary aria-label="More">⋯</summary><div>${menuForm(t.id, "restore", "Restore")}${menuForm(t.id, "purge", "Delete forever", ` onsubmit="return confirm('Delete forever? This can't be undone.')"`, "dz")}</div></details>`
          : "<span></span>"
      }<span class="sp"></span><div class="trg"><span class="ig"></span>${triggerLine(t, label)}</div></article>`,
    )
    .join("");
  return `<div class="au-h"><h2><a href="/admin/automations">My Automations</a> › Trash</h2></div>${rows || '<div class="au-empty">Trash is empty.</div>'}`;
}

// ---------- the editor ----------

// Who an automation reached, for the published view's Key metrics and the list behind each tile. `set` narrows it to
// the people a read receipt covered ("opened") or who tapped any button or link ("clicked"). Reviewer: test threads.
type ContactSet = "all" | "opened" | "clicked";
const SET_SQL: Record<ContactSet, string> = {
  all: "1 = 1",
  opened: "s.seen_at IS NOT NULL",
  clicked: "EXISTS (SELECT 1 FROM flow_taps t WHERE t.send_id = s.id)",
};
const asSet = (v: unknown): ContactSet => (v === "opened" || v === "clicked" ? v : "all");
const REACHED = `FROM flow_sends s JOIN leads l ON l.subscriber_id = s.subscriber_id WHERE s.trigger_id = ?1 AND s.status = 'sent' AND (?2 = 'admin' OR l.test = 1)`;

// Sends = how many times it ran; the rest are people. Opened is a floor (read receipts only).
export async function keyMetrics(env: Env, id: number, who: Role): Promise<{ sends: number; contacts: number; opened: number; clicked: number }> {
  const r = await env.DB.prepare(
    `SELECT COUNT(DISTINCT s.subscriber_id) AS contacts, COUNT(DISTINCT CASE WHEN ${SET_SQL.opened} THEN s.subscriber_id END) AS opened,
       COUNT(DISTINCT CASE WHEN ${SET_SQL.clicked} THEN s.subscriber_id END) AS clicked ${REACHED}`,
  )
    .bind(id, who)
    .first<{ contacts: number; opened: number; clicked: number }>();
  const runs = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM flow_starts f JOIN leads l ON l.subscriber_id = f.subscriber_id WHERE f.trigger_id = ?1 AND f.status = 'sent' AND (?2 = 'admin' OR l.test = 1)`,
  )
    .bind(id, who)
    .first<{ n: number }>();
  const contacts = r?.contacts ?? 0;
  return { sends: Math.max(runs?.n ?? 0, contacts), contacts, opened: r?.opened ?? 0, clicked: r?.clicked ?? 0 };
}

// The newest 100 people in a set, with when the automation last messaged them.
async function reachedContacts(env: Env, id: number, who: Role, set: ContactSet): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT l.subscriber_id AS id, l.username, l.first_name AS name, l.profile_pic AS pic, MAX(s.created_at) AS at ${REACHED} AND ${SET_SQL[set]}
     GROUP BY l.subscriber_id ORDER BY at DESC LIMIT 100`,
  )
    .bind(id, who)
    .all<{ id: string; username: string | null; name: string | null; pic: string | null; at: number }>();
  const total = (await env.DB.prepare(`SELECT COUNT(DISTINCT s.subscriber_id) AS n ${REACHED} AND ${SET_SQL[set]}`).bind(id, who).first<{ n: number }>())?.n ?? 0;
  return Response.json({ total, contacts: results });
}

async function editorPage(env: Env, who: Role, t: Trigger & { draft: string | null }): Promise<Response> {
  const token = await db.getSetting(env.DB, "ig_token");
  const media: Media[] = token ? await recentMedia(token).catch(() => []) : [];
  const stories: Story[] = token ? await recentStories(token).catch(() => []) : [];
  const { results: autos } = await env.DB.prepare(`SELECT * FROM triggers WHERE deleted_at IS NULL ORDER BY id`).all<Trigger>();
  const { results: tags } = await env.DB.prepare(`SELECT DISTINCT tag FROM lead_tags ORDER BY tag LIMIT 300`).all<{ tag: string }>();
  const boot = {
    id: t.id,
    name: nameOf(t),
    folder: t.folder,
    status: statusOf(t),
    hasDraft: Boolean(t.draft),
    ro: who !== "admin",
    link: env.SKOOL_LINK.replace(/^https?:\/\/(www\.)?/, ""),
    graph: await editorGraph(env.DB, t),
    // With unpublished changes waiting, the published view shows what's live, not the draft.
    published: t.draft ? await loadGraph(env.DB, t) : null,
    metrics: await keyMetrics(env, t.id, who),
    stats: await graphStats(env.DB, t.id),
    media: media.map((m) => ({ id: m.id, label: `${(m.caption ?? "").replace(/\s+/g, " ").slice(0, 50) || "(no caption)"} · ${m.timestamp?.slice(0, 10) ?? ""}` })),
    stories: stories.map((s) => ({ id: s.id, at: s.timestamp ?? null, video: s.media_type === "VIDEO", img: s.thumbnail_url ?? s.media_url ?? null })),
    automations: autos.map((a) => ({ id: a.id, name: nameOf(a) })),
    tags: tags.map((r) => r.tag),
    stages: STAGES,
  };
  const json = JSON.stringify(boot).replace(/</g, "\\u003c");
  const body = `<style>${EDITOR_CSS}</style><div class="fe" id="fe"></div><script type="application/json" id="fe-data">${json}</script><script src="/admin/flows/editor.js"></script>`;
  return page("Automations", body, who, env);
}

const PROFILE = {
  icebreakers: {
    title: "Conversation Starters",
    key: "ice_breakers",
    help: `Up to 4 questions shown when someone opens a chat with you for the first time (Instagram app only, not desktop).
"Question &gt; automation name" runs that automation when tapped; a question without one goes to the AI setter.`,
    placeholder: "How do I join the community? &gt; join&#10;What do you teach?",
  },
  menu: {
    title: "Main Menu",
    key: "main_menu",
    help: `The menu button in every chat (Instagram app only). One item per line, 5 max: "Title &gt; automation name" runs it,
"Title | https://..." opens a link ({{SKOOL_LINK}} works). Shows up after people refresh their inbox.`,
    placeholder: "Join the community | {{SKOOL_LINK}}&#10;Free AI guide &gt; whop promo",
  },
} as const;

async function profilePage(env: Env, who: Role, kind: keyof typeof PROFILE, error = ""): Promise<Response> {
  const ro = who !== "admin";
  const p = PROFILE[kind];
  const saved = (await db.getSetting(env.DB, p.key)) ?? "";
  const body = `${CSS}
<p class="bk"><a href="/admin/automations?tab=basic">‹ Basic Automations</a></p>
<div class="au-h"><h2>${p.title}</h2></div>
${error ? `<div class="err">${esc(error)}</div>` : ""}
<form method="post" action="/admin/flows/${kind}" class="card">
<p class="note">${p.help}</p>
<textarea name="lines" rows="5" placeholder="${p.placeholder}"${ro ? " disabled" : ""}>${esc(saved)}</textarea>
${ro ? "" : `<button>Save to Instagram</button>`}
</form>`;
  return page("Automations", body, who, env);
}

const getT = (env: Env, id: number) => env.DB.prepare(`SELECT * FROM triggers WHERE id = ?1`).bind(id).first<Trigger>();

export async function flowsPage(env: Env, req: Request, path: string, who: Role): Promise<Response> {
  if (path === "/admin/flows/editor.js") return new Response(EDITOR_JS, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" } });
  if (path === "/admin/flows/icebreakers" || path === "/admin/flows/menu") return profilePage(env, who, path.endsWith("menu") ? "menu" : "icebreakers");
  const list = path.match(/^\/admin\/flows\/(\d+)\/contacts$/);
  if (list) return reachedContacts(env, Number(list[1]), who, asSet(new URL(req.url).searchParams.get("set")));
  const m = path.match(/^\/admin\/flows\/(\d+)$/);
  const t = m ? await getT(env, Number(m[1])) : null;
  if (!t) return path === "/admin/flows/new" ? Response.redirect(new URL("/admin/automations", req.url).toString(), 302) : new Response("not found", { status: 404 });
  return editorPage(env, who, t);
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function flowsAdminPost(env: Env, req: Request, path: string, who: Role, now = Date.now()): Promise<Response> {
  if (who !== "admin") return new Response("not allowed for the reviewer login", { status: 403 });
  const to = (p: string) => Response.redirect(new URL(p, req.url).toString(), 303);
  const back = () => to(req.headers.get("Referer") ?? "/admin/automations");
  const wantsJson = (req.headers.get("Content-Type") ?? "").includes("json") || (req.headers.get("Accept") ?? "").includes("json");

  if (path === "/admin/flows/icebreakers" || path === "/admin/flows/menu") {
    const f = await req.formData();
    const kind = path.endsWith("menu") ? "menu" : "icebreakers";
    const token = await db.getSetting(env.DB, "ig_token");
    if (!token) return profilePage(env, who, kind, "Instagram isn't connected: open /auth/start first.");
    try {
      await (kind === "menu" ? saveMenu : saveIceBreakers)(env, token, str(f, "lines"));
    } catch (e) {
      return profilePage(env, who, kind, `Instagram said no: ${redactSecrets(String(e))}`);
    }
    return to("/admin/automations?tab=basic");
  }

  if (path === "/admin/automations/new") {
    const f = await req.formData();
    const id = await create(env, str(f, "template"), str(f, "folder") || null, now);
    return to(`/admin/flows/${id}`);
  }

  if (path === "/admin/automations/folders") {
    const f = await req.formData();
    const [act, cur, name] = [str(f, "act"), str(f, "folder"), str(f, "name").slice(0, 60)];
    const list = await folders(env);
    if (act === "create" && name) await setFolders(env, [...list, name]);
    if (act === "rename" && cur && name) {
      await env.DB.prepare(`UPDATE triggers SET folder = ?2 WHERE folder = ?1`).bind(cur, name).run();
      await setFolders(env, list.map((x) => (x === cur ? name : x)));
    }
    if (act === "delete" && cur) {
      await env.DB.prepare(`UPDATE triggers SET folder = NULL WHERE folder = ?1`).bind(cur).run();
      await setFolders(env, list.filter((x) => x !== cur));
    }
    return to("/admin/automations");
  }

  if (path === "/admin/automations/bulk") {
    const f = await req.formData();
    const ids = JSON.stringify(f.getAll("ids").map(Number).filter(Boolean));
    if (str(f, "act") === "delete") await env.DB.prepare(`UPDATE triggers SET enabled = 0, deleted_at = ?2 WHERE id IN (SELECT value FROM json_each(?1))`).bind(ids, now).run();
    if (str(f, "act") === "move" && str(f, "folder")) {
      const folder = str(f, "folder") === "/" ? null : str(f, "folder");
      await env.DB.prepare(`UPDATE triggers SET folder = ?2 WHERE id IN (SELECT value FROM json_each(?1))`).bind(ids, folder).run();
    }
    return back();
  }

  const row = path.match(/^\/admin\/(automations|flows)\/(\d+)\/([a-z]+)$/);
  const t = row ? await getT(env, Number(row[2])) : null;
  if (!row || !t) return new Response("not found", { status: 404 });
  const id = t.id;
  const action = row[3];
  const input = wantsJson ? ((await req.json().catch(() => ({}))) as { graph?: unknown; name?: string; set?: string; tag?: string }) : null;
  const form = wantsJson ? null : await req.formData().catch(() => null);

  switch (action) {
    case "draft": {
      const g = sanitize(input?.graph, triggerCfg(t));
      await env.DB.prepare(`UPDATE triggers SET draft = ?2, updated_at = ?3 WHERE id = ?1`).bind(id, JSON.stringify(g), now).run();
      return json({ ok: true });
    }
    case "publish": {
      const g = input?.graph ? sanitize(input.graph, triggerCfg(t)) : await editorGraph(env.DB, t);
      const problems = validate(g);
      const rival = g.trigger.source === "comment" && g.trigger.media_id === NEXT_POST ? await waitingForNextPost(env, id) : null;
      if (rival) problems.push(`When...: "${nameOf(rival)}" is already waiting for the next post. Only one automation can wait for it at a time.`);
      if (problems.length) return json({ ok: false, problems }, 400);
      await publish(env.DB, id, g, now);
      return json({ ok: true, status: "live" });
    }
    case "test": {
      // A 3-digit code: DM it to the account from anywhere and this automation (as it is in the editor) runs on you.
      const g = input?.graph ? sanitize(input.graph, triggerCfg(t)) : await editorGraph(env.DB, t);
      const code = await testCode(env.DB, id, g, now);
      const token = await db.getSetting(env.DB, "ig_token");
      const handle = token ? ((await fetchAccount(token).catch(() => null))?.username ?? null) : null;
      return json({ ok: true, code, handle, comment: g.trigger.source === "comment" });
    }
    case "discard":
      await env.DB.prepare(`UPDATE triggers SET draft = NULL WHERE id = ?1`).bind(id).run();
      return json({ ok: true });
    case "tag": {
      // "Tag these contacts" in the published view's Contacts list: everyone in the set, not only the 100 shown.
      const tag = String(input?.tag ?? "").trim().toLowerCase().slice(0, 40);
      if (!tag) return json({ ok: false }, 400);
      const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO lead_tags (subscriber_id, tag, created_at) SELECT DISTINCT s.subscriber_id, ?3, ?4 ${REACHED} AND ${SET_SQL[asSet(input?.set)]}`,
      )
        .bind(id, who, tag, now)
        .run();
      return json({ ok: true, tag, added: r.meta.changes ?? 0 });
    }
    case "rename": {
      const name = String(input?.name ?? form?.get("name") ?? "").trim().slice(0, 80);
      if (name) await env.DB.prepare(`UPDATE triggers SET name = ?2, updated_at = ?3 WHERE id = ?1`).bind(id, name, now).run();
      return wantsJson ? json({ ok: true }) : back();
    }
    case "toggle": {
      // A draft that was never published has nothing to turn on: Publish does that.
      // A Next Post or Reel trigger switched back on waits for the next post from now, and never while another one waits.
      const blocked = !t.enabled && t.media_id === NEXT_POST && (await waitingForNextPost(env, id));
      if (statusOf(t) !== "draft" && !blocked) {
        await env.DB.prepare(
          `UPDATE triggers SET enabled = 1 - enabled, published_at = CASE WHEN enabled = 0 AND media_id = ?3 THEN ?2 ELSE COALESCE(published_at, created_at) END, updated_at = ?2 WHERE id = ?1`,
        )
          .bind(id, now, NEXT_POST)
          .run();
      }
      const fresh = (await getT(env, id))!;
      return wantsJson ? json({ ok: true, status: statusOf(fresh) }) : row[1] === "flows" ? to(`/admin/flows/${id}`) : back();
    }
    case "duplicate": {
      const g = await editorGraph(env.DB, t);
      const copy = await env.DB.prepare(
        `INSERT INTO triggers (source, keyword, name, dm, media_id, public_reply, enabled, folder, draft, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9, ?9) RETURNING id`,
      )
        .bind(t.source, t.keyword, `${nameOf(t)} (copy)`, t.dm, t.media_id, t.public_reply, t.folder, JSON.stringify(g), now)
        .first<{ id: number }>();
      await env.DB.prepare(`INSERT INTO flow_nodes (trigger_id, id, kind, data, x, y) VALUES (?1, 'trigger', 'trigger', '{}', 0, 0)`).bind(copy!.id).run();
      return back();
    }
    case "move": {
      const folder = String(form?.get("folder") ?? "").trim();
      const dest = !folder || folder === "/" ? null : folder.slice(0, 60);
      if (dest) await setFolders(env, [...(await folders(env)), dest]);
      await env.DB.prepare(`UPDATE triggers SET folder = ?2 WHERE id = ?1`).bind(id, dest).run();
      return back();
    }
    case "delete":
      await env.DB.batch([
        env.DB.prepare(`UPDATE triggers SET enabled = 0, deleted_at = ?2 WHERE id = ?1`).bind(id, now),
        env.DB.prepare(`UPDATE flow_runs SET status = 'cancelled' WHERE trigger_id = ?1 AND status = 'scheduled'`).bind(id),
      ]);
      return to(t.folder ? `/admin/automations?folder=${encodeURIComponent(t.folder)}` : "/admin/automations");
    case "restore":
      await env.DB.prepare(`UPDATE triggers SET deleted_at = NULL WHERE id = ?1`).bind(id).run();
      return to("/admin/automations?tab=trash");
    case "purge":
      if (!t.deleted_at) return new Response("only from Trash", { status: 400 });
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM triggers WHERE id = ?1`).bind(id),
        env.DB.prepare(`DELETE FROM flow_steps WHERE trigger_id = ?1`).bind(id),
        env.DB.prepare(`DELETE FROM flow_nodes WHERE trigger_id = ?1`).bind(id),
        env.DB.prepare(`DELETE FROM flow_edges WHERE trigger_id = ?1`).bind(id),
      ]);
      return to("/admin/automations?tab=trash");
  }
  return new Response("not found", { status: 404 });
}

