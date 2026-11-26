// Log in with Instagram: the console's sign-in is the same Instagram business login the app already uses. Only the
// account this setter runs (brand.ts IG_HANDLE) gets in; the reward is a signed 90-day cookie. The basic-auth password
// still works (scripts, the reviewer login), it just isn't the front door anymore.

import { IG_HANDLE } from "./brand";
import * as db from "./db";
import { graph, hmacHex } from "./meta";
import type { Env } from "./setter";
import { APP_NAME, FAVICON, FONT, LOGO } from "./theme";

const COOKIE = "dms_session";
const TTL_S = 90 * 24 * 60 * 60;

const sign = (env: Env, exp: number) => hmacHex(`${env.META_APP_SECRET}:session`, `owner:${exp}`);

export async function sessionCookie(env: Env, now: number): Promise<string> {
  const exp = Math.floor(now / 1000) + TTL_S;
  return `${COOKIE}=${exp}.${await sign(env, exp)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_S}`;
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function hasSession(req: Request, env: Env, now = Date.now()): Promise<boolean> {
  const m = (req.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]{64})`));
  if (!m || !env.META_APP_SECRET || Number(m[1]) * 1000 < now) return false;
  const expected = await sign(env, Number(m[1]));
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0;
}

// The account this setter runs, as Instagram ids it (17841...). Cached by the sync; asked from the live token otherwise.
export async function ownerId(env: Env): Promise<string | null> {
  const cached = await db.getSetting(env.DB, "ig_account_id");
  if (cached) return cached;
  const token = await db.getSetting(env.DB, "ig_token");
  if (!token) return null;
  const me = await graph<{ user_id: string }>(`/me?fields=user_id`, { headers: { Authorization: `Bearer ${token}` } });
  await db.setSetting(env.DB, "ig_account_id", me.user_id);
  return me.user_id;
}

// On an iPhone, Instagram's app claims instagram.com/consent/ (its "Allow" screen), so the Instagram button bounces
// into the app mid-sign-in. Phones only get the password form (iCloud Keychain saves it, Face ID fills it).
export const isPhone = (req: Request | null) => /iPhone|iPad|iPod|Android/i.test(req?.headers.get("User-Agent") ?? "");

export function loginPage(error: string | null = null, req: Request | null = null): Response {
  const phone = isPhone(req);
  const ig = `<a class="btn" href="/auth/login">Log in with Instagram</a>`;
  const pw = `<form method="post" action="/login" class="pw">
<input name="username" autocomplete="username" value="${IG_HANDLE}" readonly aria-label="Account">
<input name="password" type="password" autocomplete="current-password" placeholder="Password" required aria-label="Password">
<button>Log in</button></form>`;
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Log in · ${APP_NAME}</title>${FONT}${FAVICON}
<style>
:root{--navy:#0B1F4B;--blue:#2F6BF2;--blue2:#1D4ED8;--bg:#F3F7FF;--card:#fff;--ink:#0B1F4B;--mut:#5F729B;--line:#E2E9F6;--line2:#C7D5EF}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:14px/1.45 "Inter Tight",Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{width:min(380px,calc(100vw - 32px));text-align:center;padding:36px 28px;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 30px rgba(11,31,75,.06)}
.logo{margin:0 auto 16px;display:grid;place-items:center}
.mark{width:48px;height:48px;border-radius:14px;background:var(--navy);color:#fff;display:grid;place-items:center;font-weight:700;font-size:24px}
h1{font-size:22px;line-height:28px;font-weight:700;letter-spacing:-.03em;margin:0 0 6px}p{color:var(--mut);margin:0 0 28px}
a.btn{display:flex;align-items:center;justify-content:center;gap:10px;height:44px;border-radius:8px;background:var(--blue);color:#fff;font-weight:700;text-decoration:none}
a.btn:hover{background:var(--blue2)}.err{color:#E03121;margin:0 0 18px}.alt{display:block;margin-top:22px;color:var(--mut);font-size:12px;text-decoration:none}
.pw{display:grid;gap:8px}.pw input{height:40px;box-sizing:border-box;border:1px solid var(--line2);border-radius:8px;background:#fff;color:var(--ink);padding:0 12px;font:inherit}
.pw input[readonly]{color:var(--mut)}.pw button{height:44px;border:0;border-radius:8px;background:var(--blue);color:#fff;font:700 14px/1 inherit;cursor:pointer}
.pw button:hover{background:var(--blue2)}
.or{display:flex;align-items:center;gap:14px;color:var(--mut);font-size:12px;font-weight:600;margin:20px 0}.or:before,.or:after{content:"";flex:1;height:1px;background:var(--line)}
.hint{color:var(--mut);font-size:12px;margin:10px 0 0}
</style></head><body><main>
<div class="logo" aria-hidden="true">${LOGO}</div>
<h1>${APP_NAME}</h1><p>${phone ? `Log in to ${APP_NAME}.` : `Log in with the Instagram account ${APP_NAME} runs on.`}</p>
${error ? `<p class="err">${error.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</p>` : ""}
${phone ? `${pw}<p class="hint">You stay logged in for 90 days. Your phone can save this and fill it with Face ID.</p>` : `<div class="ig">${ig}<div class="or">OR</div></div>${pw}`}
</main><script>/* iPads and "desktop site" phones look like a Mac to the server: drop the Instagram button on touch screens */
if (navigator.maxTouchPoints > 1) document.querySelectorAll(".ig").forEach((e) => e.remove());</script></body></html>`,
    { status: error ? 403 : 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}
