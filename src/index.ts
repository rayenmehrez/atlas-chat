import { IG_HANDLE } from "./brand";
import { clearCookie, isPhone, loginPage, ownerId, sessionCookie } from "./session";
import { handleEcho } from "./autonomy";
import { afterInbound } from "./fastpath";
import { automationsPage, handleAdminPost, role } from "./admin";
import { drainComments, handleComment, lockNextPost } from "./comments";
import { syncComments } from "./comment_sync";
import { checkHealth, cronStep, logError, webhookSeen } from "./health";
import { flowsAdminPost, flowsPage } from "./admin_flows";
import { consoleRoute } from "./dashboard";
import { getLead, getSetting, recordInbound, setSetting } from "./db";
import { flowClick, flowSignals, handleInboundFlow, handlePostback, handleRead, parsePostbacks, parseReads, runDueFlows } from "./flows";
import { handleClick } from "./links";
import { getSubscriber, parseInbound } from "./manychat";
import { authorizeUrl, exchangeCode, graph, fetchProfile, parseComments, parseMessageUpdates, parseParts, parseReplies, parseSignedRequest, parseWebhook, subscribe, verifySignature } from "./meta";
import { applyUpdate, mediaRoute, saveParts, saveReplyTo } from "./attachments";
import { legalPage } from "./pages";
import { saveProfile } from "./profiles";
import { withSettings } from "./settings";
import { APP_NAME, FAVICON, FAVICON_SVG } from "./theme";
import { syncJoins } from "./joins";
import { syncRoster } from "./roster";
import { refreshMoves } from "./moves";
import { refreshCommunity } from "./community";
import { learnFromHandoffs } from "./learn";
import { runSendJobs, tick, type Env, type SendJob } from "./setter";
import { ping } from "./live";

export { LiveHub } from "./live";

async function handleMeta(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET") {
    // Webhook verification handshake from the App Dashboard.
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === env.META_VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("forbidden", { status: 403 });
  }
  const raw = await req.text();
  if (!(await verifySignature(env.META_APP_SECRET, raw, req.headers.get("X-Hub-Signature-256")))) {
    return new Response("bad signature", { status: 401 });
  }
  await webhookSeen(env.DB, Date.now()); // so a silent webhook can be noticed (src/health.ts)
  const token = await getSetting(env.DB, "ig_token");
  const payload = JSON.parse(raw);
  for (const c of parseComments(payload)) await handleComment(env.DB, token, env.SKOOL_LINK, c, Date.now());
  const signals = flowSignals(payload);
  const touched = new Set<string>();
  for (const ev of parseWebhook(payload)) {
    touched.add(ev.lead_id);
    if (ev.kind === "echo") {
      await handleEcho(env.DB, ev);
      continue;
    }
    const known = await getLead(env.DB, ev.lead_id);
    const lookup = !known?.username && token;
    const profile = lookup ? await fetchProfile(token, ev.lead_id) : { username: known?.username ?? null, name: null, pic: null };
    const fresh = await recordInbound(env.DB, { subscriber_id: ev.lead_id, username: profile.username, first_name: profile.name, text: ev.text, mid: ev.mid }, ev.at);
    if (lookup) await saveProfile(env.DB, ev.lead_id, profile, Date.now());
    if (!fresh) continue;
    // Keyword / story / welcome flows answer instantly; anything they don't cover waits for the AI
    // (autopilot's fast path stands down once a flow reply is the thread's latest message).
    if (token) await handleInboundFlow(env, token, ev, signals.get(ev.mid), !known, Date.now()).catch((e) => logError(env.DB, "DM flow", `${ev.lead_id} ${ev.mid}`, e));
    ctx.waitUntil(afterInbound(env, ev));
  }
  if (token) for (const pb of parsePostbacks(payload)) await handlePostback(env, token, pb, Date.now());
  // Structure for the Inbox (images, shares, stories...) and reactions / edits / unsends on messages we have.
  for (const [mid, parts] of parseParts(payload)) await saveParts(env.DB, mid, parts);
  for (const [mid, to] of parseReplies(payload)) await saveReplyTo(env.DB, mid, to);
  for (const u of parseMessageUpdates(payload)) await applyUpdate(env.DB, u, Date.now());
  for (const pb of parsePostbacks(payload)) touched.add(pb.lead_id);
  ctx.waitUntil(Promise.all([...touched].map((lead) => ping(env, lead)))); // open Inbox tabs update now
  // Read receipts: the Opened count on Send Message cards.
  for (const r of parseReads(payload)) await handleRead(env.DB, r);
  return new Response("ok");
}

