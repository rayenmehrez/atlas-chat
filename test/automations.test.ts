import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeD1 } from "./d1shim";

vi.mock("../src/brain", async (orig) => ({ ...(await orig<typeof import("../src/brain")>()), decide: vi.fn() }));

import { lockNextPost, NEXT_POST, type Trigger } from "../src/comments";
import { syncComments } from "../src/comment_sync";
import { editorGraph } from "../src/graph";
import * as db from "../src/db";
import { ORIGIN, runDueFlows } from "../src/flows";
import { graphStats, loadGraph, sanitize, type Graph } from "../src/graph";
import worker from "../src/index";
import { hmacHex } from "../src/meta";
import type { Env } from "../src/setter";

const ME = "17840000000000001";
const LEAD = "990011";
const LINK = "https://www.skool.com/your-community/about";
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function makeEnv(): Env {
  return {
    DB: makeD1(),
    ANTHROPIC_API_KEY: "test",
    MANYCHAT_API_KEY: "",
    INBOUND_SECRET: "s",
    ADMIN_PASSWORD: "pw",
    REVIEW_PASSWORD: "rv",
    AI: {} as Ai,
    SKOOL_LINK: LINK,
    AUTOPILOT: "false",
    REPLY_DELAY_MIN_S: "60",
    REPLY_DELAY_MAX_S: "240",
    TRANSPORT: "meta",
    META_IG_APP_ID: "100000000000001",
    META_APP_SECRET: "appsecret",
    META_VERIFY_TOKEN: "vt",
  };
}
async function connected() {
  const env = makeEnv();
  await db.setSetting(env.DB, "ig_token", "tok");
  return env;
}

let at = Date.now();
const messaging = (ev: Record<string, unknown>, from = LEAD) => ({
  object: "instagram",
  entry: [{ id: ME, time: 1, messaging: [{ sender: { id: from }, recipient: { id: ME }, timestamp: ++at, ...ev }] }],
});
const dm = (mid: string, text: string, from = LEAD) => messaging({ message: { mid, text } }, from);
const tap = (title: string, payload: string, from = LEAD) => messaging({ postback: { mid: `pbm-${at}`, title, payload } }, from);
const comment = (text: string, id = "c1", from = LEAD, media = "reel1") => ({
  object: "instagram",
  entry: [{ id: ME, time: 1, changes: [{ field: "comments", value: { id, text, from: { id: from, username: "lead.handle" }, media: { id: media } } }] }],
});
async function post(env: Env, payload: unknown) {
  const body = JSON.stringify(payload);
  return worker.fetch(new Request("https://x/meta", { method: "POST", body, headers: { "X-Hub-Signature-256": `sha256=${await hmacHex("appsecret", body)}` } }), env, ctx);
}
const auth = (pw: string) => ({ Authorization: `Basic ${btoa(`owner:${pw}`)}` });
const form = (path: string, fields: Record<string, string | string[]> = {}, pw = "pw") => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) body.append(k, x);
  return new Request(`https://x${path}`, { method: "POST", body, headers: { ...auth(pw), Referer: "https://x/admin/automations" } });
};
const api = (env: Env, path: string, body: unknown = {}, pw = "pw") =>
  worker.fetch(new Request(`https://x${path}`, { method: "POST", body: JSON.stringify(body), headers: { ...auth(pw), "Content-Type": "application/json" } }), env, ctx);
const get = (env: Env, path: string, pw = "pw") => worker.fetch(new Request(`https://x${path}`, { headers: auth(pw) }), env, ctx);

let calls: { url: string; method: string; body: any }[] = [];
let followers = new Set<string>();
let posts: { id: string; timestamp: string; media_product_type?: string }[] = []; // /me/media, newest first
let nextMid = 0;
beforeEach(() => {
  calls = [];
  followers = new Set();
  posts = [];
  nextMid = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method: init?.method ?? "GET", body });
      if (url.endsWith("/me/messages")) return Response.json({ recipient_id: body.recipient.id ?? LEAD, message_id: `out-${++nextMid}` });
      const who = url.match(/\/(\d+)\?fields=is_user_follow_business/);
      if (who) return Response.json({ is_user_follow_business: followers.has(who[1]) });
      if (url.includes("fields=name,username")) return Response.json({ username: "lead.handle", name: "Sam Lee" });
      if (url.includes("/me/media")) return Response.json({ data: posts });
      if (url.includes("/me/stories")) return Response.json({ data: [] });
      return Response.json({ success: true });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const sends = () => calls.filter((c) => c.url.endsWith("/me/messages"));
const sent = () => sends().map((c) => c.body.message);
const textOf = (m: any) => m.text ?? m.attachment?.payload?.text;
const getT = (env: Env, id: number) => env.DB.prepare(`SELECT * FROM triggers WHERE id = ?1`).bind(id).first<Trigger>();

async function newAutomation(env: Env, template = "blank"): Promise<number> {
  const res = await worker.fetch(form("/admin/automations/new", { template }), env, ctx);
  expect(res.status).toBe(303);
  return Number(res.headers.get("Location")!.split("/").pop());
}

