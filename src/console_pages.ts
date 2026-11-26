// My Profile, at the bottom of the sidebar (the connected Instagram account, light / dark, a link to Help, log out), and
// Help, reached from it (the questions that come up running DM automations on Instagram, a line or two each).

import { me, meAvatar, esc, page, type Role } from "./admin";
import type { Env } from "./setter";
import { icon } from "./theme";

export async function profilePage(env: Env, who: Role): Promise<Response> {
  const acct = await me(env);
  const account = acct?.username
    ? `<div class="acct">${meAvatar(acct)}<div><b>${esc(acct.name || acct.username)}</b><br><small>@${esc(acct.username)} · the Instagram account AtlasChat sends from</small></div></div>`
    : `<div class="acct">${meAvatar(null)}<div><b>No Instagram account connected</b><br><small>Connect one to start receiving DMs and comments.</small></div></div>`;
  return page(
    "Profile",
    `<div class="card"><div class="ph"><div><h2>Instagram account</h2></div>${who === "admin" ? `<a href="/auth/start">${acct?.username ? "Reconnect" : "Connect Instagram"}</a>` : ""}</div>${account}</div>
<div class="card"><div class="ph"><div><h2>Appearance</h2><p>Saved in this browser.</p></div></div>
<div class="seg" role="group" aria-label="Theme"><button type="button" data-theme-btn="" onclick="setTheme('')">Match system</button><button type="button" data-theme-btn="light" onclick="setTheme('light')">Light</button><button type="button" data-theme-btn="dark" onclick="setTheme('dark')">Dark</button></div></div>
<div class="card"><div class="ph"><div><h2>Help and session</h2><p>${who === "admin" ? "You're signed in as the owner." : "You're signed in with the reviewer login: test threads only."}</p></div></div>
<a class="li" href="/admin/help" style="margin:0 -12px">${icon("help", 20, 1.8)}<div class="grow"><div class="t">Help</div><div class="s">Common questions about DMs and automations</div></div>${icon("chevron")}</a>
<a class="li" href="/logout" style="margin:0 -12px">${icon("logout", 20, 1.8)}<div class="grow"><div class="t">Log out</div></div></a></div>`,
    who,
    env,
  );
}

const HELP: [q: string, a: string][] = [
  [
    "Why didn't a DM send?",
    "Instagram only lets automations message someone within 24 hours of their last message, comment or button tap. After that the window is closed until they write again. You can still reply by hand from the Instagram app, which has no limit.",
  ],
  [
    "Why does Opened look low?",
    "Opened counts read receipts, and Instagram only sends those for people who share them. Treat it as a floor: at least this many people opened it.",
  ],
  ["Why can't I see my buttons on desktop?", "Instagram draws buttons and quick replies in its phone app only. On instagram.com the message shows as plain text. Test automations from a phone."],
  [
    "How do I test an automation without touching its stats?",
    "Open it, press Test, and DM the 3-digit code to your account from another Instagram account. It runs the version on your screen, as many times as you like, on a hidden copy.",
  ],
  [
    "What do the Home numbers count?",
    "Messages received leaves out button taps. Automation reach is people who got an automation DM, not messages. Reply rate is the share of them who wrote back afterward. Click-through rate is the share who tapped any button or link. The arrows compare with the same number of days just before the range.",
  ],
  ["Can I DM new followers?", "Not through Instagram's API: it has no follow event. Comment keywords, story replies, DM keywords and the welcome message are the triggers that exist."],
  [
    "A comment got no DM. What happened?",
    "Each person gets one DM per automation, so a second comment is skipped. Instagram also caps private replies per hour: past the cap they wait in a queue and go out as room opens. Failures show under Delivery problems on Home.",
  ],
  ["Where did the AI switch go?", "The AI setter has its own page now. Turn it on or off there, per account, or from any thread in the Inbox for just that conversation."],
];

export async function helpPage(env: Env, who: Role): Promise<Response> {
  return page("Help", `<div class="card">${HELP.map(([q, a]) => `<div class="qa"><h3>${q}</h3><p>${a}</p></div>`).join("")}</div>`, who, env);
}
