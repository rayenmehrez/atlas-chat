import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeD1 } from "./d1shim";
import * as db from "../src/db";
import { drainComments, handleComment, HOURLY_BUDGET, tellRefused } from "../src/comments";
import { syncComments } from "../src/comment_sync";
import type { Env } from "../src/setter";

const ME = "17840000000000001";
const MIN = 60_000;
const T = 1_800_000_000_000;

type Call = { url: string; body: any };
let calls: Call[] = [];
let failNext: string | null = null;
let feed: { id: string; text: string; timestamp: string; from: { id: string; username: string } }[] = [];

beforeEach(() => {
  calls = [];
  failNext = null;
  feed = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      if (url.endsWith("/me/messages")) {
        if (failNext) {
          const msg = failNext;
          failNext = null;
          return Response.json({ error: { message: msg, code: /rate/i.test(msg) ? 613 : 100 } }, { status: 400 });
        }
        return Response.json({ recipient_id: body.recipient.comment_id ? "lead-1" : body.recipient.id, message_id: `m${calls.length}` });
      }
      if (url.includes("/comments?")) return Response.json({ data: feed });
      return Response.json({ data: [] });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const env = { DB: makeD1(), SKOOL_LINK: "https://www.skool.com/your-community/about" } as unknown as Env;
  await db.setSetting(env.DB, "ig_token", "tok");
  await db.setSetting(env.DB, "ig_account_id", ME);
  const t = await env.DB.prepare(
    `INSERT INTO triggers (source, keyword, dm, media_id, enabled, created_at) VALUES ('comment', 'AGENT', 'here you go', 'reel1', 1, 1) RETURNING id`,
  ).first<{ id: number }>();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO flow_nodes (trigger_id, id, kind, data, x, y) VALUES (?1, 'trigger', 'trigger', '{}', 0, 0)`).bind(t!.id),
    env.DB.prepare(`INSERT INTO flow_nodes (trigger_id, id, kind, data, x, y) VALUES (?1, 'm1', 'message', ?2, 1, 0)`).bind(
      t!.id,
      JSON.stringify({ bubbles: [{ text: "here you go", buttons: [] }], quick_replies: [] }),
    ),
    env.DB.prepare(`INSERT INTO flow_edges (trigger_id, from_id, port, to_id) VALUES (?1, 'trigger', 'next', 'm1')`).bind(t!.id),
  ]);
  return env;
}
const privateReplies = () => calls.filter((c) => c.url.endsWith("/me/messages") && c.body?.recipient?.comment_id);
const comment = (id: string, text = "AGENT", lead = `lead-${id}`) => ({ comment_id: id, lead_id: lead, username: "u", media_id: "reel1", text });
const status = async (env: Env, id: string) => (await env.DB.prepare(`SELECT status, attempts FROM comments WHERE comment_id = ?1`).bind(id).first<{ status: string; attempts: number }>())!;

describe("private reply queue", () => {
  it("past the hourly budget, keyword comments wait and go out as the budget frees up, oldest first", async () => {
    const env = await setup();
    // An hour's worth already sent.
    await env.DB.batch(
      Array.from({ length: HOURLY_BUDGET }, (_, i) =>
        env.DB.prepare(`INSERT INTO comments (comment_id, subscriber_id, text, status, created_at, sent_at) VALUES (?1, ?2, 'x', 'sent', ?3, ?3)`).bind(`old${i}`, `o${i}`, T - 30 * MIN),
      ),
    );
    await handleComment(env.DB, "tok", env.SKOOL_LINK, comment("c1"), T);
    await handleComment(env.DB, "tok", env.SKOOL_LINK, comment("c2"), T + 1000);
    expect(privateReplies()).toHaveLength(0);
    expect((await status(env, "c1")).status).toBe("queued");
    expect(await drainComments(env.DB, "tok", env.SKOOL_LINK, T + 10 * MIN)).toBe(0); // still no room
    expect(await drainComments(env.DB, "tok", env.SKOOL_LINK, T + 31 * MIN)).toBe(2); // the old hour rolled off
    expect(privateReplies().map((c) => c.body.recipient.comment_id)).toEqual(["c1", "c2"]);
    expect((await status(env, "c2")).status).toBe("sent");
  });

  it("a rate-limit refusal retries with backoff; a permanent error fails; past 7 days it expires", async () => {
    const env = await setup();
    failNext = "Calls to this api have exceeded the rate limit.";
    await handleComment(env.DB, "tok", env.SKOOL_LINK, comment("c1"), T);
    expect(await status(env, "c1")).toEqual({ status: "queued", attempts: 1 });
    expect(await drainComments(env.DB, "tok", env.SKOOL_LINK, T + MIN)).toBe(0); // backoff: 2 minutes
    expect(await drainComments(env.DB, "tok", env.SKOOL_LINK, T + 3 * MIN)).toBe(1);
    expect((await status(env, "c1")).status).toBe("sent");

    failNext = "The comment was deleted";
    await handleComment(env.DB, "tok", env.SKOOL_LINK, comment("c2"), T);
    expect((await status(env, "c2")).status).toBe("failed");

    // Too many new conversations: Instagram says the thread doesn't exist. Wait an hour, and don't retry while it's still refusing.
    failNext = "The thread owner has archived or deleted this conversation, or the thread does not exist.";
    await handleComment(env.DB, "tok", env.SKOOL_LINK, comment("c4"), T);
    expect(await status(env, "c4")).toEqual({ status: "queued", attempts: 1 });
    expect(await drainComments(env.DB, "tok", env.SKOOL_LINK, T + 30 * MIN)).toBe(0);
    failNext = "The thread owner has archived or deleted this conversation, or the thread does not exist.";
    await handleComment(env.DB, "tok", env.SKOOL_LINK, comment("c5"), T + 55 * MIN);
    expect(await drainComments(env.DB, "tok", env.SKOOL_LINK, T + 61 * MIN)).toBe(0);
    expect(await drainComments(env.DB, "tok", env.SKOOL_LINK, T + 66 * MIN)).toBe(1);
    expect((await status(env, "c4")).status).toBe("sent");
    expect((await status(env, "c5")).status).toBe("queued");

    failNext = "rate limit";
    await handleComment(env.DB, "tok", env.SKOOL_LINK, comment("c3"), T);
    await drainComments(env.DB, "tok", env.SKOOL_LINK, T + 8 * 24 * 60 * MIN);
    expect((await status(env, "c3")).status).toBe("expired");
  });
});

describe("refused as too many new conversations", () => {
  const REFUSED = "The thread owner has archived or deleted this conversation, or the thread does not exist.";

  it("tells them once to DM the keyword, and does not say the DM was sent", async () => {
    const env = await setup();
    await env.DB.prepare(`UPDATE triggers SET public_reply = 'gotchu, sent'`).run();
    failNext = REFUSED;
    await handleComment(env.DB, "tok", env.SKOOL_LINK, comment("c1"), T);
    expect(calls.filter((c) => c.url.includes("/replies?"))).toHaveLength(0);
    expect(await tellRefused(env.DB, "tok", T + MIN)).toBe(1);
    const messages = calls.filter((c) => c.url.includes("/replies?")).map((c) => new URL(c.url).searchParams.get("message"));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/DM me AGENT/);
    expect(await tellRefused(env.DB, "tok", T + 2 * MIN)).toBe(0);
  });
});

describe("missed-comment backfill", () => {
  const iso = (t: number) => new Date(t).toISOString().replace(".000Z", "+0000");

  it("starts from now, then DMs keyword comments the webhook never delivered, skipping ours and ones already seen", async () => {
    const env = await setup();
    feed = [{ id: "before", text: "AGENT", timestamp: iso(T - 60 * MIN), from: { id: "x", username: "x" } }];
    expect(await syncComments(env, T)).toBe(0); // first pass only sets the starting point
    expect(privateReplies()).toHaveLength(0);

    await handleComment(env.DB, "tok", env.SKOOL_LINK, comment("hooked"), T + MIN); // the webhook got this one
    feed = [
      { id: "ours", text: "gotchu fam, sent", timestamp: iso(T + 3 * MIN), from: { id: ME, username: "yourhandle" } },
      { id: "lost", text: "Agent 🔥", timestamp: iso(T + 2 * MIN), from: { id: "lead-lost", username: "l" } },
      { id: "hooked", text: "AGENT", timestamp: iso(T + MIN), from: { id: "lead-hooked", username: "h" } },
      { id: "before", text: "AGENT", timestamp: iso(T - 60 * MIN), from: { id: "x", username: "x" } },
    ];
    expect(await syncComments(env, T + 4 * MIN)).toBe(1);
    expect(privateReplies().map((c) => c.body.recipient.comment_id)).toEqual(["hooked", "lost"]);
    expect(await syncComments(env, T + 5 * MIN)).toBe(0); // inside 3 minutes: no pass
    expect(await syncComments(env, T + 8 * MIN)).toBe(0); // nothing new
  });
});
