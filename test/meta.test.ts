import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeD1 } from "./d1shim";

vi.mock("../src/brain", async (orig) => ({ ...(await orig<typeof import("../src/brain")>()), decide: vi.fn() }));

import { decide } from "../src/brain";
import * as db from "../src/db";
import worker from "../src/index";
import { matches } from "../src/comments";
import { hmacHex, parseComments, parseSignedRequest, parseWebhook, verifySignature } from "../src/meta";
import { handleAdminPost } from "../src/admin";
import { sendDraft, tick, type Env } from "../src/setter";

const ME = "17840000000000001"; // @yourhandle
const LEAD = "990011";
const MIN = 60_000;
let MC_IG_ID = LEAD; // what Manychat's getInfo reports as the subscriber's ig_id
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    DB: makeD1(),
    AI: {} as Ai,
    ANTHROPIC_API_KEY: "test",
    MANYCHAT_API_KEY: "",
    INBOUND_SECRET: "s",
    ADMIN_PASSWORD: "pw",
    REVIEW_PASSWORD: "rv",
    SKOOL_LINK: "https://www.skool.com/your-community/about",
    AUTOPILOT: "true", // the AI is on (autopilot) or off; off drafts nothing
    REPLY_DELAY_MIN_S: "60",
    REPLY_DELAY_MAX_S: "240",
    TRANSPORT: "meta",
    META_IG_APP_ID: "100000000000001",
    META_APP_SECRET: "appsecret",
    META_VERIFY_TOKEN: "vt",
    ...over,
  };
}

const msg = (message: Record<string, unknown>, echo = false) => ({
  object: "instagram",
  entry: [
    {
      id: ME,
      time: 1,
      messaging: [{ sender: { id: echo ? ME : LEAD }, recipient: { id: echo ? LEAD : ME }, timestamp: Date.now(), message: { ...message, ...(echo ? { is_echo: true } : {}) } }],
    },
  ],
});

async function post(env: Env, payload: unknown, secret = "appsecret") {
  const body = JSON.stringify(payload);
  const req = new Request("https://x/meta", { method: "POST", body, headers: { "X-Hub-Signature-256": `sha256=${await hmacHex(secret, body)}` } });
  return worker.fetch(req, env, ctx);
}

const graphCalls: { url: string; body: unknown }[] = [];
let nextMid = 0;
beforeEach(() => {
  graphCalls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      graphCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/me/messages")) return Response.json({ recipient_id: LEAD, message_id: `out-${++nextMid}` });
      if (url.includes("fields=name,username")) return Response.json({ username: "lead.handle", name: "Sam Lee" });
      if (url.includes("subscriber/getInfo")) {
        return new Response(`{"status":"success","data":{"id":"5550001","ig_id":${MC_IG_ID},"ig_username":"lead.handle","name":"Sam Lee"}}`);
      }
      if (url.includes("sendContent")) return Response.json({ status: "success" });
      return Response.json({});
    }),
  );
  vi.mocked(decide).mockResolvedValue({ action: "reply", bubbles: ["yooo", "whats ur biz rn?"], stage: "lead", note: "" });
});
afterEach(() => vi.unstubAllGlobals());

describe("signature", () => {
  it("accepts the right secret only", async () => {
    const sig = `sha256=${await hmacHex("appsecret", "{}")}`;
    expect(await verifySignature("appsecret", "{}", sig)).toBe(true);
    expect(await verifySignature("other", "{}", sig)).toBe(false);
    expect(await verifySignature("appsecret", "{}", null)).toBe(false);
    expect(await verifySignature("", "{}", sig)).toBe(false);
  });
});