describe("migrating the linear builder's automations", () => {
  it("turns the trigger columns and flow_steps into the same flow as a graph", async () => {
    const env = await connected();
    const target = await env.DB.prepare(`INSERT INTO triggers (source, keyword, name, dm, created_at) VALUES ('none', '*', 'bonus', 'bonus!', 0) RETURNING id`).first<{ id: number }>();
    const t = await env.DB.prepare(
      `INSERT INTO triggers (source, keyword, name, dm, button_title, button_url, next_title, quick_replies, public_reply, media_id, created_at)
       VALUES ('comment', 'whop', 'whop promo', 'tap below', 'Site', 'https://x.co', 'Send it', 'Yes > bonus' || char(10) || 'Nah', 'sent!', 'reel1', 0) RETURNING id`,
    ).first<{ id: number }>();
    const step = async (pos: number, kind: string, text: string | null, extra = "NULL", delay: number | null = null) =>
      (await env.DB.prepare(`INSERT INTO flow_steps (trigger_id, position, kind, text, next_title, delay_s) VALUES (?1, ?2, ?3, ?4, ${extra}, ?5) RETURNING id`)
        .bind(t!.id, pos, kind, text, delay)
        .first<{ id: number }>())!.id;
    const s1 = await step(0, "message", "here it is");
    const s2 = await step(1, "delay", null, "NULL", 7200);
    const s3 = await step(2, "message", "", "'ignored'"); // an empty card the old runtime skipped
    const s4 = await step(3, "message", "did u check it?");

    const g = await loadGraph(env.DB, (await getT(env, t!.id))!);
    expect(g.trigger).toEqual({ source: "comment", keyword: "whop", media_id: "reel1", public_reply: "sent!" });
    expect(g.nodes.map((n) => [n.id, n.kind, n.data])).toEqual([
      ["trigger", "trigger", {}],
      ["m0", "message", { bubbles: [{ text: "tap below", buttons: [{ id: "url", title: "Site", url: "https://x.co" }, { id: "nx", title: "Send it" }] }], quick_replies: [{ id: "q0", title: "Yes" }, { id: "q1", title: "Nah" }] }],
      ["m0q0", "action", { actions: [{ type: "start_automation", value: String(target!.id) }] }],
      [`s${s1}`, "message", { bubbles: [{ text: "here it is", buttons: [] }], quick_replies: [] }],
      [`s${s2}`, "delay", { seconds: 7200 }],
      [`s${s3}`, "message", { bubbles: [{ text: "", buttons: [] }], quick_replies: [] }],
      [`s${s4}`, "message", { bubbles: [{ text: "did u check it?", buttons: [] }], quick_replies: [] }],
    ]);
    expect(g.edges.map((e) => `${e.from}.${e.port}>${e.to}`).sort()).toEqual(
      [`trigger.next>m0`, `m0.q0>m0q0`, `m0.nx>s${s1}`, `s${s1}.next>s${s2}`, `s${s2}.next>s${s3}`, `s${s3}.next>s${s4}`].sort(),
    );
    // Loading again (or a second webhook racing) doesn't build it twice.
    await loadGraph(env.DB, (await getT(env, t!.id))!);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM flow_nodes WHERE trigger_id = ?1`).bind(t!.id).first<{ n: number }>())?.n).toBe(7);
  });

  it("the migration SQL points old sends, taps and waiting delays at the new nodes, and the flow carries on", async () => {
    const env = await connected();
    const t = await env.DB.prepare(`INSERT INTO triggers (source, keyword, dm, next_title, created_at) VALUES ('dm', 'whop', 'tap', 'Go', 0) RETURNING id`).first<{ id: number }>();
    const delay = await env.DB.prepare(`INSERT INTO flow_steps (trigger_id, position, kind, delay_s) VALUES (?1, 0, 'delay', 60) RETURNING id`).bind(t!.id).first<{ id: number }>();
    await env.DB.prepare(`INSERT INTO flow_steps (trigger_id, position, kind, text) VALUES (?1, 1, 'message', 'still there?')`).bind(t!.id).run();
    // What the live DB holds from before: a first message that was tapped, and a delay waiting on the cron.
    await db.recordInbound(env.DB, { subscriber_id: LEAD, username: "lead", first_name: null, text: "whop", mid: "m1" }, Date.now());
    await env.DB.prepare(`INSERT INTO flow_sends (trigger_id, step_id, subscriber_id, status, mid, tapped_at, created_at) VALUES (?1, NULL, ?2, 'sent', 'o1', 5, 1)`).bind(t!.id, LEAD).run();
    const last = await env.DB.prepare(`SELECT MAX(id) AS id FROM messages`).first<{ id: number }>();
    await env.DB.prepare(`INSERT INTO flow_runs (trigger_id, subscriber_id, after_position, after_msg_id, run_at, created_at) VALUES (?1, ?2, 0, ?3, 0, 0)`)
      .bind(t!.id, LEAD, last!.id)
      .run();
    // Run the data part of migrations/automations.sql (the ALTERs already ran when the test DB was made).
    const sql = readFileSync(fileURLToPath(new URL("../migrations/automations.sql", import.meta.url).href), "utf8").replace(/--.*$/gm, "");
    for (const stmt of sql.split(";").map((s) => s.trim()).filter((s) => s && !s.startsWith("ALTER"))) await env.DB.prepare(stmt).run();

    expect(await env.DB.prepare(`SELECT trigger_id, subscriber_id, status FROM flow_starts`).all().then((r) => r.results)).toEqual([{ trigger_id: t!.id, subscriber_id: LEAD, status: "sent" }]);
    expect((await env.DB.prepare(`SELECT node_id FROM flow_sends`).first<{ node_id: string }>())?.node_id).toBe("m0");
    expect((await env.DB.prepare(`SELECT port FROM flow_taps`).first<{ port: string }>())?.port).toBe("nx");
    expect((await env.DB.prepare(`SELECT node_id FROM flow_runs`).first<{ node_id: string }>())?.node_id).toBe(`s${delay!.id}`);
    // Same person, same keyword: still one run each.
    await post(env, dm("m2", "whop"));
    expect(sends()).toHaveLength(0);
    // The waiting delay continues into the graph. (m2 was a lead message after it, so move the marker past it.)
    await env.DB.prepare(`UPDATE flow_runs SET after_msg_id = 1e9`).run();
    await runDueFlows(env, Date.now());
    expect(sent()).toEqual([{ text: "still there?" }]);
    const stats = await graphStats(env.DB, t!.id);
    expect(stats.trigger.sent).toBe(1);
    expect(stats.m0).toMatchObject({ sent: 1, clicked: 1, ports: { nx: 1 } });
  });
});

const BRANCHY: Graph = {
  trigger: { source: "dm", keyword: "start", media_id: null, public_reply: null },
  nodes: [
    { id: "trigger", kind: "trigger", x: 0, y: 0, data: {} },
    {
      id: "m1",
      kind: "message",
      x: 380,
      y: 0,
      data: { bubbles: [{ text: "pick one", buttons: [{ id: "yt", title: "YouTube" }, { id: "site", title: "Site", url: "{{SKOOL_LINK}}" }] }], quick_replies: [{ id: "ai", title: "AI stuff" }] },
    },
    { id: "a1", kind: "action", x: 760, y: 0, data: { actions: [{ type: "add_tag", value: "yt" }, { type: "set_stage", value: "qualify" }] } },
    { id: "c1", kind: "condition", x: 1140, y: 0, data: { match: "all", rules: [{ field: "tag", op: "is", value: "YT" }] } },
    { id: "m2", kind: "message", x: 1520, y: -100, data: { bubbles: [{ text: "yt path", buttons: [] }, { text: "second bubble", buttons: [] }], quick_replies: [] } },
    { id: "m3", kind: "message", x: 1520, y: 200, data: { bubbles: [{ text: "no tag", buttons: [] }], quick_replies: [] } },
    { id: "r1", kind: "randomizer", x: 760, y: 300, data: { variants: [{ id: "A", label: "A", weight: 100 }, { id: "B", label: "B", weight: 0 }] } },
    { id: "a2", kind: "action", x: 1140, y: 300, data: { actions: [{ type: "add_tag", value: "ai" }, { type: "handoff", value: "" }] } },
    { id: "m4", kind: "message", x: 1520, y: 400, data: { bubbles: [{ text: "never sent: handoff ended the flow", buttons: [] }], quick_replies: [] } },
  ],
  edges: [
    { from: "trigger", port: "next", to: "m1" },
    { from: "m1", port: "yt", to: "a1" },
    { from: "a1", port: "next", to: "c1" },
    { from: "c1", port: "yes", to: "m2" },
    { from: "c1", port: "no", to: "m3" },
    { from: "m1", port: "ai", to: "r1" },
    { from: "r1", port: "A", to: "a2" },
    { from: "a2", port: "next", to: "m4" }, // kept, but the handoff ends the flow before it
    { from: "m1", port: "site", to: "m3" }, // dropped: link buttons have no port
    { from: "m1", port: "next", to: "trigger" }, // dropped: nothing connects into When...
  ],
};

describe("the canvas: draft, publish, branching runs", () => {
  it("builds a branching flow, publishes it, and taps follow their own edges", async () => {
    const env = await connected();
    const id = await newAutomation(env);
    expect((await getT(env, id))?.enabled).toBe(0);
    const page = await (await get(env, `/admin/flows/${id}`)).text();
    expect(page).toContain('id="fe-data"');
    expect(page).toContain('src="/admin/flows/editor.js"');
    const js = await get(env, "/admin/flows/editor.js");
    expect(js.headers.get("Content-Type")).toContain("javascript");

    expect((await api(env, `/admin/flows/${id}/draft`, { graph: BRANCHY })).status).toBe(200);
    const draft = JSON.parse((await getT(env, id))!.draft!) as Graph;
    expect(draft.edges.map((e) => `${e.from}.${e.port}`)).not.toContain("m1.site");
    expect(draft.edges.map((e) => `${e.from}.${e.port}`)).not.toContain("m1.next");

    // A draft never runs.
    await post(env, dm("m1", "start"));
    expect(sends()).toHaveLength(0);

    const pub = await api(env, `/admin/flows/${id}/publish`, { graph: BRANCHY });
    expect(await pub.json()).toEqual({ ok: true, status: "live" });
    const t = (await getT(env, id))!;
    expect([t.enabled, t.draft, t.source, t.keyword, t.dm]).toEqual([1, null, "dm", "start", "pick one"]);

    await post(env, dm("m2", "lets START"));
    expect(sent()).toEqual([
      {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "pick one",
            buttons: [
              { type: "postback", title: "YouTube", payload: "b:1:yt" },
              { type: "web_url", url: `${ORIGIN}/f/1/site`, title: "Site" },
              { type: "postback", title: "AI stuff", payload: "q:1:ai" },
            ],
          },
        },
      },
    ]);

    // YouTube: tag + stage, then the condition sees the tag (any case) and takes Yes: two bubbles.
    await post(env, tap("YouTube", "b:1:yt"));
    expect(sent().slice(1).map(textOf)).toEqual(["yt path", "second bubble"]);
    const lead = await db.getLead(env.DB, LEAD);
    expect(lead?.stage).toBe("qualify");
    expect((await env.DB.prepare(`SELECT tag FROM lead_tags`).all()).results).toEqual([{ tag: "yt" }]);
    await post(env, tap("YouTube", "b:1:yt")); // a button works once
    expect(sends()).toHaveLength(3);

    // The quick reply (riding as a button) goes through the randomizer to the handoff, which ends the flow.
    await db.setLeadStatus(env.DB, LEAD, "paused");
    await post(env, tap("AI stuff", "q:1:ai"));
    expect(sends()).toHaveLength(3);
    expect((await db.getLead(env.DB, LEAD))?.status).toBe("active");
    expect((await env.DB.prepare(`SELECT tag FROM lead_tags ORDER BY tag`).all()).results).toEqual([{ tag: "ai" }, { tag: "yt" }]);

    const click = await worker.fetch(new Request(`${ORIGIN}/f/1/site`), env, ctx);
    expect(click.headers.get("Location")).toBe(LINK);

    const stats = await graphStats(env.DB, id);
    expect(stats.trigger.sent).toBe(1);
    expect(stats.m1).toMatchObject({ sent: 1, clicked: 1, ports: { yt: 1, ai: 1, site: 1 } });
    expect(stats.c1.ports).toEqual({ yes: 1 });
    expect(stats.r1.ports).toEqual({ A: 1 });
    expect(stats.m2.sent).toBe(1);

    // Editing after publish is a draft: live leads keep getting the published version until Publish.
    const edited = structuredClone(BRANCHY);
    edited.nodes.find((n) => n.id === "m2")!.data.bubbles = [{ text: "edited path", buttons: [] }];
    await api(env, `/admin/flows/${id}/draft`, { graph: edited });
    const list = await (await get(env, "/admin/automations")).text();
    expect(list).toContain("unpublished changes");
    const lastSend = async (lead: string) => (await env.DB.prepare(`SELECT MAX(id) AS id FROM flow_sends WHERE subscriber_id = ?1`).bind(lead).first<{ id: number }>())!.id;
    await post(env, dm("n1", "start", "222"));
    await post(env, tap("YouTube", `b:${await lastSend("222")}:yt`, "222"));
    expect(textOf(sent().at(-2))).toBe("yt path");
    await api(env, `/admin/flows/${id}/publish`, { graph: edited });
    await post(env, dm("p1", "start", "333"));
    await post(env, tap("YouTube", `b:${await lastSend("333")}:yt`, "333"));
    expect(textOf(sent().at(-1))).toBe("edited path");
  });

  it("refuses to publish a broken flow and says why; the draft still saves", async () => {
    const env = await connected();
    const id = await newAutomation(env);
    const bad = structuredClone(BRANCHY);
    bad.trigger.keyword = "";
    bad.nodes.find((n) => n.id === "m3")!.data.bubbles = [{ text: " ", buttons: [{ id: "x", title: "" }] }];
    expect((await api(env, `/admin/flows/${id}/draft`, { graph: bad })).status).toBe(200);
    const res = await api(env, `/admin/flows/${id}/publish`, { graph: bad });
    expect(res.status).toBe(400);
    const { problems } = (await res.json()) as { problems: string[] };
    expect(problems).toEqual(["When...: add at least one keyword (or * for anything).", "Send Message #3: add some text.", "Send Message #3: every button needs a title."]);
    expect((await getT(env, id))?.enabled).toBe(0);
  });

  it("'follows you' asks Instagram, and the reviewer can look but not change anything", async () => {
    const env = await connected();
    const id = await newAutomation(env);
    const g: Graph = {
      trigger: { source: "dm", keyword: "guide", media_id: null, public_reply: null },
      nodes: [
        { id: "trigger", kind: "trigger", x: 0, y: 0, data: {} },
        { id: "c", kind: "condition", x: 380, y: 0, data: { match: "all", rules: [{ field: "follows", op: "is", value: "" }] } },
        { id: "yes", kind: "message", x: 760, y: 0, data: { bubbles: [{ text: "here: {{SKOOL_LINK}}", buttons: [] }], quick_replies: [] } },
        { id: "no", kind: "message", x: 760, y: 200, data: { bubbles: [{ text: "follow first!", buttons: [] }], quick_replies: [] } },
      ],
      edges: [
        { from: "trigger", port: "next", to: "c" },
        { from: "c", port: "yes", to: "yes" },
        { from: "c", port: "no", to: "no" },
      ],
    };
    expect((await api(env, `/admin/flows/${id}/publish`, { graph: g }, "rv")).status).toBe(403);
    expect((await worker.fetch(form("/admin/automations/new", {}, "rv"), env, ctx)).status).toBe(403);
    expect((await get(env, `/admin/flows/${id}`, "rv")).status).toBe(200);
    await api(env, `/admin/flows/${id}/publish`, { graph: g });
    followers.add("111");
    await post(env, dm("a", "guide pls", "111"));
    await post(env, dm("b", "guide pls", "222"));
    expect(sent().map(textOf)).toEqual([`here: ${LINK}`, "follow first!"]);
  });

  it("a comment flow runs actions, sends the first text as the private reply, then waits for a tap", async () => {
    const env = await connected();
    const id = await newAutomation(env, "comment");
    const g = JSON.parse((await getT(env, id))!.draft!) as Graph;
    g.nodes.push({ id: "tag", kind: "action", x: 200, y: 200, data: { actions: [{ type: "add_tag", value: "commenter" }] } });
    g.edges = g.edges.map((e) => (e.from === "trigger" ? { ...e, to: "tag" } : e)).concat([{ from: "tag", port: "next", to: "m1" }]);
    g.nodes.find((n) => n.id === "m1")!.data.bubbles.push({ text: "second text can't go as a private reply", buttons: [] });
    g.edges.push({ from: "m1", port: "next", to: "m2" });
    await api(env, `/admin/flows/${id}/publish`, { graph: g });
    await post(env, comment("send the LINK"));
    expect(sends()).toHaveLength(1);
    expect(sends()[0].body.recipient).toEqual({ comment_id: "c1" });
    expect(textOf(sent()[0])).toBe("yoooo! tap below and I'll send it over 👇");
    expect((await env.DB.prepare(`SELECT tag FROM lead_tags`).first<{ tag: string }>())?.tag).toBe("commenter");
    const reply = calls.find((c) => c.url.includes("/c1/replies"));
    expect(reply).toBeTruthy();
    await post(env, tap("Send it", "b:1:send"));
    expect(sent()[1].attachment.payload).toMatchObject({ text: "here you go 🎁", buttons: [{ type: "web_url", url: `${ORIGIN}/f/2/open`, title: "Open" }] });
    // Comment again: one DM per person per automation.
    await post(env, comment("LINK again", "c2"));
    expect(sends()).toHaveLength(2);
  });
});

describe("the Automations page", () => {
  it("folders, search, sort, rename, duplicate, move, on/off, trash and bulk", async () => {
    const env = await connected();
    const a = await newAutomation(env, "dm");
    const b = await newAutomation(env, "story");
    await api(env, `/admin/flows/${a}/publish`, {});
    await worker.fetch(form(`/admin/automations/${a}/rename`, { name: "Zeta guide" }), env, ctx);
    await worker.fetch(form(`/admin/automations/${b}/rename`, { name: "Alpha story" }), env, ctx);

    let html = await (await get(env, "/admin/automations?sort=name&order=asc")).text();
    expect(html.indexOf("Alpha story")).toBeLessThan(html.indexOf("Zeta guide"));
    expect(html).toMatch(/st-b live">LIVE<\/span><span>Zeta guide/);
    expect(html).toMatch(/st-b draft">DRAFT<\/span><span>Alpha story/);
    expect(html).toContain('<span class="chip">GUIDE</span>');

    await worker.fetch(form("/admin/automations/folders", { act: "create", name: "Stories" }), env, ctx);
    await worker.fetch(form(`/admin/automations/${b}/move`, { folder: "Stories" }), env, ctx);
    html = await (await get(env, "/admin/automations")).text();
    expect(html).toMatch(/<a href="[^"]*folder=Stories"><svg[^>]*>.*?<\/svg><span>Stories<\/span> <small>1<\/small>/);
    expect(html).toContain('<a href="/admin/automations?tab=trash">'); // Trash is a link under the folders
    expect(html).toContain("<h2>My Automations</h2>");
    expect(html).not.toContain("Alpha story");
    expect(await (await get(env, "/admin/automations?folder=Stories")).text()).toContain("Alpha story");
    expect(await (await get(env, "/admin/automations?q=alpha")).text()).toContain("Alpha story"); // search covers every folder
    expect(await (await get(env, "/admin/automations?trigger=story")).text()).not.toContain("Zeta guide");

    await worker.fetch(form(`/admin/automations/${a}/duplicate`), env, ctx);
    const copy = await env.DB.prepare(`SELECT * FROM triggers WHERE name = 'Zeta guide (copy)'`).first<Trigger>();
    expect([copy?.enabled, copy?.published_at]).toEqual([0, null]);
    expect((JSON.parse(copy!.draft!) as Graph).nodes.map((n) => n.id)).toEqual(["trigger", "m1", "d1", "m2"]);

    await worker.fetch(form(`/admin/automations/${a}/toggle`), env, ctx);
    expect((await getT(env, a))?.enabled).toBe(0);
    expect(await (await get(env, "/admin/automations")).text()).toMatch(/st-b off">OFF<\/span><span>Zeta guide/);
    await post(env, dm("m1", "guide"));
    expect(sends()).toHaveLength(0);
    await worker.fetch(form(`/admin/automations/${a}/toggle`), env, ctx);

    await worker.fetch(form("/admin/automations/bulk", { act: "move", folder: "Stories", ids: [String(a), String(copy!.id)] }), env, ctx);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM triggers WHERE folder = 'Stories'`).first<{ n: number }>())?.n).toBe(3);
    await worker.fetch(form("/admin/automations/folders", { act: "rename", folder: "Stories", name: "IG" }), env, ctx);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM triggers WHERE folder = 'IG'`).first<{ n: number }>())?.n).toBe(3);

    await worker.fetch(form(`/admin/automations/${a}/delete`), env, ctx);
    expect((await getT(env, a))?.enabled).toBe(0);
    await post(env, dm("m2", "guide"));
    expect(sends()).toHaveLength(0);
    expect(await (await get(env, "/admin/automations?tab=trash")).text()).toContain("Zeta guide");
    await worker.fetch(form(`/admin/automations/${a}/restore`), env, ctx);
    expect((await getT(env, a))?.deleted_at).toBeNull();
    await worker.fetch(form("/admin/automations/bulk", { act: "delete", ids: [String(copy!.id)] }), env, ctx);
    await worker.fetch(form(`/admin/automations/${copy!.id}/purge`), env, ctx);
    expect(await getT(env, copy!.id)).toBeNull();
    expect((await worker.fetch(form(`/admin/automations/${a}/purge`), env, ctx)).status).toBe(400); // only from Trash

    const basic = await (await get(env, "/admin/automations?tab=basic")).text();
    expect(basic).toContain("Default Reply");
    expect(basic).toContain('name="template" value="welcome"');
    expect((await worker.fetch(form(`/admin/automations/${a}/delete`, {}, "rv"), env, ctx)).status).toBe(403);
  });
});

describe("stats", () => {
  it("read receipts mark what the lead has seen: Opened on the card", async () => {
    const env = await connected();
    const id = await newAutomation(env, "dm");
    await api(env, `/admin/flows/${id}/publish`, {});
    await post(env, dm("m1", "guide", "111"));
    await post(env, dm("m2", "guide", "222"));
    const mid = (await env.DB.prepare(`SELECT mid FROM flow_sends WHERE subscriber_id = '111'`).first<{ mid: string }>())!.mid;
    const read = (from: string, m: string, to = ME) => ({ object: "instagram", entry: [{ id: ME, time: 1, messaging: [{ sender: { id: from }, recipient: { id: to }, timestamp: ++at, read: { mid: m } }] }] });
    await post(env, read(ME, mid, "111")); // The owner reading the thread themselves: not the lead
    expect((await graphStats(env.DB, id)).m1.opened).toBe(0);
    await post(env, read("111", mid));
    await post(env, read("111", mid)); // retry
    const stats = await graphStats(env.DB, id);
    expect(stats.m1).toMatchObject({ sent: 2, opened: 1 });
    expect((await env.DB.prepare(`SELECT subscriber_id FROM flow_sends WHERE seen_at IS NOT NULL`).all()).results).toEqual([{ subscriber_id: "111" }]);
    // Reconnecting subscribes the account to read receipts too.
    const { subscribe } = await import("../src/meta");
    await subscribe("tok");
    expect(calls.at(-1)!.url).toContain("messaging_seen");
  });

  it("comment DMs from before flow tracking count on the canvas, once", async () => {
    const env = await connected();
    const t = await env.DB.prepare(`INSERT INTO triggers (source, keyword, name, dm, created_at) VALUES ('comment', 'settertest', 'SETTERTEST', 'test dm', 0) RETURNING id`).first<{ id: number }>();
    await env.DB.prepare(`INSERT INTO comments (comment_id, subscriber_id, text, trigger_id, status, created_at) VALUES ('old1', '111', 'SETTERTEST', ?1, 'sent', 5)`).bind(t!.id).run();
    await env.DB.prepare(`INSERT INTO comments (comment_id, subscriber_id, text, trigger_id, status, created_at) VALUES ('old2', '222', 'SETTERTEST', ?1, 'failed', 6)`).bind(t!.id).run();
    const sql = readFileSync(fileURLToPath(new URL("../migrations/automations_2.sql", import.meta.url).href), "utf8").replace(/--.*$/gm, "");
    const backfill = async () => {
      for (const stmt of sql.split(";").map((x) => x.trim()).filter((x) => x && !x.startsWith("ALTER"))) await env.DB.prepare(stmt).run();
    };
    await backfill();
    await backfill();
    const stats = await graphStats(env.DB, t!.id);
    expect(stats.trigger.sent).toBe(1);
    expect(stats.m0.sent).toBe(1);
    // It ran for 111 already, so a new comment doesn't DM them twice.
    await post(env, comment("SETTERTEST again", "new1", "111"));
    expect(sends()).toHaveLength(0);
  });

  it("Test: a 3-digit code DMed from any account runs the editor's version on them, again and again, outside the stats", async () => {
    const env = await connected();
    const id = await newAutomation(env, "comment");
    await api(env, `/admin/flows/${id}/publish`, { graph: JSON.parse((await getT(env, id))!.draft!) });
    // An unpublished edit: the test runs it.
    const g = (await getT(env, id))!.draft ? JSON.parse((await getT(env, id))!.draft!) : await editorGraph(env.DB, (await getT(env, id))!);
    g.nodes.find((n: any) => n.id === "m1").data.bubbles[0].text = "edited, not published yet";
    const res = await api(env, `/admin/flows/${id}/test`, { graph: g });
    const { code, comment: isComment } = (await res.json()) as { code: string; comment: boolean };
    expect(code).toMatch(/^\d{3}$/);
    expect(isComment).toBe(true);

    await post(env, dm("t1", code));
    expect(sends()).toHaveLength(1);
    expect(sends()[0].body.recipient).toEqual({ id: LEAD }); // a plain DM, not a private reply
    expect(textOf(sent()[0])).toBe("edited, not published yet");
    await post(env, dm("t2", code)); // again: a fresh run
    expect(sends()).toHaveLength(2);
    // Taps in a test run work like the real thing.
    const testSend = await env.DB.prepare(`SELECT id FROM flow_sends WHERE trigger_id = ?1 ORDER BY id DESC`).bind(-id).first<{ id: number }>();
    await post(env, tap("Send it", `b:${testSend!.id}:send`));
    expect(textOf(sent()[2])).toBe("here you go 🎁");
    // None of it counts for the real automation, and it isn't listed anywhere.
    expect((await env.DB.prepare(`SELECT COUNT(*) n FROM flow_sends WHERE trigger_id = ?1`).bind(id).first<{ n: number }>())!.n).toBe(0);
    expect(await (await get(env, "/admin/automations")).text()).not.toContain(`test of #${id}`);
    expect(await (await get(env, "/admin/automations?tab=trash")).text()).not.toContain(`test of #${id}`);
    // A random 3-digit DM is just a message.
    await post(env, dm("t3", "999"));
    expect(sends()).toHaveLength(3);
  });
});


