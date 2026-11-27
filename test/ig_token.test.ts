import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeD1 } from "./d1shim";
import * as db from "../src/db";
import { normalizeToken } from "../src/ig_token";
import worker from "../src/index";
import { getConfig } from "../src/settings";
import type { Env } from "../src/setter";

const SECRET = "IGAA_test_token_DoNotLeak_9f3c2a";
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function makeEnv(): Env {
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
  };
}

type Mode = "ok" | "down" | "reject" | "other" | "leak";
let mode: Mode = "ok";
const calls: string[] = [];

beforeEach(() => {
  mode = "ok";
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      if (mode === "down") throw new TypeError("network down");
      if (mode === "reject") return Response.json({ error: { message: `Invalid ${SECRET}`, code: 190 } }, { status: 400 });
      if (mode === "other" && String(url).includes("/me?")) return Response.json({ username: "someone.else", name: "Other", profile_picture_url: "https://cdn.example/a.jpg" });
      if (mode === "leak" && String(url).includes("/me?")) return Response.json({ username: "yourhandle", name: SECRET, profile_picture_url: `https://cdn.example/${SECRET}.jpg` });
      if (String(url).includes("/me?")) return Response.json({ username: "yourhandle", name: "Sam", profile_picture_url: "https://cdn.example/a.jpg" });
      return Response.json({ success: true });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const auth = (pw: string) => ({ Authorization: `Basic ${btoa(`owner:${pw}`)}` });
const postToken = (pw: string, form: Record<string, string>, origin = "https://x", headers: Record<string, string> = {}) =>
  new Request(`${origin}/admin/settings/instagram`, { method: "POST", body: new URLSearchParams(form), headers: { ...auth(pw), ...headers } });
const getSettings = (pw: string, query = "", origin = "https://x") => new Request(`${origin}/admin/settings${query}`, { headers: auth(pw) });

async function htmlOf(env: Env, query = ""): Promise<string> {
  const res = await worker.fetch(getSettings("pw", query), env, ctx);
  expect(res.status).toBe(200);
  return res.text();
}

describe("instagram access token on Settings", () => {
  it("rejects a reviewer and an anonymous session", async () => {
    const env = makeEnv();
    expect((await worker.fetch(getSettings("rv"), env, ctx)).status).toBe(403);
    const reviewPost = await worker.fetch(postToken("rv", { intent: "save", ig_access_token: SECRET }), env, ctx);
    expect(reviewPost.status).toBe(403);
    expect(await reviewPost.text()).not.toContain(SECRET);
    expect(await db.getSetting(env.DB, "ig_token")).toBeNull();

    const anonGet = await worker.fetch(new Request("https://x/admin/settings"), env, ctx);
    expect(anonGet.status).toBe(302);
    expect(anonGet.headers.get("Location")).toBe("https://x/login");
    const anonPost = await worker.fetch(
      new Request("https://x/admin/settings/instagram", { method: "POST", body: new URLSearchParams({ intent: "save", ig_access_token: SECRET }) }),
      env,
      ctx,
    );
    expect(anonPost.status).toBe(401);
    expect(await anonPost.text()).not.toContain(SECRET);
    expect(await db.getSetting(env.DB, "ig_token")).toBeNull();
  });

  it("refuses a cross-origin post and leaves the stored token alone", async () => {
    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", "already-saved-token-value");
    const res = await worker.fetch(postToken("pw", { intent: "save", ig_access_token: SECRET }, "https://x", { Origin: "https://evil.example" }), env, ctx);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(SECRET);
    expect(await db.getSetting(env.DB, "ig_token")).toBe("already-saved-token-value");
  });

  it("saves a pasted token into the same D1 rows the rest of the app reads, and never renders it", async () => {
    const env = makeEnv();
    const res = await worker.fetch(postToken("pw", { intent: "save", ig_access_token: `  Bearer ${SECRET}  ` }, "https://x", { Origin: "https://x" }), env, ctx);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("https://x/admin/settings?ig=connected");
    expect(res.headers.get("Location")).not.toContain(SECRET);
    expect(await db.getSetting(env.DB, "ig_token")).toBe(SECRET);
    const at = Number(await db.getSetting(env.DB, "ig_token_at"));
    expect(at).toBeGreaterThan(Date.now() - 60_000);
    const profile = JSON.parse((await db.getSetting(env.DB, "ig_profile")) ?? "null") as { username: string };
    expect(profile.username).toBe("yourhandle");
    expect(calls.some((u) => u.includes("/me?fields=username"))).toBe(true);
    expect(calls.some((u) => u.includes("/subscribed_apps"))).toBe(true);
    expect(calls.some((u) => u.includes(SECRET) || u.includes("graph.facebook.com"))).toBe(false);

    const html = await htmlOf(env, "?ig=connected");
    expect(html).not.toContain(SECRET);
    expect(html).toContain("Connected as @yourhandle");
    expect(html).toContain("Token saved. Instagram confirmed the connection.");
    expect(html).toContain('href="/auth/start"');
    expect(html).toContain("Save token");
    expect(html).toContain("Verify connection");
    expect(html).toContain("Remove token");
    expect(html).toContain("#0B1F4B");
    const input = html.match(/<input[^>]*name="ig_access_token"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('type="password"');
    expect(input).toContain('autocomplete="off"');
    expect(input).toContain('spellcheck="false"');
    expect(input).not.toContain("value=");
    expect(input).not.toContain(SECRET);
  });

  it("does not leak the token when Instagram rejects it or the network fails", async () => {
    const env = makeEnv();
    mode = "reject";
    const rejected = await worker.fetch(postToken("pw", { intent: "save", ig_access_token: SECRET }), env, ctx);
    expect(rejected.headers.get("Location")).toBe("https://x/admin/settings?ig=rejected");
    expect(await db.getSetting(env.DB, "ig_token")).toBe(SECRET);
    const html = await htmlOf(env, "?ig=rejected");
    expect(html).toContain("Instagram did not accept it.");
    expect(html).toContain("Token saved");
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("Invalid IGAA");

    mode = "down";
    const again = await worker.fetch(postToken("pw", { intent: "verify" }), env, ctx);
    expect(again.headers.get("Location")).toBe("https://x/admin/settings?ig=verify_fail");
    const fail = await htmlOf(env, "?ig=verify_fail");
    expect(fail).toContain("Instagram could not be reached.");
    expect(fail).not.toContain(SECRET);
    expect(fail).toContain("Token saved");
  });

  it("skips the live check on localhost and still saves the token", async () => {
    const env = makeEnv();
    mode = "down";
    const res = await worker.fetch(postToken("pw", { intent: "save", ig_access_token: SECRET }, "http://127.0.0.1:8791"), env, ctx);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("http://127.0.0.1:8791/admin/settings?ig=preview");
    expect(calls).toEqual([]);
    expect(await db.getSetting(env.DB, "ig_token")).toBe(SECRET);
    const page = await worker.fetch(getSettings("pw", "?ig=preview", "http://127.0.0.1:8791"), env, ctx);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Preview mode skips the live Instagram check.");
    expect(html).toContain("Token saved");
    expect(html).not.toContain(SECRET);
  });

  it("removes the token and keeps the owner account id", async () => {
    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", SECRET);
    await db.setSetting(env.DB, "ig_token_at", "1");
    await db.setSetting(env.DB, "ig_user_id", "33900000000000001");
    await db.setSetting(env.DB, "ig_profile", JSON.stringify({ username: "yourhandle", name: "Sam", pic: null, at: Date.now() }));
    await db.setSetting(env.DB, "ig_account_id", "17840000000000001");
    const res = await worker.fetch(postToken("pw", { intent: "remove" }), env, ctx);
    expect(res.headers.get("Location")).toBe("https://x/admin/settings?ig=removed");
    expect(await db.getSetting(env.DB, "ig_token")).toBeNull();
    expect(await db.getSetting(env.DB, "ig_token_at")).toBeNull();
    expect(await db.getSetting(env.DB, "ig_user_id")).toBeNull();
    expect(await db.getSetting(env.DB, "ig_profile")).toBeNull();
    expect(await db.getSetting(env.DB, "ig_account_id")).toBe("17840000000000001");
    const html = await htmlOf(env, "?ig=removed");
    expect(html).toContain("Not connected");
    expect(html).toContain("Token removed. Instagram is disconnected.");
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("Connected as @yourhandle");
  });

  it("leaves a stored token in place when the paste is empty or not a token, and a normal Settings save does not clear it", async () => {
    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", SECRET);
    await db.setSetting(env.DB, "ig_token_at", "42");
    const empty = await worker.fetch(postToken("pw", { intent: "save", ig_access_token: "   " }), env, ctx);
    expect(empty.headers.get("Location")).toBe("https://x/admin/settings?ig=empty");
    const bad = await worker.fetch(postToken("pw", { intent: "save", ig_access_token: "short <token>" }), env, ctx);
    expect(bad.headers.get("Location")).toBe("https://x/admin/settings?ig=invalid");
    expect(await db.getSetting(env.DB, "ig_token")).toBe(SECRET);
    const general = await worker.fetch(
      new Request("https://x/admin/settings", {
        method: "POST",
        body: new URLSearchParams({ section: "general", skool_link: "https://example.com/kept" }),
        headers: auth("pw"),
      }),
      env,
      ctx,
    );
    expect(general.headers.get("Location")).toBe("https://x/admin/settings?saved=1");
    expect(await db.getSetting(env.DB, "ig_token")).toBe(SECRET);
    expect((await getConfig(env)).skool_link).toBe("https://example.com/kept");
    const html = await htmlOf(env);
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("<script>alert(1)</script>");
    const poked = await htmlOf(env, "?ig=%3Cscript%3Ealert(1)%3C/script%3E");
    expect(poked).not.toContain("alert(1)");
    expect(poked).not.toContain(SECRET);
  });

  it("does not keep a token for a different Instagram account, and does not replace one already saved", async () => {
    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", "already-saved-token-value");
    mode = "other";
    const res = await worker.fetch(postToken("pw", { intent: "save", ig_access_token: SECRET }, "https://x", { Origin: "https://x" }), env, ctx);
    expect(res.headers.get("Location")).toBe("https://x/admin/settings?ig=wrong_account");
    expect(await db.getSetting(env.DB, "ig_token")).toBe("already-saved-token-value");
    expect(calls.some((u) => u.includes("/subscribed_apps"))).toBe(false);
    const html = await htmlOf(env, "?ig=wrong_account");
    expect(html).toContain("different Instagram account");
    expect(html).not.toContain(SECRET);
  });

  it("drops a saved token that verifies as a different account, and never stores the token in the profile", async () => {
    const env = makeEnv();
    await db.setSetting(env.DB, "ig_token", SECRET);
    await db.setSetting(env.DB, "ig_account_id", "17840000000000001");
    mode = "other";
    const res = await worker.fetch(postToken("pw", { intent: "verify" }, "https://x", { Origin: "https://x" }), env, ctx);
    expect(res.headers.get("Location")).toBe("https://x/admin/settings?ig=wrong_account");
    expect(await db.getSetting(env.DB, "ig_token")).toBeNull();
    expect(await db.getSetting(env.DB, "ig_account_id")).toBe("17840000000000001");

    mode = "leak";
    const saved = await worker.fetch(postToken("pw", { intent: "save", ig_access_token: SECRET }, "https://x", { Origin: "https://x" }), env, ctx);
    expect(saved.headers.get("Location")).toBe("https://x/admin/settings?ig=connected");
    const profile = await db.getSetting(env.DB, "ig_profile");
    expect(profile).toContain("yourhandle");
    expect(profile).not.toContain(SECRET);
    const html = await htmlOf(env, "?ig=connected");
    expect(html).toContain("Connected as @yourhandle");
    expect(html).not.toContain(SECRET);
  });

  it("accepts a long-lived token shape and rejects anything else", () => {
    expect(normalizeToken(`  Bearer ${SECRET} `)).toBe(SECRET);
    expect(normalizeToken("short")).toBeNull();
    expect(normalizeToken("has a space in the middle of it")).toBeNull();
    expect(normalizeToken(`${SECRET}<script>`)).toBeNull();
    expect(normalizeToken("")).toBeNull();
  });
});
