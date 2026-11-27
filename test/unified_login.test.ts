import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeD1 } from "./d1shim";
import * as db from "../src/db";
import worker from "../src/index";
import {
  FB_GRAPH,
  IG_GRAPH,
  clearInstagramAccountCache,
  fetchAccount,
  graph,
  graphPath,
  hmacHex,
  isUnifiedLoginToken,
  privateReply,
  recentMedia,
  redactSecrets,
  refreshToken,
  replyToComment,
  sendText,
  subscribe,
  verifySignature,
  withInstagramWrites,
} from "../src/meta";
import { tick, type Env } from "../src/setter";

const EA = "EAAG_unified_DoNotLeak_token_9f3c";
const IG = "IGAA_legacy_DoNotLeak_token_9f3c";
const IG_ID = "17841400000000099";
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
    AUTOPILOT: "false",
    REPLY_DELAY_MIN_S: "60",
    REPLY_DELAY_MAX_S: "240",
    TRANSPORT: "meta",
    META_IG_APP_ID: "100000000000001",
    META_APP_SECRET: "appsecret",
    META_VERIFY_TOKEN: "vt",
    ...over,
  };
}

type AccountRow = { id: string; username: string; name?: string; profile_picture_url?: string };
let accounts: AccountRow[] = [{ id: IG_ID, username: "yourhandle", name: "Rayen", profile_picture_url: "https://cdn.example/p.jpg" }];
const calls: { url: string; method: string }[] = [];

beforeEach(() => {
  clearInstagramAccountCache();
  accounts = [{ id: IG_ID, username: "yourhandle", name: "Rayen", profile_picture_url: "https://cdn.example/p.jpg" }];
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: (init?.method ?? "GET").toUpperCase() });
      if (u.includes("/boom")) return Response.json({ error: { message: `bad ${EA} and ${IG}`, code: 190 } }, { status: 400 });
      if (u.includes("refresh_access_token")) return Response.json({ access_token: "IGAA_refreshed_token_value_0001" });
      if (u.includes("/assigned_instagram_accounts")) return Response.json({ data: accounts });
      if (u.includes("/conversations")) {
        if (u.includes("after=cursor")) return Response.json({ data: [] });
        if (u.includes("limit=1")) {
          return Response.json({ data: [], paging: { next: `https://graph.facebook.com/v21.0/${IG_ID}/conversations?after=cursor&access_token=${EA}` } });
        }
        return Response.json({ data: [] });
      }
      if (u.includes("/me?fields=user_id")) return Response.json({ user_id: "17840000000000001", username: "yourhandle" });
      return Response.json({ success: true, message_id: "mid-1", recipient_id: "990011", data: [] });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const urls = () => calls.map((c) => c.url);
const auth = { Authorization: `Basic ${btoa("owner:pw")}` };