describe("Next Post or Reel", () => {
  // Instagram's own timestamp format, minutes from now.
  const ig = (min: number) => new Date(Date.now() + min * 60_000).toISOString().replace(/\.\d+Z$/, "+0000");
  async function armed(env: Env): Promise<number> {
    const id = await newAutomation(env, "comment");
    const g = JSON.parse((await getT(env, id))!.draft!) as Graph;
    g.trigger.media_id = NEXT_POST;
    expect((await api(env, `/admin/flows/${id}/publish`, { graph: g })).status).toBe(200);
    return id;
  }

  it("waits for the next post, locks onto it at its first comment, then DMs like any post trigger", async () => {
    const env = await connected();
    const id = await armed(env);
    expect((await getT(env, id))!.media_id).toBe(NEXT_POST);
    expect(await (await get(env, "/admin/automations")).text()).toContain("User comments on next Post or Reel");

    posts = [{ id: "old1", timestamp: ig(-60) }];
    await post(env, comment("send the LINK", "c1", LEAD, "old1"));
    expect(sends()).toHaveLength(0); // posted before it was armed

    // The new reel's first comment beats the cron: it still gets the DM.
    posts = [{ id: "reel2", timestamp: ig(1) }, { id: "old1", timestamp: ig(-60) }];
    await post(env, comment("LINK pls", "c2", "lead2", "reel2"));
    expect(sends()).toHaveLength(1);
    expect(sends()[0].body.recipient).toEqual({ comment_id: "c2" });
    const t = (await getT(env, id))!;
    expect(t.media_id).toBe("reel2");
    expect(t.draft === null || (JSON.parse(t.draft) as Graph).trigger.media_id === "reel2").toBe(true);
    expect(await (await get(env, "/admin/automations")).text()).toContain("User comments on specific Post or Reel");
    // Locked: a newer post doesn't move it.
    posts = [{ id: "reel3", timestamp: ig(5) }, ...posts];
    await lockNextPost(env.DB, "tok", Date.now());
    expect((await getT(env, id))!.media_id).toBe("reel2");
  });

  it("the cron locks it before anyone comments: the first post after arming, never an ad", async () => {
    const env = await connected();
    const id = await armed(env);
    await lockNextPost(env.DB, "tok", Date.now());
    expect((await getT(env, id))!.media_id).toBe(NEXT_POST); // nothing new yet
    posts = [
      { id: "p3", timestamp: ig(3) },
      { id: "ad1", timestamp: ig(2), media_product_type: "AD" },
      { id: "p2", timestamp: ig(1) },
      { id: "old", timestamp: ig(-60) },
    ];
    const jobs: Promise<unknown>[] = [];
    await worker.scheduled({} as ScheduledController, env, { waitUntil: (p: Promise<unknown>) => void jobs.push(p), passThroughOnException: () => {} } as unknown as ExecutionContext);
    await Promise.all(jobs);
    expect((await getT(env, id))!.media_id).toBe("p2");
  });

  it("only one automation can wait for the next post", async () => {
    const env = await connected();
    const a = await armed(env);
    const b = await newAutomation(env, "comment");
    const g = JSON.parse((await getT(env, b))!.draft!) as Graph;
    g.trigger.media_id = NEXT_POST;
    const res = await api(env, `/admin/flows/${b}/publish`, { graph: g });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("already waiting for the next post");
    await api(env, `/admin/flows/${a}/toggle`); // A off
    expect((await api(env, `/admin/flows/${b}/publish`, { graph: g })).status).toBe(200);
    await api(env, `/admin/flows/${a}/toggle`); // A can't come back on while B waits
    expect((await getT(env, a))!.enabled).toBe(0);
  });

  it("the comment backfill never asks Instagram for a post called 'next'", async () => {
    const env = await connected();
    await armed(env);
    await db.setSetting(env.DB, "comments_watermark", String(Date.now() - 60_000));
    await syncComments(env, Date.now());
    expect(calls.some((c) => c.url.includes(`/${NEXT_POST}/`))).toBe(false);
  });

  it("only comment and story triggers keep a post or story, and a story can't wait for the next post", () => {
    const kept = (source: string, media_id: string) =>
      sanitize({ trigger: { source, keyword: "x", media_id }, nodes: [], edges: [] }, { source: "dm", keyword: "", media_id: null, public_reply: null }).trigger.media_id;
    expect([kept("comment", NEXT_POST), kept("story", "s1"), kept("story", NEXT_POST), kept("dm", "s1")]).toEqual([NEXT_POST, "s1", null, null]);
  });
});