describe("parseWebhook", () => {
  it("maps inbound, echo, attachments and story replies; skips deleted and junk", () => {
    expect(parseWebhook(msg({ mid: "m1", text: "hey" }))).toMatchObject([{ kind: "inbound", lead_id: LEAD, mid: "m1", text: "hey" }]);
    expect(parseWebhook(msg({ mid: "m2", text: "yo" }, true))).toMatchObject([{ kind: "echo", lead_id: LEAD, text: "yo" }]);
    expect(parseWebhook(msg({ mid: "m3", attachments: [{ type: "audio" }] }))[0].text).toBe("[voice note]");
    expect(parseWebhook(msg({ mid: "m4", text: "fire", reply_to: { story: { id: "s" } } }))[0].text).toBe("[replying to your story] fire");
    expect(parseWebhook(msg({ mid: "m5", is_deleted: true }))).toEqual([]);
    expect(parseWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });
});

describe("/meta endpoint", () => {
  it("answers the verification handshake only with the right token", async () => {
    const env = makeEnv();
    const ok = await worker.fetch(new Request("https://x/meta?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42"), env, ctx);
    expect(await ok.text()).toBe("42");
    const bad = await worker.fetch(new Request("https://x/meta?hub.mode=subscribe&hub.verify_token=no&hub.challenge=42"), env, ctx);
    expect(bad.status).toBe(403);
  });

  it("rejects unsigned posts and records signed ones once (retries are deduped)", async () => {
    const env = makeEnv();
    expect((await post(env, msg({ mid: "m1", text: "hey" }), "wrong")).status).toBe(401);
    await db.setSetting(env.DB, "ig_token", "tok");
    await post(env, msg({ mid: "m1", text: "hey" }));
    await post(env, msg({ mid: "m1", text: "hey" }));
    const thread = await db.history(env.DB, LEAD);
    expect(thread).toHaveLength(1);
    expect((await db.getLead(env.DB, LEAD))?.username).toBe("lead.handle");
  });
});

describe("meta flow", () => {
  it("drafts, sends each bubble through the Send API, and ignores the echoes of its own sends", async () => {
    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", "tok");
    const t0 = Date.now();
    await post(env, msg({ mid: "m1", text: "hey saw ur reel" }));
    await tick(env, t0 + MIN);
    const draft = (await db.getDraft(env.DB, 1))!;
    await sendDraft(env, draft, t0 + MIN);
    const sends = graphCalls.filter((c) => c.url.endsWith("/me/messages"));
    expect(sends.map((c) => (c.body as { message: { text: string } }).message.text)).toEqual(["yooo", "whats ur biz rn?"]);
    expect((sends[0].body as { recipient: { id: string } }).recipient.id).toBe(LEAD);
    // Meta echoes our own two messages back
    await post(env, msg({ mid: "out-1", text: "yooo" }, true));
    await post(env, msg({ mid: "out-2", text: "whats ur biz rn?" }, true));
    expect((await db.history(env.DB, LEAD)).map((m) => m.role)).toEqual(["lead", "bot", "bot"]);
    expect((await db.getDraft(env.DB, 1))?.status).toBe("sent");
  });

  it("a reply sent by hand (or Manychat) kills the pending draft and stops drafting until the lead talks again", async () => {
    const env = makeEnv();
    const t0 = Date.now();
    await post(env, msg({ mid: "m1", text: "EDIT" }));
    await tick(env, t0 + MIN);
    await post(env, msg({ mid: "mc-1", text: "here's the guide 👇", app_id: 1234 }, true)); // Manychat lead magnet
    expect((await db.getDraft(env.DB, 1))?.status).toBe("superseded");
    await tick(env, t0 + 2 * MIN);
    expect(decide).toHaveBeenCalledTimes(1);
    await post(env, msg({ mid: "m2", text: "got it thanks" }));
    await tick(env, t0 + 4 * MIN);
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it("fails the draft cleanly when Instagram isn't connected", async () => {
    const env = makeEnv();
    const t0 = Date.now();
    await post(env, msg({ mid: "m1", text: "hey" }));
    await tick(env, t0 + MIN);
    await sendDraft(env, (await db.getDraft(env.DB, 1))!, t0 + MIN);
    const d = await db.getDraft(env.DB, 1);
    expect(d?.status).toBe("failed");
    expect(d?.error).toContain("not connected");
  });
});

describe("manychat fallback", () => {
  const viaManychat = (env: Env, text: string) =>
    worker.fetch(
      new Request("https://x/manychat", {
        method: "POST",
        headers: { "X-Setter-Key": "s" },
        body: JSON.stringify({ subscriber_id: "5550001", username: "{{instagram_username}}", first_name: "", text }),
      }),
      env, ctx);

  it("reads ig_id past 2^53 without rounding", async () => {
    MC_IG_ID = "9300000000000001";
    const { getSubscriber } = await import("../src/manychat");
    expect((await getSubscriber("k", "5550001")).ig_id).toBe("9300000000000001");
    MC_IG_ID = LEAD;
  });

  it("files a Manychat DM under the Instagram id, answers through Manychat, and the echo doesn't double it", async () => {
    const env = makeEnv({ MANYCHAT_API_KEY: "mc" });
    await db.setSetting(env.DB, "ig_token", "tok");
    const t0 = Date.now();
    await viaManychat(env, "how much is it");
    const lead = (await db.getLead(env.DB, LEAD))!;
    expect(lead).toMatchObject({ mc_id: "5550001", username: "lead.handle", first_name: "Sam Lee" });
    await tick(env, t0 + MIN);
    await sendDraft(env, (await db.getDraft(env.DB, 1))!, t0 + MIN);
    const mc = graphCalls.filter((c) => c.url.includes("sendContent"));
    expect(mc).toHaveLength(1);
    expect(mc[0].body).toMatchObject({ subscriber_id: 5550001 });
    expect(graphCalls.some((c) => c.url.endsWith("/me/messages"))).toBe(false);
    // Meta echoes Manychat's sends: they claim the stored bubbles instead of adding copies
    await post(env, msg({ mid: "e1", text: "yooo" }, true));
    await post(env, msg({ mid: "e2", text: "whats ur biz rn?" }, true));
    expect((await db.history(env.DB, LEAD)).map((m) => [m.role, m.mid])).toEqual([
      ["lead", null],
      ["bot", "e1"],
      ["bot", "e2"],
    ]);
  });

  it("a DM that arrives down both pipes is recorded once, either order; distinct Meta messages still both land", async () => {
    const env = makeEnv({ MANYCHAT_API_KEY: "mc" });
    await post(env, msg({ mid: "m1", text: "hey" }));
    await viaManychat(env, "hey");
    await viaManychat(env, "u there?");
    await post(env, msg({ mid: "m2", text: "u there?" }));
    await post(env, msg({ mid: "m3", text: "u there?" }));
    expect((await db.history(env.DB, LEAD)).map((m) => [m.text, m.mid])).toEqual([
      ["hey", "m1"],
      ["u there?", "m2"],
      ["u there?", "m3"],
    ]);
    expect((await db.getLead(env.DB, LEAD))?.mc_id).toBe("5550001");
  });
});

const comment = (text: string, id = "c1", from = LEAD, media = "reel1") => ({
  object: "instagram",
  entry: [{ id: ME, time: 1, changes: [{ field: "comments", value: { id, text, from: { id: from, username: "lead.handle" }, media: { id: media } } }] }],
});

async function addTrigger(env: Env, keyword: string, media_id: string | null = null, public_reply: string | null = "sent 📩") {
  await env.DB.prepare(`INSERT INTO triggers (keyword, media_id, dm, public_reply, created_at) VALUES (?1, ?2, ?3, ?4, 0)`)
    .bind(keyword, media_id, "here u go {{SKOOL_LINK}}", public_reply)
    .run();
}

const status = async (env: Env, id: string) =>
  (await env.DB.prepare(`SELECT status FROM comments WHERE comment_id = ?1`).bind(id).first<{ status: string }>())?.status;

describe("comment-to-DM", () => {
  it("parses comments and live comments, skipping our own and other fields", () => {
    expect(parseComments(comment("AI pls"))).toEqual([{ comment_id: "c1", lead_id: LEAD, username: "lead.handle", media_id: "reel1", text: "AI pls" }]);
    const unified = {
      object: "instagram",
      entry: [{ id: ME, changes: [{ field: "comments", value: { comment_id: "c9", text: "guide", from: { id: LEAD, username: "lead.handle" }, media: { id: "reel9" } } }] }],
    };
    expect(parseComments(unified)).toEqual([{ comment_id: "c9", lead_id: LEAD, username: "lead.handle", media_id: "reel9", text: "guide" }]);
    const asChange = {
      object: "instagram",
      entry: [{ id: ME, changes: [{ field: "messages", value: { sender: { id: LEAD }, recipient: { id: ME }, timestamp: 5, message: { mid: "m9", text: "from changes" } } }] }],
    };
    expect(parseWebhook(asChange)).toMatchObject([{ kind: "inbound", lead_id: LEAD, mid: "m9", text: "from changes" }]);
    expect(parseComments(comment("thanks!", "c2", ME))).toEqual([]);
    const live = { object: "instagram", entry: [{ id: ME, changes: [{ field: "live_comments", value: { id: "l1", text: "yo", from: { id: LEAD } } }] }] };
    expect(parseComments(live)).toHaveLength(1);
    expect(parseComments(msg({ mid: "m1", text: "hey" }))).toEqual([]);
  });

  it("matches whole words and phrases, any case", () => {
    expect(matches("AI", "ai please!!")).toBe(true);
    expect(matches("AI", "I said hi")).toBe(false);
    expect(matches("ai guide", "send the AI-guide 🙏")).toBe(true);
    expect(matches("*", "anything")).toBe(true);
    expect(matches("  ", "anything")).toBe(false);
  });

  it("DMs the commenter once, replies publicly, and hands the thread to the setter only after they answer", async () => {
    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", "tok");
    await addTrigger(env, "AI");
    await post(env, comment("AI 🔥"));
    await post(env, comment("AI 🔥")); // webhook retry
    const dms = graphCalls.filter((c) => c.url.endsWith("/me/messages"));
    expect(dms).toHaveLength(1);
    expect(dms[0].body).toEqual({ recipient: { comment_id: "c1" }, message: { text: "here u go https://www.skool.com/your-community/about" } });
    expect(graphCalls.filter((c) => c.url.includes("/c1/replies?message=sent"))).toHaveLength(1);
    expect(await status(env, "c1")).toBe("sent");
    expect((await db.history(env.DB, LEAD)).map((m) => [m.role, m.text])).toEqual([
      ["lead", "[commented on your post] AI 🔥"],
      ["bot", "here u go https://www.skool.com/your-community/about"],
    ]);

    // The echo of our DM is not a second message; a comment alone never triggers a draft.
    await post(env, msg({ mid: "out-1", text: "here u go https://www.skool.com/your-community/about" }, true));
    const t0 = Date.now();
    await tick(env, t0 + MIN);
    expect(decide).not.toHaveBeenCalled();

    // Same person, same keyword on another post: no second DM.
    await post(env, comment("AI", "c2"));
    expect(await status(env, "c2")).toBe("repeat");

    await post(env, msg({ mid: "m1", text: "thanks whats inside?" }));
    await tick(env, t0 + 2 * MIN);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("post-specific triggers win, non-matching comments are just logged, failures are recorded", async () => {
    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", "tok");
    await addTrigger(env, "AI");
    await addTrigger(env, "AI", "reel1", null);
    await post(env, comment("ai"));
    const row = await env.DB.prepare(`SELECT trigger_id FROM comments WHERE comment_id = 'c1'`).first<{ trigger_id: number }>();
    expect(row?.trigger_id).toBe(2);
    expect(graphCalls.some((c) => c.url.includes("/replies"))).toBe(false);
    await post(env, comment("love this", "c3", "777"));
    expect(await status(env, "c3")).toBe("ignored");

    const env2 = makeEnv();
    await addTrigger(env2, "AI");
    await post(env2, comment("AI"));
    expect(await status(env2, "c1")).toBe("failed");
  });
});

describe("deauthorize / data deletion callbacks", () => {
  const b64 = (b: Uint8Array | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  async function signed(secret: string, user_id: string) {
    const payload = b64(JSON.stringify({ algorithm: "HMAC-SHA256", issued_at: 1, user_id }));
    const hex = await hmacHex(secret, payload);
    return `${b64(Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))))}.${payload}`;
  }

  it("verifies the signature", async () => {
    expect(await parseSignedRequest("appsecret", await signed("appsecret", "42"))).toEqual({ user_id: "42" });
    expect(await parseSignedRequest("appsecret", await signed("other", "42"))).toBeNull();
    expect(await parseSignedRequest("appsecret", null)).toBeNull();
  });

  it("drops the Instagram connection and returns a confirmation code", async () => {
    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", "tok");
    const req = new Request("https://x/data-deletion", { method: "POST", body: new URLSearchParams({ signed_request: await signed("appsecret", ME) }) });
    const res = await worker.fetch(req, env, ctx);
    const body = (await res.json()) as { url: string; confirmation_code: string };
    expect(body.url).toBe(`https://x/data-deletion?code=${body.confirmation_code}`);
    expect(await db.getSetting(env.DB, "ig_token")).toBeNull();
    const bad = new Request("https://x/deauthorize", { method: "POST", body: new URLSearchParams({ signed_request: "x.y" }) });
    expect((await worker.fetch(bad, env, ctx)).status).toBe(400);
  });
});

describe("reviewer login", () => {
  const as = (pw: string, path: string, init: RequestInit = {}) =>
    new Request(`https://x${path}`, { ...init, headers: { Authorization: `Basic ${btoa(`meta:${pw}`)}` } });

  async function twoThreads(env: Env) {
    const t0 = Date.now();
    await post(env, msg({ mid: "m1", text: "hey whats the community about" })); // a real lead
    await db.recordInbound(env.DB, { subscriber_id: "555", username: "reviewer", first_name: null, text: "SETTERTEST hi", mid: "r1" }, t0);
    await tick(env, t0 + MIN);
  }

  it("sees and answers only SETTERTEST threads, and can't touch triggers", async () => {
    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", "tok");
    await twoThreads(env);
    expect((await db.getLead(env.DB, "555"))?.test).toBe(1);
    expect((await db.getLead(env.DB, LEAD))?.test).toBe(0);

    const admin = await (await worker.fetch(as("pw", "/admin/inbox"), env, ctx)).text();
    expect(admin).toContain(`/admin/inbox/${LEAD}`);
    expect(admin).toContain("/admin/inbox/555");
    const review = await (await worker.fetch(as("rv", "/admin/inbox"), env, ctx)).text();
    expect(review).toContain("/admin/inbox/555");
    expect(review).not.toContain(`/admin/inbox/${LEAD}`);

    const reply = as("rv", `/admin/inbox/${LEAD}/reply`, { method: "POST", body: new URLSearchParams({ bubbles: "yo" }) });
    expect((await worker.fetch(reply, env, ctx)).status).toBe(403);
    expect((await worker.fetch(as("rv", `/admin/leads/${LEAD}/pause`, { method: "POST" }), env, ctx)).status).toBe(403);
    const add = as("rv", "/admin/triggers", { method: "POST", body: new URLSearchParams({ keyword: "x", dm: "y" }) });
    expect((await worker.fetch(add, env, ctx)).status).toBe(403);
    expect((await worker.fetch(as("nope", "/admin"), env, ctx)).status).toBe(401);
  });

  it("a SETTERTEST comment marks the commenter as a test thread", async () => {
    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", "tok");
    await addTrigger(env, "SETTERTEST");
    await post(env, comment("settertest"));
    expect((await db.getLead(env.DB, LEAD))?.test).toBe(1);
  });
});