describe("unified login routing", () => {
  it("tells the two token kinds apart and strips either Graph host from paging links", () => {
    expect(isUnifiedLoginToken(EA)).toBe(true);
    expect(isUnifiedLoginToken(IG)).toBe(false);
    expect(isUnifiedLoginToken("tok")).toBe(false);
    expect(graphPath(`https://graph.instagram.com/v26.0/me/conversations?after=1`)).toBe("/me/conversations?after=1");
    expect(graphPath(`https://graph.facebook.com/v27.0/${IG_ID}/conversations?after=1`)).toBe(`/${IG_ID}/conversations?after=1`);
    expect(graphPath(`https://graph.facebook.com/${IG_ID}/media`)).toBe(`/${IG_ID}/media`);
    expect(graphPath("/me/messages")).toBe("/me/messages");
  });

  it("sends, lists media, replies to a comment, and subscribes on graph.facebook.com under the assigned account", async () => {
    accounts = [
      { id: "111", username: "other.page", name: "Other" },
      { id: IG_ID, username: "yourhandle", name: "Rayen", profile_picture_url: "https://cdn.example/p.jpg" },
    ];
    const account = await fetchAccount(EA);
    expect(account).toMatchObject({ id: IG_ID, username: "yourhandle", name: "Rayen" });
    expect(await sendText(EA, "990011", "hi")).toBe("mid-1");
    await recentMedia(EA, 5);
    await privateReply(EA, "c1", "hello");
    await replyToComment(EA, "c1", "sent");
    await subscribe(EA);
    expect(urls().every((u) => u.startsWith(FB_GRAPH))).toBe(true);
    expect(urls().some((u) => u.includes("graph.instagram.com"))).toBe(false);
    expect(urls().some((u) => u.includes(EA))).toBe(false);
    expect(urls().filter((u) => u.includes("/assigned_instagram_accounts"))).toHaveLength(1);
    expect(urls().some((u) => u === `${FB_GRAPH}/${IG_ID}/messages`)).toBe(true);
    expect(urls().some((u) => u.startsWith(`${FB_GRAPH}/${IG_ID}/media?`))).toBe(true);
    expect(urls().some((u) => u.startsWith(`${FB_GRAPH}/c1/replies?`))).toBe(true);
    expect(urls().some((u) => u.startsWith(`${FB_GRAPH}/${IG_ID}/subscribed_apps?`) && decodeURIComponent(u).includes("message_reactions") && decodeURIComponent(u).includes("messaging_referral"))).toBe(true);
    expect(urls().some((u) => /\/me\/(?!assigned_instagram_accounts)/.test(u))).toBe(false);
  });

  it("keeps Instagram Login tokens on graph.instagram.com and /me", async () => {
    await sendText(IG, "990011", "hi");
    await recentMedia(IG, 5);
    await subscribe(IG);
    expect(urls().every((u) => u.startsWith(IG_GRAPH))).toBe(true);
    expect(urls().some((u) => u.includes("graph.facebook.com") || u.includes("/assigned_instagram_accounts"))).toBe(false);
    expect(urls().some((u) => u === `${IG_GRAPH}/me/messages`)).toBe(true);
    expect(urls().some((u) => u.startsWith(`${IG_GRAPH}/me/media?`))).toBe(true);
    expect(urls().some((u) => u.startsWith(`${IG_GRAPH}/me/subscribed_apps?`) && !decodeURIComponent(u).includes("message_reactions"))).toBe(true);
    expect(urls().some((u) => u.includes(IG))).toBe(false);
  });

  it("follows paging.next on both hosts and drops the access token from the next URL", async () => {
    const page = await graph<{ paging?: { next?: string } }>(`/me/conversations?platform=instagram&limit=1`, { headers: { Authorization: `Bearer ${EA}` } });
    await graph(page.paging!.next!, { headers: { Authorization: `Bearer ${EA}` } });
    expect(urls().at(-1)).toBe(`${FB_GRAPH}/${IG_ID}/conversations?after=cursor`);
    expect(urls().at(-1)).not.toContain(EA);

    calls.length = 0;
    await graph("https://graph.instagram.com/v26.0/me/conversations?after=igcursor", { headers: { Authorization: `Bearer ${IG}` } });
    expect(urls()).toEqual([`${IG_GRAPH}/me/conversations?after=igcursor`]);
  });

  it("does not refresh or replace a Unified Login token, and still refreshes an Instagram Login token", async () => {
    expect(await refreshToken(EA)).toBeNull();
    expect(calls).toEqual([]);

    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", EA);
    await db.setSetting(env.DB, "ig_token_at", "1");
    await tick(env, Date.now());
    expect(await db.getSetting(env.DB, "ig_token")).toBe(EA);
    expect(Number(await db.getSetting(env.DB, "ig_token_at"))).toBeGreaterThan(1_000);
    expect(urls().some((u) => u.includes("refresh_access_token"))).toBe(false);
    expect(urls().some((u) => u.startsWith(`${FB_GRAPH}/${IG_ID}/conversations`))).toBe(true);
    expect(urls().every((u) => u.startsWith(FB_GRAPH))).toBe(true);

    calls.length = 0;
    const refreshed = await refreshToken(IG);
    expect(refreshed).toBe("IGAA_refreshed_token_value_0001");
    expect(urls()[0]).toContain("https://graph.instagram.com/refresh_access_token?");
    expect(urls()[0]).toContain("grant_type=ig_refresh_token");
  });

  it("refuses an ambiguous Unified Login token instead of guessing an account", async () => {
    accounts = [
      { id: "111", username: "one", name: "One" },
      { id: "222", username: "two", name: "Two" },
    ];
    await expect(fetchAccount(EA)).rejects.toThrow(/more than one Instagram account/);
    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", "already-saved-token-value");
    const res = await worker.fetch(
      new Request("https://x/admin/settings/instagram", {
        method: "POST",
        headers: { ...auth, Origin: "https://x" },
        body: new URLSearchParams({ intent: "save", ig_access_token: EA }),
      }),
      env,
      ctx,
    );
    expect(res.headers.get("Location")).toBe("https://x/admin/settings?ig=wrong_account");
    expect(await db.getSetting(env.DB, "ig_token")).toBe("already-saved-token-value");
    expect(urls().some((u) => u.includes(EA) || u.includes("/messages"))).toBe(false);
  });

  it("redacts tokens from Graph errors", async () => {
    await expect(graph("/boom", { headers: { Authorization: `Bearer ${EA}` } })).rejects.toThrow(/instagram 400 code 190: bad \[token\] and \[token\]/);
    expect(redactSecrets(`Bearer ${EA} access_token=${IG}`)).not.toContain(EA);
    expect(redactSecrets(`Bearer ${EA} access_token=${IG}`)).not.toContain(IG);
  });

  it("shows the connected @username for a pasted Unified Login token and never returns the token", async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      new Request("https://x/admin/settings/instagram", {
        method: "POST",
        headers: { ...auth, Origin: "https://x" },
        body: new URLSearchParams({ intent: "save", ig_access_token: `Bearer ${EA}` }),
      }),
      env,
      ctx,
    );
    expect(res.headers.get("Location")).toBe("https://x/admin/settings?ig=connected");
    expect(await db.getSetting(env.DB, "ig_token")).toBe(EA);
    expect(await db.getSetting(env.DB, "ig_account_id")).toBe(IG_ID);
    const profile = await db.getSetting(env.DB, "ig_profile");
    expect(profile).toContain("yourhandle");
    expect(profile).not.toContain(EA);
    expect(urls().every((u) => u.startsWith(FB_GRAPH))).toBe(true);
    expect(urls().some((u) => u.includes("/subscribed_apps"))).toBe(true);
    const page = await worker.fetch(new Request("https://x/admin/settings?ig=connected", { headers: auth }), env, ctx);
    const html = await page.text();
    expect(html).toContain("Connected as @yourhandle");
    expect(html).toContain("Token saved. Instagram confirmed the connection.");
    expect(html).not.toContain(EA);
  });
});