describe("the published view: key metrics and the people behind them", () => {
  // Three people got automation 9's DM; two opened it, one of those tapped. One is a SETTERTEST thread.
  async function seeded() {
    const env = await connected();
    const D = env.DB;
    await D.prepare(`INSERT INTO triggers (id, source, keyword, name, dm, enabled, created_at, published_at) VALUES (9, 'comment', 'GUIDE', 'Free guide', 'here', 1, 1, 1)`).run();
    for (const [i, id, name] of [[1, "501", "Ana"], [2, "502", "Ben"], [3, "503", "Cy"]] as const) {
      await D.prepare(`INSERT INTO leads (subscriber_id, username, first_name, created_at, test) VALUES (?1, ?2, ?3, 1, ?4)`).bind(id, name.toLowerCase(), name, id === "503" ? 1 : 0).run();
      await D.prepare(`INSERT INTO flow_starts (trigger_id, subscriber_id, status, created_at) VALUES (9, ?1, 'sent', ?2)`).bind(id, 1000 * i).run();
      await D.prepare(`INSERT INTO flow_sends (id, trigger_id, subscriber_id, status, node_id, seen_at, created_at) VALUES (?1, 9, ?2, 'sent', 'm0', ?3, ?4)`)
        .bind(i, id, i < 3 ? 5000 : null, 1000 * i)
        .run();
    }
    await D.prepare(`INSERT INTO flow_sends (id, trigger_id, subscriber_id, status, node_id, created_at) VALUES (4, 9, '501', 'sent', 'm1', 4000)`).run(); // a second message, same person
    await D.prepare(`INSERT INTO flow_taps (send_id, port, created_at) VALUES (1, 'nx', 4500)`).run();
    return env;
  }
  const boot = async (env: Env, pw = "pw") =>
    JSON.parse((await (await get(env, "/admin/flows/9", pw)).text()).match(/<script type="application\/json" id="fe-data">(.*?)<\/script>/s)![1]) as {
      metrics: Record<string, number>;
      published: Graph | null;
      graph: Graph;
      ro: boolean;
    };
  const list = async (env: Env, set: string, pw = "pw") =>
    (await (await get(env, `/admin/flows/9/contacts?set=${set}`, pw)).json()) as { total: number; contacts: { id: string; name: string; username: string; at: number }[] };

  it("counts sends, people, opens and clicks, and lists who's behind each tile", async () => {
    const env = await seeded();
    expect((await boot(env)).metrics).toEqual({ sends: 3, contacts: 3, opened: 2, clicked: 1 });
    const all = await list(env, "all");
    expect(all.total).toBe(3);
    expect(all.contacts.map((c) => `${c.name} @${c.username}`)).toEqual(["Ana @ana", "Cy @cy", "Ben @ben"]); // newest message first
    expect((await list(env, "opened")).contacts.map((c) => c.id).sort()).toEqual(["501", "502"]);
    expect((await list(env, "clicked")).contacts.map((c) => c.id)).toEqual(["501"]);
    expect((await list(env, "nonsense")).total).toBe(3); // an unknown set is everyone
    // The reviewer login only ever sees test threads.
    expect((await boot(env, "rv")).metrics).toEqual({ sends: 1, contacts: 1, opened: 0, clicked: 0 });
    expect((await list(env, "all", "rv")).contacts.map((c) => c.id)).toEqual(["503"]);
  });

  it("tags everyone in a set, once, and the reviewer can't", async () => {
    const env = await seeded();
    const tags = async () => (await env.DB.prepare(`SELECT subscriber_id || ':' || tag AS t FROM lead_tags ORDER BY 1`).all<{ t: string }>()).results.map((r) => r.t);
    expect(await (await api(env, "/admin/flows/9/tag", { set: "opened", tag: " Warm " })).json()).toEqual({ ok: true, tag: "warm", added: 2 });
    expect(await tags()).toEqual(["501:warm", "502:warm"]);
    expect(await (await api(env, "/admin/flows/9/tag", { set: "all", tag: "warm" })).json()).toMatchObject({ added: 1 }); // only Cy is new
    expect((await api(env, "/admin/flows/9/tag", { set: "all", tag: "  " })).status).toBe(400);
    expect((await api(env, "/admin/flows/9/tag", { set: "all", tag: "x" }, "rv")).status).toBe(403);
    expect(await tags()).toEqual(["501:warm", "502:warm", "503:warm"]);
  });

  it("with unpublished changes waiting, the page carries what's live as well as the draft", async () => {
    const env = await seeded();
    expect((await boot(env)).published).toBeNull(); // nothing unpublished: the graph is what's live
    const live = (await boot(env)).graph;
    const draft: Graph = { ...live, nodes: [...live.nodes, { id: "extra", kind: "message", x: 900, y: 0, data: { bubbles: [{ text: "new step", buttons: [] }], quick_replies: [] } }] };
    expect((await api(env, "/admin/flows/9/draft", { graph: draft })).status).toBe(200);
    const b = await boot(env);
    expect(b.graph.nodes.map((n) => n.id)).toContain("extra");
    expect(b.published!.nodes.map((n) => n.id)).not.toContain("extra");
    expect(b.published!.nodes.length).toBe(live.nodes.length);
  });
});

describe("starter templates", () => {
  it("the reel template DMs a resource link and leaves a public reply", async () => {
    const env = await connected();
    const id = await newAutomation(env, "reel");
    const row = await env.DB.prepare(`SELECT source, keyword, name, draft FROM triggers WHERE id = ?1`).bind(id).first<{ source: string; keyword: string; name: string; draft: string }>();
    const graph = JSON.parse(row!.draft) as Graph;
    expect(row).toMatchObject({ source: "comment", keyword: "LINK", name: "Reel comment → resource link" });
    expect(graph.trigger.public_reply).toBe("Sent you a DM with the link.");
    expect(JSON.stringify(graph)).toContain("{{SKOOL_LINK}}");
    expect(graph.edges.map((e) => `${e.from}.${e.port}>${e.to}`).sort()).toEqual(["m1.send>m2", "trigger.next>m1"]);
    const page = await (await get(env, "/admin/automations")).text();
    expect(page).toContain("Reel comment → resource link");
    expect(page).not.toContain("—");
  });
});