const STATE_COOKIE = "dms_oauth";
// Every callback answer drops the one-time state cookie.
function withCleared(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.append("Set-Cookie", `${STATE_COOKIE}=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return out;
}

async function handleAuth(req: Request, env: Env, pathname: string): Promise<Response> {
  const url = new URL(req.url);
  const redirectUri = `${url.origin}/auth/callback`;
  if (pathname === "/auth/start" || pathname === "/auth/login") {
    // /auth/start reconnects the account (admins only); /auth/login is the console's sign-in, open to anyone,
    // since the callback only lets the account this setter runs through.
    if (pathname === "/auth/start" && !(await role(req, env))) return Response.redirect(`${url.origin}/login`, 302);
    // A phone would bounce into Instagram's app at the consent screen: send it to the password form instead.
    if (pathname === "/auth/login" && isPhone(req)) return Response.redirect(`${url.origin}/login`, 302);
    // The state lives in this browser's own short-lived cookie: two sign-ins (phone + laptop) never trip each other.
    const state = `${pathname === "/auth/login" ? "login:" : ""}${crypto.randomUUID()}`;
    return new Response(null, {
      status: 302,
      headers: { Location: authorizeUrl(env.META_IG_APP_ID, redirectUri, state), "Set-Cookie": `${STATE_COOKIE}=${state}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=900` },
    });
  }
  // /auth/callback
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const expected = (req.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`))?.[1];
  if (!code || !state || state !== expected) {
    const why = url.searchParams.get("error_description") ?? "That sign-in expired or was opened in another browser. Try again here.";
    return withCleared(loginPage(why, req));
  }
  const login = state.startsWith("login:");
  try {
    const { token, userId } = await exchangeCode(env.META_IG_APP_ID, env.META_APP_SECRET, redirectUri, code.replace(/#_$/, ""));
    if (login) {
      // Compare Instagram account ids from /me: OAuth's user_id is app-scoped and arrives as a lossy JSON number.
      const owner = await ownerId(env).catch(() => null);
      const me = await graph<{ user_id: string; username?: string }>(`/me?fields=user_id,username`, { headers: { Authorization: `Bearer ${token}` } });
      const who = me.user_id;
      if (owner && who !== owner) return withCleared(loginPage("That Instagram account isn't the one this setter runs.", req));
      // The very first sign-in on a fresh install claims it, so only the account it was set up for (brand.ts) may.
      if (!owner && (me.username ?? "").toLowerCase() !== IG_HANDLE.toLowerCase()) {
        return withCleared(loginPage(`This ${APP_NAME} is set up for @${IG_HANDLE}. Log in with that Instagram account.`, req));
      }
      await setSetting(env.DB, "ig_token", token); // a fresh 60-day token is a free bonus of logging in
      await setSetting(env.DB, "ig_token_at", String(Date.now()));
      if (!owner) {
        // ...and claiming it is connecting it: the same two steps /auth/start takes, so the first button a new owner
        // sees is enough and their DMs and comments start arriving.
        await setSetting(env.DB, "ig_account_id", who);
        await setSetting(env.DB, "ig_user_id", userId);
        await subscribe(token);
      }
      const ok = new Response(null, { status: 303, headers: { Location: `${url.origin}/admin/dashboard`, "Set-Cookie": await sessionCookie(env, Date.now()) } });
      return withCleared(ok);
    }
    const primary = await getSetting(env.DB, "ig_user_id");
    if (primary && primary !== userId) {
      // A second account (Meta's App Review tester) is shown in /admin but never replaces the live one.
      await setSetting(env.DB, "review_ig_token", token);
      return Response.redirect(`${url.origin}/admin`, 303);
    }
    await setSetting(env.DB, "ig_token", token);
    await setSetting(env.DB, "ig_token_at", String(Date.now()));
    await setSetting(env.DB, "ig_user_id", userId);
    await subscribe(token);
  } catch (e) {
    console.error("instagram login/connect failed:", e);
    return withCleared(loginPage(`Instagram didn't finish the sign-in (${String(e).slice(0, 120)}). Try again.`, req));
  }
  return Response.redirect(`${url.origin}/admin`, 303);
}

// Meta calls these when the account removes the app or asks for its data to be deleted: drop the Instagram connection.
async function handleRevoke(req: Request, env: Env, pathname: string): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const who = await parseSignedRequest(env.META_APP_SECRET, form ? String(form.get("signed_request") ?? "") : null);
  if (!who) return new Response("bad signed_request", { status: 400 });
  await env.DB.prepare(`DELETE FROM settings WHERE key IN ('ig_token', 'ig_token_at', 'ig_user_id')`).run();
  if (pathname === "/deauthorize") return new Response("ok");
  const code = crypto.randomUUID();
  return Response.json({ url: `${new URL(req.url).origin}/data-deletion?code=${code}`, confirmation_code: code });
}

