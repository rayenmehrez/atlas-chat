import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeD1 } from "./d1shim";
import * as db from "../src/db";
import { checkHealth, cronStep, webhookSeen } from "../src/health";
import type { Env } from "../src/setter";

const MIN = 60_000;
const T = 1_800_000_000_000;
let pushes: { url: string; title: string | null; body: string }[] = [];
beforeEach(() => {
  pushes = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      pushes.push({ url, title: new Headers(init?.headers).get("Title"), body: String(init?.body) });
      return new Response("ok");
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
const env = (topic: string | undefined = "secret-topic") => ({ DB: makeD1(), ALERT_TOPIC: topic }) as unknown as Env;

describe("phone alerts", () => {
  it("a quiet webhook alerts once an hour, not every minute", async () => {
    const e = env();
    await webhookSeen(e.DB, T);
    await checkHealth(e, T + 30 * MIN);
    expect(pushes).toHaveLength(0);
    await checkHealth(e, T + 61 * MIN);
    await checkHealth(e, T + 62 * MIN);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].url).toBe("https://ntfy.sh/secret-topic");
    expect(pushes[0].title).toContain("webhook is quiet");
    await checkHealth(e, T + 122 * MIN); // an hour later, still quiet: again
    expect(pushes).toHaveLength(2);
  });

  it("three failed sends in 15 minutes alert with the last error; a comment backlog alerts too", async () => {
    const e = env();
    for (const i of [1, 2, 3])
      await e.DB.prepare(`INSERT INTO comments (comment_id, subscriber_id, text, status, error, created_at) VALUES (?1, 'x', 'AGENT', 'failed', 'instagram 400: boom', ?2)`).bind(`f${i}`, T - MIN).run();
    for (let i = 0; i < 51; i++)
      await e.DB.prepare(`INSERT INTO comments (comment_id, subscriber_id, text, status, created_at) VALUES (?1, 'x', 'AGENT', 'queued', ?2)`).bind(`q${i}`, T - 5 * MIN).run();
    await checkHealth(e, T);
    expect(pushes.map((p) => p.title)).toEqual(["AtlasChat: 3 sends failed in 15 min", "AtlasChat: 51 comment DMs waiting"]);
    expect(pushes[0].body).toContain("boom");
  });

  it("a cron step alerts after five failures in a row, and a success resets the count", async () => {
    const e = env();
    const boom = async () => {
      throw new Error("D1 read limit");
    };
    for (let i = 0; i < 4; i++) await cronStep(e, "setter", T + i * MIN, boom);
    expect(pushes).toHaveLength(0);
    await cronStep(e, "setter", T + 4 * MIN, async () => {});
    for (let i = 0; i < 5; i++) await cronStep(e, "setter", T + (5 + i) * MIN, boom);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].body).toContain("D1 read limit");
  });

  it("without a topic nothing is sent", async () => {
    const e = env("");
    await webhookSeen(e.DB, T);
    await checkHealth(e, T + 2 * 60 * MIN);
    expect(pushes).toHaveLength(0);
    expect(await db.getSetting(e.DB, "alert_at:webhook")).toBeNull();
  });
});