describe("instagram account safety", () => {
  it("rejects a bad, missing, or non-sha256 webhook signature and accepts only the exact digest", async () => {
    const hex = await hmacHex("appsecret", "{}");
    expect(await verifySignature("appsecret", "{}", `sha256=${hex}`)).toBe(true);
    expect(await verifySignature("appsecret", "{}", `sha256=${hex.toUpperCase()}`)).toBe(true);
    const flipped = hex.slice(0, -1) + (hex.endsWith("0") ? "1" : "0");
    expect(await verifySignature("appsecret", "{}", `sha256=${flipped}`)).toBe(false);
    expect(await verifySignature("appsecret", "{}", `sha256=${hex.slice(0, 32)}`)).toBe(false);
    expect(await verifySignature("appsecret", "{}", "sha1=" + hex)).toBe(false);
    expect(await verifySignature("appsecret", "{}", null)).toBe(false);
    expect(await verifySignature("", "{}", `sha256=${hex}`)).toBe(false);
    expect(await verifySignature("appsecret", "{}", "sha256=zzzz")).toBe(false);

    const env = makeEnv({ META_APP_SECRET: "" });
    const body = "{}";
    const open = await worker.fetch(
      new Request("https://x/meta", { method: "POST", body, headers: { "X-Hub-Signature-256": `sha256=${hex}` } }),
      env,
      ctx,
    );
    expect(open.status).toBe(401);
  });

  it("does not send from localhost or when preview writes are off, and does not subscribe", async () => {
    await expect(withInstagramWrites(false, () => sendText(EA, "990011", "nope"))).rejects.toThrow(/preview does not send/);
    await expect(withInstagramWrites(false, () => replyToComment(EA, "c1", "nope"))).rejects.toThrow(/preview does not send/);
    calls.length = 0;
    await withInstagramWrites(false, () => subscribe(EA));
    expect(calls).toEqual([]);

    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", EA);
    const now = Date.now();
    await db.recordInbound(env.DB, { subscriber_id: "990011", username: "lead", first_name: null, text: "hey", mid: "m1" }, now);
    calls.length = 0;
    const local = await worker.fetch(
      new Request("http://127.0.0.1:8791/admin/inbox/990011/reply", {
        method: "POST",
        headers: auth,
        body: new URLSearchParams({ bubbles: "hello from preview" }),
      }),
      env,
      ctx,
    );
    expect(local.status).toBe(303);
    expect(local.headers.get("Location")).toContain("preview+does+not+send");
    expect(local.headers.get("Location")).not.toContain(EA);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);

    calls.length = 0;
    const flagged = await worker.fetch(
      new Request("https://x/admin/inbox/990011/reply", {
        method: "POST",
        headers: auth,
        body: new URLSearchParams({ bubbles: "hello from preview" }),
      }),
      makeEnv({ ATLAS_PREVIEW: "true", DB: env.DB }),
      ctx,
    );
    expect(flagged.status).toBe(303);
    expect(flagged.headers.get("Location")).toContain("preview+does+not+send");
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("does not add an auth bypass", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|mjs|js|sh|md)$/.test(name)) files.push(path);
      }
    };
    walk("src");
    walk("scripts");
    const text = files.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(text).not.toContain("LOCAL_NO_AUTH");
  });
});