// A thrown error (D1 busy during a big import, an API hiccup) must never become Cloudflare's 1101 page: the console
// gets a page that retries itself, everything else a 503 (Meta retries webhooks on a non-2xx).
async function guarded(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    return await route(req, env, ctx);
  } catch (e) {
    const { pathname } = new URL(req.url);
    await logError(env.DB, "request", `${req.method} ${pathname}`, e);
    if (req.method === "GET" && pathname.startsWith("/admin")) {
      return new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="3">
<title>One sec</title>${FAVICON}<body style="margin:0;display:grid;place-items:center;height:100vh;background:#000;color:#a8a8a8;font:15px -apple-system,system-ui,sans-serif">Busy for a second, reloading…</body>`,
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "3" } },
      );
    }
    return new Response("temporarily unavailable", { status: 503, headers: { "Retry-After": "5" } });
  }
}

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  {
    const { pathname } = new URL(req.url);

    if (pathname === "/meta") return handleMeta(req, await withSettings(env), ctx);
    const link = pathname.match(/^\/l\/([A-Za-z0-9]+)$/);
    if (link) return handleClick(req, env, link[1], Date.now());
    if (pathname === "/auth/start" || pathname === "/auth/login" || pathname === "/auth/callback") return handleAuth(req, env, pathname);
    if (pathname === "/login" && req.method === "POST") {
      // The password form: same 90-day cookie as Instagram login, so a phone signs in once.
      const pw = String((await req.formData().catch(() => null))?.get("password") ?? "");
      if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) return loginPage("Wrong password.", req);
      return new Response(null, { status: 303, headers: { Location: `${new URL(req.url).origin}/admin/dashboard`, "Set-Cookie": await sessionCookie(env, Date.now()) } });
    }
    if (pathname === "/login") return (await role(req, env)) === "admin" ? Response.redirect(`${new URL(req.url).origin}/admin/dashboard`, 302) : loginPage(null, req);
    if (pathname === "/logout") return new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": clearCookie } });
    if ((pathname === "/deauthorize" || pathname === "/data-deletion") && req.method === "POST") return handleRevoke(req, env, pathname);
    const click = pathname.match(/^\/f\/(\d+)(?:\/([A-Za-z0-9_-]+))?$/);
    if (click) return flowClick(env, Number(click[1]), click[2] ?? null, Date.now());
    if (pathname === "/favicon.ico") return new Response(FAVICON_SVG, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
    if (pathname === "/privacy" || pathname === "/terms" || pathname === "/data-deletion") return legalPage(pathname);

    // Manychat External Request (Default Reply flow) -> one inbound DM.
    if (pathname === "/manychat" && req.method === "POST") {
      if (!env.INBOUND_SECRET || req.headers.get("X-Setter-Key") !== env.INBOUND_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const inbound = parseInbound(await req.json().catch(() => null));
      if (inbound) {
        // Key the lead by its Instagram id so it's the same thread Meta's webhooks and comments land on.
        const sub = await getSubscriber(env.MANYCHAT_API_KEY, inbound.subscriber_id).catch(() => null);
        await recordInbound(
          env.DB,
          {
            subscriber_id: sub?.ig_id ?? inbound.subscriber_id,
            username: inbound.username ?? sub?.ig_username ?? null,
            first_name: inbound.first_name ?? sub?.name ?? null,
            text: inbound.text,
            mc_id: inbound.subscriber_id,
          },
          Date.now(),
        );
      }
      return Response.json({ ok: true, recorded: Boolean(inbound) });
    }

    if (pathname.startsWith("/admin")) {
      const who = await role(req, env);
      // No credentials at all: the Instagram login page. Wrong password, or the "use the password" link: basic auth.
      if (!who && req.method === "GET" && !req.headers.get("Authorization") && pathname !== "/admin/password") {
        return Response.redirect(`${new URL(req.url).origin}/login`, 302);
      }
      if (!who) {
        return new Response("login required", { status: 401, headers: { "WWW-Authenticate": `Basic realm="${APP_NAME}"` } });
      }
      if (pathname === "/admin/password") return Response.redirect(`${new URL(req.url).origin}/admin/dashboard`, 302);
      if (pathname.startsWith("/admin/media/")) return mediaRoute(env.DB, req, pathname, who === "review");
      if (pathname === "/admin/live/ws") return env.LIVE ? env.LIVE.get(env.LIVE.idFromName("inbox")).fetch(req) : new Response("live updates off", { status: 501 });
      const e = await withSettings(env);
      if (pathname.startsWith("/admin/flows")) return req.method === "POST" ? flowsAdminPost(e, req, pathname, who) : flowsPage(e, req, pathname, who);
      if (pathname.startsWith("/admin/automations/") && req.method === "POST") return flowsAdminPost(e, req, pathname, who);
      const own = await consoleRoute(e, req, pathname, who);
      if (own) return own;
      if (req.method === "POST") return handleAdminPost(e, req, pathname, who);
      if (pathname === "/admin/automations") return automationsPage(e, req, who);
      return Response.redirect(new URL("/admin/dashboard", req.url).toString(), 302);
    }

    return new Response("ok");
  }
}

export default {
  fetch: guarded,

  async queue(batch: MessageBatch<SendJob>, env: Env): Promise<void> {
    await runSendJobs(await withSettings(env), batch.messages.map((m) => m.body));
    batch.ackAll();
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      withSettings(env).then((e) =>
        // Each step on its own: one failing never stops the rest, and five failures in a row text the owner.
        Promise.all([
          cronStep(e, "setter", Date.now(), () => tick(e, Date.now())),
          cronStep(e, "flow delays", Date.now(), () => runDueFlows(e, Date.now())),
          cronStep(e, "skool joins", Date.now(), () => syncJoins(e, Date.now())), // new Skool members, matched to their DM lead
          cronStep(e, "skool roster", Date.now(), () => syncRoster(e, Date.now())), // members + churned, so the setter never pitches a customer
          cronStep(e, "skool facts", Date.now(), () => refreshCommunity(e, Date.now())), // call times, size, activity, classroom
          cronStep(e, "learn", Date.now(), () => learnFromHandoffs(e, Date.now())), // The owner's own answers to handoffs become knowledge
          cronStep(e, "funnel moves", Date.now(), () => refreshMoves(e, Date.now())), // the funnel's furthest move per lead
          cronStep(e, "comment queue", Date.now(), async () => drainComments(e.DB, await getSetting(e.DB, "ig_token"), e.SKOOL_LINK, Date.now())),
          cronStep(e, "comment backfill", Date.now(), () => syncComments(e, Date.now())), // comments the webhook missed
          cronStep(e, "next post", Date.now(), async () => lockNextPost(e.DB, await getSetting(e.DB, "ig_token"), Date.now())), // a Next Post or Reel trigger finds its post
          cronStep(e, "health", Date.now(), () => checkHealth(e, Date.now())),
        ]),
      ),
    );
  },
} satisfies ExportedHandler<Env, SendJob>;
