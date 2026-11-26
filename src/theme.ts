// The console's look, the layout DM-automation tools have settled on: a gray canvas, a
// 215px sidebar that folds to a 64px icon rail, a 60px title bar, white panels and hairline rules, no shadows. The Inbox
// keeps Instagram's own web-DM look (IG's blue-purple bubbles, the system font). Follows the system theme; My Profile
// overrides it per browser (localStorage).

const PATHS: Record<string, string> = {
  dashboard: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8.5 16.5v-4M12 16.5v-9M15.5 16.5v-6"/>',
  inbox: '<path d="M22 3 9.2 10.1"/><path d="M11.7 20.3 22 3H2l7.2 7.1z"/>',
  automations: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  send: '<path d="M22 3 9.2 10.1"/><path d="M11.7 20.3 22 3H2l7.2 7.1z"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 13v2M15 13v2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  click: '<path d="m4 4 7 17 2.5-7.5L21 11z"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 16 0v-3a2 2 0 0 0-4 0"/>',
  flag: '<path d="M4 22V4h13l-2 4 2 4H4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  star: '<path d="m12 2 3 7 7 .6-5.3 4.7L18.2 22 12 18.3 5.8 22l1.5-7.7L2 9.6 9 9z"/>',
  hourglass: '<path d="M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4"/>',
  megaphone: '<path d="M3 11v3l13 5V6zM16 9a3 3 0 0 1 0 6"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/><path d="M10 21v-6h4v6"/>',
  sparkles: '<path d="m11 4 1.8 4.7L17.5 10.5l-4.7 1.8L11 17l-1.8-4.7L4.5 10.5l4.7-1.8z"/><path d="M19 15v5M16.5 17.5h5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5A8.5 8.5 0 1 1 21 11.5z"/><path d="M8.5 10h7M8.5 13.5h4.5"/>',
  fold: '<path d="M4 5v14"/><path d="m13 7-5 5 5 5"/><path d="M8 12h12"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4"/><path d="M12 17.5h.01"/>',
  up: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
  down: '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  flow: '<rect x="3" y="9" width="6" height="6" rx="1.5"/><rect x="15" y="4" width="6" height="6" rx="1.5"/><rect x="15" y="14" width="6" height="6" rx="1.5"/><path d="M9 12h3M12 7v10M12 7h3M12 17h3"/>',
  shapes: '<path d="M12 3.5 8.5 9h7z"/><rect x="4" y="13" width="6.5" height="6.5" rx="1"/><circle cx="17" cy="16.2" r="3.3"/>',
};

export function icon(name: keyof typeof PATHS | string, size = 16, stroke = 2): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;
}

// Stage colors, one per brain.ts stage.
export const STAGE_COLOR: Record<string, string> = {
  opener: "#8e8e8e",
  lead: "#3797f0",
  qualify: "#6a5fe0",
  pitch: "#a35ad8",
  link_sent: "#f0a12e",
  joined: "#2fb85a",
  closed: "#8e8e8e",
};

// Atlas Pricing Quiz tokens. --bg / --canvas is the page, --card / --panel is what sits on it. --pri is --blue,
// deep enough for white button text (the blue on #F3F7FF clears 4.5:1 for links; --mut does too).
const ATLAS = `--navy:#0B1F4B;--night:#040B24;--blue:#2F6BF2;--blue2:#1D4ED8;--sky:#7DB4FF;--card:#FFFFFF;--ink:#0B1F4B;--ink2:#2E4373;--mut:#5F729B;--faint:#8D9BBA;--line:#E2E9F6;--line2:#C7D5EF;--soft:#F6F9FF;--ok:#0F9F6E;--warn:#B45309;--live:#E03121`;
const DARK = `${ATLAS};--navy:#E8EEF9;--blue:#7DB4FF;--blue2:#2F6BF2;--card:#0E1B3D;--ink:#F4F7FF;--ink2:#C7D5EF;--mut:#9AADC9;--faint:#7E91B3;--line:#1C335F;--line2:#2E4373;--soft:#13284F;--ok:#3DDC97;--warn:#F5B041;--live:#FF5A4F;
--bg:#07122E;--hover:#13284F;--sel:#17315F;--field:#0B1736;--elev:#0E1B3D;--canvas:#07122E;--panel:#0E1B3D;--navon:#17315F;--navhov:#13284F;--up:#3DDC97;--down:#FF7A72;--series2:#8D9BBA;
--btn2:#13284F;--track:#1C335F;--out:#2F6BF2;--brand:#2F6BF2;--pri:#7DB4FF;--link:#D6E6FF;--red:#FF5A4F;--green:#3DDC97;--amber:#F5B041;color-scheme:dark`;
const LIGHT = `${ATLAS};--bg:#F3F7FF;--hover:#F6F9FF;--sel:#EBF3FF;--field:#FFFFFF;--elev:#FFFFFF;--canvas:#F3F7FF;--panel:#FFFFFF;--navon:#EBF3FF;--navhov:#F6F9FF;--up:#0F9F6E;--down:#E03121;--series2:#8D9BBA;
--btn2:#F6F9FF;--track:#E2E9F6;--out:#2F6BF2;--brand:#2F6BF2;--pri:#2F6BF2;--link:#1D4ED8;--red:#E03121;--green:#0F9F6E;--amber:#B45309;color-scheme:light`;

const CHEV = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235F729B' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

// Rounded navy square with a white A. The rail, the login page and the favicon all use it.
export const APP_NAME = "AtlasChat";
export const LOGO = `<span class="mark">A</span>`;
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0B1F4B"/><text x="32" y="43" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="36" font-weight="700" fill="#fff">A</text></svg>`;
export const FAVICON = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}">`;
export const FONT = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&display=swap" rel="stylesheet">`;

export const HEAD = `${FONT}${FAVICON}<script>try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t;var n=localStorage.getItem("nav");if(n==="max")document.documentElement.classList.remove("nav-min");else document.documentElement.classList.add("nav-min")}catch(e){}
try{document.cookie="tz="+new Date().getTimezoneOffset()+";path=/;max-age=31536000;samesite=lax"}catch(e){}
function setTheme(t){var d=document.documentElement;if(t)d.dataset.theme=t;else delete d.dataset.theme;try{t?localStorage.setItem("theme",t):localStorage.removeItem("theme")}catch(e){}
document.querySelectorAll("[data-theme-btn]").forEach(function(b){b.setAttribute("aria-pressed",String((b.dataset.themeBtn||"")===(t||"")))})}
function flipTheme(){var d=document.documentElement;setTheme((d.dataset.theme?d.dataset.theme==="dark":matchMedia("(prefers-color-scheme: dark)").matches)?"light":"dark")}
function foldNav(b){var min=document.documentElement.classList.toggle("nav-min");try{localStorage.setItem("nav",min?"min":"max")}catch(e){}
b.setAttribute("aria-expanded",String(!min));b.setAttribute("aria-label",min?"Expand navigation":"Collapse navigation");b.title=min?"Expand":"Collapse"}
function info(){var b=document.querySelector(".ib");if(b)b.classList.toggle("swap")}
function grow(t){t.style.height="auto";t.style.height=Math.min(t.scrollHeight,160)+"px"}
function fmtTimes(root){var n=new Date();root.querySelectorAll("time[data-t]").forEach(function(el){var d=new Date(+el.dataset.t),o={hour:"numeric",minute:"2-digit"};
if(d.toDateString()!==n.toDateString()){if(n-d<6*864e5)o.weekday="short";else{o.month="short";o.day="numeric";if(d.getFullYear()!==n.getFullYear())o.year="numeric"}
if(el.hasAttribute("data-day"))o=o.weekday?{weekday:"long"}:{month:o.month,day:o.day,year:o.year}}
el.textContent=d.toLocaleString([],o)})}
document.addEventListener("DOMContentLoaded",function(){fmtTimes(document);var m=document.querySelector(".msgs");if(m)m.scrollTop=m.scrollHeight;
var f=document.querySelector(".fold button");if(f&&document.documentElement.classList.contains("nav-min")){f.setAttribute("aria-expanded","false");f.setAttribute("aria-label","Expand navigation");f.title="Expand"}
var th="";try{th=localStorage.getItem("theme")||""}catch(e){}document.querySelectorAll("[data-theme-btn]").forEach(function(b){b.setAttribute("aria-pressed",String((b.dataset.themeBtn||"")===th))})})</script>
<style>
:root{${LIGHT}}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}
:root[data-theme=dark]{${DARK}}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 "Inter Tight",Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;
  --rail:200px;--ease:cubic-bezier(.29,.01,0,1.04)}
html.nav-min body{--rail:60px}
a{color:var(--pri);text-decoration:none}
a:hover{opacity:.85}
svg{flex:none}
[hidden]{display:none!important}
::selection{background:color-mix(in srgb,var(--pri) 24%,transparent)}
:focus-visible{outline:2px solid var(--pri);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* ---------- icon rail: 60px, white, expands to labels. Icons stay centered when folded ---------- */
.side{position:fixed;top:0;bottom:0;left:0;width:var(--rail);background:var(--card);border-right:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden;z-index:5;transition:width .3s var(--ease)}
.brand{display:flex;align-items:center;justify-content:center;gap:10px;height:64px;padding:0;font-size:15px;font-weight:700;letter-spacing:-.03em;white-space:nowrap;flex:none;color:var(--ink);opacity:1}
html:not(.nav-min) .brand{justify-content:flex-start;padding:0 14px}
.brand:hover{opacity:1}
.mark{width:32px;height:32px;border-radius:10px;background:#0B1F4B;color:#fff;display:grid;place-items:center;font-weight:700;font-size:16px;line-height:1;letter-spacing:0}
.logo{width:32px;height:32px;display:grid;place-items:center;flex:none}
.side .who{display:flex;align-items:center;justify-content:center;gap:10px;height:52px;padding:0;white-space:nowrap;flex:none;color:var(--ink);font-size:13px;line-height:18px;min-width:0;opacity:1}
html:not(.nav-min) .side .who{justify-content:flex-start;padding:0 14px}
.side .who .av{width:32px;height:32px;font-size:13px}
.side .who .l{overflow:hidden;text-overflow:ellipsis;min-width:0}
.side .who small{display:block;color:var(--mut);font-size:12px;line-height:16px}
.side nav,.side .foot{display:flex;flex-direction:column;align-items:center;padding:8px 0;gap:4px;flex:none}
html:not(.nav-min) .side nav,html:not(.nav-min) .side .foot{align-items:stretch;padding:8px}
.side .foot{border-top:1px solid var(--line);margin-top:4px}
.nv{position:relative;display:flex;align-items:center;justify-content:center;gap:12px;width:40px;height:40px;padding:0;border-radius:10px;border:1.5px solid transparent;color:var(--ink2);font-size:14px;line-height:20px;white-space:nowrap;opacity:1;transition:background-color .15s,color .15s,border-color .15s}
html:not(.nav-min) .nv{width:auto;justify-content:flex-start;padding:0 10px}
.nv:hover{background:var(--soft);color:var(--ink);opacity:1}
.nv.on{background:#EBF3FF;color:var(--blue);border-color:var(--blue)}
:root[data-theme=dark] .nv.on{background:#17315F}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .nv.on{background:#17315F}}
.nv .av{width:28px;height:28px;font-size:12px}
.ndot{position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--blue);box-shadow:0 0 0 2px var(--card)}
button.nv{width:40px;margin:0;border:1.5px solid transparent;background:none;font:inherit;font-size:14px;line-height:20px;font-weight:400;text-align:left;cursor:pointer;color:var(--ink2)}
html:not(.nav-min) button.nv{width:auto}
.nv-help .q{width:22px;height:22px;border-radius:50%;border:1.5px solid currentColor;display:grid;place-items:center;font-size:13px;font-weight:700;line-height:1}
/* the light / dark toggle names the mode it switches to: moon + "Dark mode" in light, sun + "Light mode" in dark */
.th-d{display:contents}.th-l{display:none}
:root[data-theme=dark] .th-d{display:none}:root[data-theme=dark] .th-l{display:contents}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .th-d{display:none}:root:not([data-theme=light]) .th-l{display:contents}}
.side .l{transition:opacity .2s}
html.nav-min .side .l{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.side .gap{flex:1;min-height:8px}
.fold{height:48px;display:flex;align-items:center;justify-content:center;padding:0;flex:none}
html:not(.nav-min) .fold{justify-content:flex-start;padding:0 14px}
.fold button{display:grid;place-items:center;width:36px;height:36px;margin:0;padding:0;border-radius:10px;border:0;background:none;color:var(--ink2);transition:background-color .15s}
.fold button:hover{background:var(--navhov)}
.fold svg{transition:transform .3s var(--ease)}
html.nav-min .fold svg{transform:scaleX(-1)}

/* ---------- title bar + content ---------- */
main{margin-left:var(--rail);min-height:100vh;transition:margin-left .3s var(--ease)}
.tb{position:sticky;top:0;z-index:4;display:flex;align-items:center;justify-content:space-between;gap:16px;height:56px;padding:0 28px;background:var(--card);border-bottom:1px solid var(--line)}
.tb h1{font-size:20px;line-height:56px;font-weight:700;letter-spacing:-.02em;white-space:nowrap;color:var(--ink)}
.tb-r{display:flex;align-items:center;gap:8px;min-width:0}
.tb-r button{margin:0}
.tb .me{display:none;opacity:1}.tb .me .av{width:30px;height:30px;font-size:12px}
.p-inbox .tb,main:has(.fe) .tb{display:none}
.wrap{max-width:1280px;margin:0 auto;padding:28px 40px 64px}
.m-dashboard .wrap{max-width:960px;padding:36px 28px 72px}
.m-contacts .wrap,.m-automations .wrap:has(.au){max-width:none;padding:0}
.m-settings .wrap,.m-profile .wrap,.m-help .wrap{max-width:760px}
.m-ai .wrap{max-width:1000px}
.m-inbox .wrap{max-width:none;padding:0}
h1{font-size:24px;line-height:30px;font-weight:700;margin:0;letter-spacing:-.01em}
h2{font-size:16px;line-height:20px;font-weight:600;margin:0}
.sub{color:var(--mut);margin:4px 0 0}
@media (prefers-reduced-motion:reduce){.side,main,.fold svg,.side .l,.nv{transition:none}}

/* ---------- shared bits ---------- */
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 24px;margin:0 0 16px;box-shadow:0 1px 2px rgba(11,31,75,.04)}
.card>b:first-child,.card h2{font-size:16px;font-weight:600;margin:0}
.head{margin-bottom:8px}.head small{color:var(--mut)}
.tag{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--amber);color:#000}.tag.flag{background:var(--red);color:#fff}
.thread{display:flex;flex-direction:column;gap:2px;margin:10px 0}
.note{color:var(--mut);font-size:12px;line-height:16px;margin-bottom:8px}
textarea,input,select{width:100%;font:inherit;font-size:14px;line-height:18px;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--field);color:var(--ink);margin-bottom:10px}
textarea:focus,input:focus,select:focus{outline:none;border-color:var(--mut)}
select{appearance:none;-webkit-appearance:none;background-image:${CHEV};background-repeat:no-repeat;background-position:right 10px center;padding-right:30px;cursor:pointer}
input[type=checkbox]{width:auto}
button{font:inherit;font-size:14px;font-weight:700;line-height:18px;margin:8px 8px 0 0;padding:8px 16px;border-radius:8px;border:0;background:var(--blue);color:#fff;cursor:pointer}
button:hover{background:var(--blue2)}
button.ghost{background:var(--btn2);color:var(--ink)}
button.ghost:hover{filter:brightness(.95);background:var(--btn2)}
button:disabled{opacity:.5;cursor:default}
label{display:block;font-size:12px;font-weight:600;color:var(--mut);margin:6px 0 6px}
.row{display:flex;justify-content:space-between;gap:12px;align-items:center;border-top:1px solid var(--line);padding:14px 0}
.card>.row:first-of-type,.card>b+.row{border-top:0}
.off{opacity:.5}.st{font-size:12px;color:var(--mut);white-space:nowrap}.st.sent{color:var(--green)}.st.failed{color:var(--red)}
.acct{display:flex;gap:12px;align-items:center;padding:2px 0}.acct img{width:44px;height:44px;border-radius:50%}.acct small{color:var(--mut)}
.badge{display:inline-flex;align-items:center;border-radius:999px;color:#fff;font-size:11px;font-weight:600;padding:0 8px;line-height:18px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:600;color:var(--ink);background:var(--soft);line-height:16px}
.chip button{margin:0;padding:0 0 0 2px;background:none;color:var(--mut);box-shadow:none;font-size:15px;line-height:1;font-weight:400}
.chip button:hover{background:none;color:var(--ink)}
.empty{padding:16px 0;color:var(--mut)}

/* avatars: real Instagram pictures sit on top of the initial */
.av{position:relative;overflow:hidden;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:600;font-size:17px;flex:none}
.av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.av.lg{width:96px;height:96px;font-size:36px}
.av.xs{width:28px;height:28px;font-size:12px}
.av.grp{background:var(--soft);color:var(--ink)}.av.grp svg{width:50%;height:50%}

/* ---------- metrics: the KPI band, panels, charts, tables ---------- */
.meta{display:flex;flex-wrap:wrap;gap:4px 20px;align-items:baseline;margin:0 0 16px;color:var(--mut);font-size:14px;line-height:20px}
.meta b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
.meta .cmp{margin-left:auto;font-size:13px}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;background:var(--panel);overflow:hidden}
.seg a,.seg button{margin:0;padding:7px 12px;font-size:13px;line-height:18px;font-weight:600;color:var(--mut);background:none;box-shadow:none;border-radius:0;opacity:1;border-left:1px solid var(--line);white-space:nowrap}
.seg a:first-child,.seg button:first-child{border-left:0}
.seg a:hover,.seg button:hover{color:var(--ink);background:var(--hover);opacity:1}
.seg a.on,.seg button[aria-pressed=true]{background:var(--navon);color:var(--ink)}
.seg .n{display:none}
.stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;background:transparent;border:0;margin:0 0 16px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px 18px;min-width:0;box-shadow:0 1px 2px rgba(11,31,75,.04)}
.stat .lbl{color:var(--mut);font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stat b{display:block;font-size:26px;line-height:32px;font-weight:600;margin:6px 0 4px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stat small{display:block;color:var(--mut);font-size:12px;line-height:16px}.stat small svg{vertical-align:-2px;margin-right:2px}
.stat small.up{color:var(--up)}.stat small.down{color:var(--down)}
.cols{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:16px;margin:0 0 16px}
.cols>.card{margin:0;min-width:0;display:flex;flex-direction:column}
.ph{display:flex;justify-content:space-between;align-items:baseline;gap:8px 16px;flex-wrap:wrap;margin:0 0 18px}
.ph h2{font-size:15px;line-height:20px}
.ph p{font-size:13px;color:var(--mut);margin:2px 0 0}
.ph>a{font-size:13px;font-weight:600;white-space:nowrap}
.lgd{display:flex;gap:18px;font-size:13px;color:var(--mut);white-space:nowrap}
.lgd i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
.lgd b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums;margin-left:4px}
.lc{flex:1;display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:minmax(220px,1fr) auto;gap:8px 10px;font-size:12px;line-height:12px;color:var(--mut);font-variant-numeric:tabular-nums}
.lc-y{display:flex;flex-direction:column;justify-content:space-between;text-align:right;margin:-6px 0}
.lc-plot{position:relative;touch-action:pan-y;cursor:crosshair;min-width:0}
.lc-plot svg{display:block;width:100%;height:100%;overflow:visible}
.lc-plot .gr{stroke:var(--line);stroke-width:1}
.lc-x{grid-column:2;display:flex;justify-content:space-between;white-space:nowrap}
.lc-guide{position:absolute;top:0;bottom:0;width:1px;background:var(--mut);pointer-events:none}
.lc-tip{position:absolute;top:8px;transform:translateX(-50%);background:var(--ink);color:var(--panel);border-radius:6px;padding:8px 10px;font-size:12px;line-height:18px;white-space:nowrap;pointer-events:none;z-index:2;box-shadow:0 4px 14px rgba(0,0,0,.18)}
.lc-tip b{display:block;font-weight:600}
.lc-tip span{display:flex;align-items:center;gap:6px}
.lc-tip i{width:8px;height:8px;border-radius:2px}
.lc-tip em{font-style:normal;margin-left:auto;padding-left:14px;font-weight:600}
.lc-none{position:absolute;inset:0;display:grid;place-items:center;color:var(--mut);font-size:13px;line-height:18px;text-align:center;padding:0 24px}
.fb{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;align-items:baseline;padding:12px 0;border-top:1px solid var(--line)}
.fb:first-of-type{border-top:0;padding-top:0}.fb:last-of-type{padding-bottom:0}
.fb-l{font-size:13px}
.fb-n{font-size:13px;color:var(--mut);font-variant-numeric:tabular-nums;text-align:right}.fb-n b{color:var(--ink);font-weight:600;margin-right:8px}
.fb-t{grid-column:1/-1;height:8px;border-radius:4px;background:var(--soft);overflow:hidden}
.fb-t i{display:block;height:100%;border-radius:4px;background:var(--pri)}
.fb.sec .fb-t i{background:var(--series2)}
.tbl{width:100%;border-collapse:collapse;font-size:13px;line-height:18px}
.tbl th{text-align:left;font-size:12px;font-weight:600;color:var(--mut);padding:0 12px 10px 0;white-space:nowrap;border-bottom:1px solid var(--line)}
.tbl td{padding:12px 12px 12px 0;border-bottom:1px solid var(--line);vertical-align:middle}
.tbl tr:last-child td{border-bottom:0;padding-bottom:0}
.tbl .r{text-align:right;font-variant-numeric:tabular-nums;padding-right:0;padding-left:12px;white-space:nowrap}
.tbl a.nm{display:block;color:var(--ink);font-weight:600;opacity:1}.tbl a.nm:hover{color:var(--pri)}
.tbl small{color:var(--mut);display:block;font-size:12px;line-height:16px;margin-top:2px}
.tbl td:first-child{max-width:0;width:100%}.tbl td:first-child>*{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.none{color:var(--mut);font-size:13px;line-height:20px;padding:8px 0}
.none a{font-weight:600}
.ch{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.ch p{color:var(--mut);margin:4px 0 0;font-size:13px}
.ch>a{font-weight:600;white-space:nowrap;font-size:13px}
.flush>.ch{padding-bottom:8px}.ch>div[style]{white-space:nowrap}
.big{font-size:16px;font-weight:600}.amber{color:var(--mut);font-size:13px}
.li{display:flex;align-items:center;gap:12px;padding:10px 12px;margin:0 -12px;border-radius:8px;color:inherit;opacity:1}
a.li:hover{background:var(--hover);opacity:1}
.li .grow{flex:1;min-width:0}.li .grow div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.li .t{font-weight:600}.li .s{color:var(--mut);font-size:13px;margin-top:2px}
.li>svg{color:var(--mut)}
.ig{width:44px;height:44px;border-radius:50%;background:var(--soft);display:grid;place-items:center}
.foot-note{color:var(--mut);font-size:12px;margin:16px 0 0}
.pipe{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:20px;text-align:center}
.pipe .lbl{color:var(--mut);font-size:12px}.pipe .n{font-size:22px;line-height:28px;font-weight:600;margin:2px 0 8px;font-variant-numeric:tabular-nums}
.pipe .ic{display:none}
.pipe .pct{display:inline-block;padding:3px 10px;border-radius:999px;border:1px solid;font-size:12px;font-weight:600}
.aisw{display:flex;align-items:center;justify-content:space-between;gap:20px}
.aisw form{margin:0}
.aisw button{display:flex;align-items:center;gap:10px;margin:0;padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:var(--panel);box-shadow:none;color:var(--ink);white-space:nowrap}
.aisw button:hover{background:var(--hover)}
.aisw button:disabled{opacity:.55;cursor:default}.aisw button:disabled:hover{background:var(--panel)}

/* ---------- contacts: segments on the left, the table on a white panel ---------- */
.ct{display:grid;grid-template-columns:230px minmax(0,1fr);gap:0;align-items:stretch;min-height:calc(100vh - 56px)}
.ct.hide-side{grid-template-columns:minmax(0,1fr)}
.ct.hide-side .ct-side{display:none}
.ct-side{background:var(--bg);padding:20px 16px}
.ct-side h3{font-size:11px;line-height:16px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:18px 0 8px}
.ct-side h3:first-child{margin-top:0}
.ct-side a{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;margin:0 -4px;border-radius:8px;color:var(--ink2);font-size:13px;line-height:18px;opacity:1}
.ct-side a span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ct-side a:hover{background:var(--soft);opacity:1;color:var(--ink)}.ct-side a.on{background:var(--soft);color:var(--ink);font-weight:700}
.ct-side a span:last-child{color:var(--mut);font-variant-numeric:tabular-nums;font-weight:600}
.ct-main{background:var(--card);border-left:1px solid var(--line);padding:16px 24px 48px;min-width:0}
.ct-bar{display:flex;align-items:center;gap:12px;margin:0 0 8px;color:var(--mut);font-size:13px}
.ct-bar form{margin:0;flex:1;max-width:360px}
.ct-filter{margin:0;background:var(--card);color:var(--ink);border:1px solid var(--line2);border-radius:8px;padding:8px 14px;font-weight:600}
.ct-filter:hover{background:var(--soft)}
.ct-count{margin-left:auto;color:var(--mut);font-size:13px;white-space:nowrap}
.ct-count b{color:var(--ink);font-weight:700}
.ct-bar .srch{margin:0}
.ct-bar .srch input{background:var(--card);border:1px solid var(--line2);border-radius:8px;font-size:14px;padding:8px 12px 8px 36px}
.ct-bar .srch svg{left:12px;top:10px}
.ct-tbl{background:transparent;border:0;border-radius:0;overflow:hidden}
.ct-h,.ct-row{display:grid;grid-template-columns:minmax(0,2.4fr) 120px 150px;gap:16px;align-items:center;padding:12px 8px}
.stpill{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;width:fit-content;border:1px solid transparent}
.stpill.active{background:#E7F8F1;color:var(--ok)}
.stpill.paused{background:var(--soft);color:var(--mut);border-color:var(--line)}
.stpill.subscribed{background:#EBF3FF;color:var(--blue)}
.ct-h{font-size:12px;font-weight:600;color:var(--mut);padding:12px 20px;border-bottom:1px solid var(--line)}
.ct-row{color:var(--ink);opacity:1;border-top:1px solid var(--line);font-size:13px;line-height:18px}
.ct-h+.ct-row{border-top:0}
.ct-row:hover{background:var(--hover);opacity:1}
.ct-row .nm{display:flex;align-items:center;gap:12px;min-width:0}
.ct-row .nm .av{width:36px;height:36px;font-size:14px}
.ct-row .nm div{min-width:0}.ct-row .nm b,.ct-row .nm small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ct-row .nm b{font-weight:600}.ct-row small{color:var(--mut);font-size:12px;line-height:16px}
.ct-row .chips{flex-wrap:nowrap;overflow:hidden}.ct-row .chip{padding:2px 8px;font-weight:500;white-space:nowrap}
.ct-row .when{color:var(--mut);font-variant-numeric:tabular-nums;white-space:nowrap}
.ct-row .when small{display:block}
.ct-tbl .none{padding:28px 20px}
.ct .pager{padding:16px 0}

/* ---------- help ---------- */
.qa{border-top:1px solid var(--line);padding:14px 0}
.qa:first-of-type{border-top:0;padding-top:0}.qa:last-of-type{padding-bottom:0}
.qa h3{font-size:14px;line-height:20px;font-weight:600;margin:0 0 4px}
.qa p{margin:0;color:var(--mut);font-size:14px;line-height:21px;max-width:68ch}

/* ---------- inbox: list | thread | details ---------- */
.ib{display:grid;grid-template-columns:397px minmax(0,1fr) 340px;height:100vh;height:100dvh}
html:has(.ib),body:has(.ib){height:100%;overflow:hidden}
.convs,.msgs,.sd-b{overscroll-behavior:contain}
.ib:not(.open){grid-template-columns:397px minmax(0,1fr)}
.ib:not(.open) .ib-side,.ib.swap .ib-side{display:none}
.ib.open.swap{grid-template-columns:397px minmax(0,1fr)}
.pane{position:relative;display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden;background:var(--card)}
.ib-list{border-right:1px solid var(--line)}
/* the three panes' headers are 60px, so their rules continue the sidebar's and the title bar's */
.lh{padding:0 24px}
.lh h1{font-size:22px;line-height:59px;height:60px;margin:0 -24px 6px;padding:0 24px;border-bottom:1px solid var(--line)}
.tabs{display:flex;border-bottom:1px solid var(--line);margin:0 -24px}
.tabs a{flex:1;text-align:center;padding:14px 0 13px;color:var(--mut);font-weight:600;font-size:14px;border-bottom:1px solid transparent;margin-bottom:-1px;opacity:1}
.tabs a:hover{color:var(--ink)}
.tabs a.on{color:var(--ink);border-color:var(--ink)}
.srch{position:relative;margin:16px 0 0}.srch svg{position:absolute;left:14px;top:12px;color:var(--mut)}
.srch input{margin:0;padding:10px 16px 10px 40px;border:0;border-radius:999px;background:var(--soft);font-size:15px}
.srch input::placeholder{color:var(--mut)}
.count{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:16px 0 8px;font-weight:700;font-size:15px}
.count .fl{display:flex;gap:4px;font-weight:600}
.count select,.count form{margin:0;width:auto}
.count select{border:0;background-color:transparent;color:var(--mut);font-size:13px;font-weight:600;padding:4px 22px 4px 8px;background-position:right 4px center;border-radius:6px;max-width:120px}
.count select:hover{color:var(--ink);background-color:var(--hover)}
.convs{position:relative;overflow-y:auto;flex:1;padding-bottom:8px}
.conv{display:flex;align-items:center;gap:12px;padding:8px 24px;color:inherit;opacity:1}
.conv:hover{background:var(--hover);opacity:1}.conv.on{background:var(--sel)}
.conv .avw{position:relative;flex:none}
.conv .av{width:56px;height:56px;font-size:22px}
.wo{position:absolute;right:1px;bottom:1px;width:14px;height:14px;border-radius:50%;background:var(--green);border:3px solid var(--card)}
.conv.on .wo{border-color:var(--sel)}
.conv .grow{flex:1;min-width:0}
.conv .top1{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.conv .top1 b{font-weight:400;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stg{font-size:11px;font-weight:600;white-space:nowrap;flex:none}
.conv .prev{display:flex;color:var(--mut);font-size:12px;line-height:16px;margin-top:3px;white-space:nowrap;min-width:0}
.conv .prev .txt{overflow:hidden;text-overflow:ellipsis;min-width:0}
.conv .prev .when:before{content:"·";margin:0 4px}
.conv .prev .when{flex:none}
.conv.unread .top1 b,.conv.unread .prev{font-weight:600;color:var(--ink)}
.conv.unread .prev .when{font-weight:400;color:var(--mut)}
.ud{width:8px;height:8px;border-radius:50%;background:var(--pri);flex:none}
.ai{flex:none;font-weight:600}
.ai:after{content:"·";margin:0 4px;color:var(--mut);font-weight:400}
.ai.paused{color:var(--amber)}.ai.flagged{color:var(--red)}.ai.closed{color:var(--mut)}
.pager{display:flex;justify-content:space-between;padding:16px 24px}
.pager a{background:var(--btn2);color:var(--ink);padding:7px 16px;border-radius:8px;font-weight:600}
.placeholder{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:var(--mut);text-align:center;padding:24px}
.placeholder .ring{width:96px;height:96px;border-radius:50%;border:2px solid var(--ink);display:grid;place-items:center;color:var(--ink);margin-bottom:12px}
.placeholder b{color:var(--ink);font-size:20px;line-height:25px;font-weight:400}

/* thread */
.th-head{display:flex;align-items:center;gap:12px;height:60px;padding:0 16px 0 16px;border-bottom:1px solid var(--line);flex:none}
.th-head .who{display:flex;gap:12px;align-items:center;min-width:0;flex:1;color:inherit;cursor:pointer;opacity:1}
.th-head .who b{font-size:16px;line-height:20px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.th-head .who small{color:var(--mut);font-size:12px}
.th-head form{margin:0}
.ibtn{display:grid;place-items:center;width:40px;height:40px;margin:0;padding:0;border-radius:50%;background:none;color:var(--ink)}
.ibtn:hover{background:var(--hover)}
.back{display:none;color:var(--ink);margin-left:-8px}
.aitog{display:inline-flex;align-items:center;gap:8px;background:none;color:var(--ink);margin:0;padding:6px 10px;font-size:13px;font-weight:600;border-radius:999px;white-space:nowrap}
.aitog:hover{background:var(--hover)}
.err{color:var(--red);font-size:13px;padding:10px 20px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--red) 8%,transparent)}
.msgs{flex:1;overflow-y:auto;padding:20px 20px 12px;display:flex;flex-direction:column;gap:2px}
.msgs time{align-self:center;font-size:12px;color:var(--mut);margin:16px 0 10px}
.msgs time:first-child{margin-top:4px}
.m{max-width:min(560px,70%);padding:8px 12px;border-radius:22px;white-space:pre-wrap;word-break:break-word;font-size:15px;line-height:20px}
.m.lead{align-self:flex-start;background:var(--soft);color:var(--ink);margin-left:36px;position:relative}
.m.bot{align-self:flex-end;background:var(--out);color:#fff}
.m.bot+.m.bot{border-top-right-radius:4px}.m.bot:has(+.m.bot){border-bottom-right-radius:4px}
.m.lead+.m.lead{border-top-left-radius:4px}.m.lead:has(+.m.lead){border-bottom-left-radius:4px}
.m.lead+.m.bot,.m.bot+.m.lead{margin-top:8px}
.m .av{position:absolute;left:-36px;bottom:0}
.gs{align-self:flex-start;margin:8px 0 2px 48px;font-size:12px;color:var(--mut)}
.m.lead a,.m.bot a{color:inherit;text-decoration:underline}
/* Instagram's message box, measured on instagram.com/direct (2026-10-29): 44px pill, 1px border, 22px radius, 11px
   side padding; 32px emoji button; 15/18 text that grows to 160px then scrolls; a 52x34 #4a5df9 send pill that only
   shows once there's text; "Replying to" bar with a top divider above it. */
.compose{padding:16px;flex:none;position:relative}
.cbox{display:flex;align-items:flex-end;min-height:44px;border:1px solid var(--track);border-radius:22px;padding:0 11px;margin:0}
.cbox .c-emo{display:grid;place-items:center;width:32px;height:32px;margin:6px 0;padding:0;border:0;border-radius:50%;background:none;color:var(--ink);flex:none;cursor:pointer}
.cbox textarea{flex:1;min-width:0;margin:13px 6px;padding:0;border:0;border-radius:0;background:none;color:var(--ink);font-size:15px;line-height:18px;height:18px;max-height:160px;resize:none;overflow-y:auto}
.cbox textarea::placeholder{color:var(--mut)}
.cbox textarea:focus{outline:none}
.cbox textarea:disabled{cursor:not-allowed}
.cbox .c-send{display:grid;place-items:center;width:52px;height:34px;margin:5px 0 5px 6px;padding:0;border:0;border-radius:20px;background:var(--blue);color:#fff;flex:none;cursor:pointer}
.cbox .c-send:hover{background:var(--blue2);color:#fff}
.cbox textarea:placeholder-shown~.c-send{display:none}
.compose .note{margin:8px 4px 0;text-align:center}

/* details panel */
.ib-side{border-left:1px solid var(--line)}
.sd-h{display:flex;align-items:center;justify-content:space-between;height:60px;padding:0 12px 0 24px;border-bottom:1px solid var(--line);flex:none;font-size:16px;font-weight:700}
.sd-b{overflow-y:auto;flex:1}
.sd-who{display:flex;flex-direction:column;align-items:center;gap:4px;padding:28px 24px 24px;text-align:center;border-bottom:1px solid var(--line)}
.sd-who .av{margin-bottom:10px}
.sd-who b{font-size:16px}
.sd-who .stg{margin-top:8px}
.sd{padding:16px 24px;border-bottom:1px solid var(--line)}
.sd:last-child{border:0}
.sd h4{margin:0 0 10px;font-size:12px;font-weight:600;color:var(--mut)}
.kv{display:flex;justify-content:space-between;gap:12px;font-size:14px;padding:5px 0}
.mem{display:flex;align-items:center;gap:10px;padding:4px 0;font-size:14px;color:var(--ink);text-decoration:none}
.kv span:first-child{color:var(--mut)}.kv span:last-child{text-align:right}
.kv.blk{flex-direction:column;gap:4px}.kv.blk span:last-child{text-align:left;line-height:19px}
.sd .chips form{display:contents}
.addtag{display:inline-flex;align-items:center;gap:4px;border:1px dashed var(--line);border-radius:999px;padding:0 10px;color:var(--mut)}
.addtag input{width:72px;margin:0;padding:5px 0;border:0;background:none;font-size:12px}

/* ---------- settings ---------- */
.sec .ch{justify-content:flex-start;align-items:center;gap:12px;margin-bottom:8px}
.sec .ic{color:var(--ink);display:grid}
.opt{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:16px 0;border-top:1px solid var(--line)}
.sec .ch+.opt{border-top:0}
.opt a{font-weight:600;white-space:nowrap}.opt .t{font-weight:600;display:flex;align-items:center;gap:6px}.opt .d{color:var(--mut);font-size:13px;margin-top:4px;line-height:17px}
.opt.hl{display:block}
.pill{display:inline-block;font-size:11px;font-weight:600;color:var(--pri);background:color-mix(in srgb,var(--pri) 12%,transparent);border-radius:6px;padding:1px 6px;margin-left:2px}
.inl{display:flex;gap:8px;align-items:center;margin-top:12px;color:var(--mut)}.inl input{width:80px;margin:0}.inl select{width:auto;margin:0}
.switch{position:relative;display:inline-block;width:44px;height:26px;flex:none;margin:0}
.switch input{position:absolute;opacity:0;width:0;height:0;margin:0}
.switch span{position:absolute;inset:0;background:var(--track);border-radius:13px;transition:.2s;cursor:pointer}
.switch span:before{content:"";position:absolute;width:22px;height:22px;left:2px;top:2px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.switch input:checked+span{background:var(--blue)}.switch input:checked+span:before{transform:translateX(18px);background:#fff}
/* Instagram connection card on Settings. Same markup as the token form; colors follow the Atlas theme. */
.igc{border-color:var(--line)}
.igc .ch h2,.ig-alt a{color:var(--blue)}
.ig-status{display:flex;align-items:center;gap:8px}
.ig-dot{width:8px;height:8px;border-radius:50%;background:var(--mut);flex:none}
.ig-dot.on{background:var(--ok)}
.igc .ig-note{margin:0 0 4px;padding:10px 12px;border-radius:8px;background:var(--soft);color:var(--ink);font-size:13px;line-height:18px}
.igc button.ig-save{background:var(--blue);color:#fff}
.igc button.ig-save:hover{background:var(--blue2)}
.ig-alt{margin:14px 0 0;font-size:13px;line-height:18px;color:var(--mut)}
.tog{position:relative;width:36px;height:22px;border-radius:11px;background:var(--track);flex:none;transition:.2s}
.tog:before{content:"";position:absolute;width:18px;height:18px;left:2px;top:2px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.tog.on{background:var(--green)}.tog.on:before{transform:translateX(14px)}
.aitog .tog.on{background:var(--pri)}.aitog .tog.idle{opacity:.4}
.two{display:grid;grid-template-columns:1fr auto;gap:8px}

/* ---------- narrower screens ---------- */
/* ---------- home: ManyChat start-here on the Atlas canvas ---------- */
.hello{font-size:32px;line-height:1.15;font-weight:700;letter-spacing:-.03em;margin:0 0 8px;color:var(--ink)}
.hello-meta{color:var(--mut);font-size:13px;line-height:18px;margin:0 0 28px}
.hello-meta b{color:var(--ink);font-weight:600}
.sec-h{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin:0 0 12px}
.sec-h h3,.sec-title{font-size:16px;line-height:22px;font-weight:700;margin:0;color:var(--ink)}
.sec-h a{font-weight:600;font-size:14px}
.sec-title{margin:28px 0 12px}
.start-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.start{display:flex;flex-direction:column;justify-content:space-between;gap:28px;min-height:148px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;color:var(--ink);box-shadow:0 1px 2px rgba(11,31,75,.04);opacity:1}
.start:hover{border-color:var(--blue);opacity:1}
.start-t{font-size:16px;font-weight:700;letter-spacing:-.02em;line-height:1.35}
.start-f{display:flex;align-items:center;gap:6px;color:var(--mut);font-size:13px;font-weight:600}
.pop{margin-left:auto;background:#FEF3C7;color:var(--warn);font-size:10px;font-weight:700;letter-spacing:.04em;border-radius:999px;padding:3px 7px}
.moves{width:min(360px,100%);background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;box-shadow:0 1px 2px rgba(11,31,75,.04)}
.moves .k{color:var(--mut);font-size:12px;font-weight:600;margin:0 0 6px}
.moves>b{display:block;font-size:15px;line-height:1.35;letter-spacing:-.02em;margin:0 0 14px}
.moves .bar{height:6px;border-radius:99px;background:var(--line);overflow:hidden}
.moves .bar i{display:block;height:100%;background:var(--blue);border-radius:99px}
.moves .cap{color:var(--mut);font-size:12px;margin:8px 0 4px}
.move{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--line);border-radius:10px;margin-top:8px;color:var(--ink);font-weight:600;opacity:1}
.move:hover{border-color:var(--line2);opacity:1}
.move.done{background:var(--soft)}
.move .tick{width:18px;height:18px;border-radius:50%;border:1.5px solid var(--line2);display:grid;place-items:center;color:#fff;flex:none}
.move.done .tick{background:var(--blue);border-color:var(--blue)}
.move .grow{flex:1;min-width:0}
.move .chev{color:var(--faint);margin-left:auto}
#insights{margin-top:36px}
@media (max-width:900px){.start-grid{grid-template-columns:1fr}}
@media (max-width:1263px){
  body,html.nav-min body{--rail:60px}
  .side .l{opacity:0}.fold{display:none}
  .stats{grid-template-columns:repeat(3,minmax(0,1fr))}
  .cols{grid-template-columns:minmax(0,1fr)}
  .ct{grid-template-columns:minmax(0,1fr);gap:20px}
  .ct-side{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.ct-side h3{margin:0 8px 0 0}
  .ct-side a{margin:0;border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:4px 10px}
  .ib,.ib:not(.open),.ib.open.swap{grid-template-columns:360px minmax(0,1fr)}
  .ib-side{display:none}
  .ib.open.swap .ib-side{display:flex;grid-column:2;grid-row:1}
  .ib.swap .ib-thread{display:none}
}
@media (max-width:767px){
  body,html.nav-min body{--rail:0px}
  .side{top:auto;right:0;width:auto;height:calc(52px + env(safe-area-inset-bottom));flex-direction:row;align-items:center;padding:0 4px env(safe-area-inset-bottom);border-right:0;border-top:1px solid var(--line);background:var(--panel);transition:none}
  .brand,.side .who,.side .gap,.fold,.side .foot{display:none}
  .side nav{flex-direction:row;flex:1;justify-content:space-around;padding:0}
  .nv{height:44px;padding:0 10px}.nv .l{display:none}
  main{padding-bottom:calc(56px + env(safe-area-inset-bottom));transition:none}
  .tb{height:52px;padding:0 16px}.tb h1{font-size:18px;line-height:24px}
  .tb .me{display:block}
  .wrap{padding:16px 16px 48px}
  .card{padding:16px}
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .stat{padding:12px 14px 14px}.stat b{font-size:22px;line-height:28px}
  .lc{grid-template-rows:minmax(180px,1fr) auto}
  .lc-x span:nth-child(even){visibility:hidden}
  .seg .w,.tbl .wide{display:none}.seg .n{display:inline}
  .tb-r{gap:10px}
  .ct-h{display:none}
  .ct-row{grid-template-columns:minmax(0,1fr) auto;padding:10px 14px}
  .ct-row .chips,.ct-row .when.first{display:none}
  .ib,.ib:not(.open),.ib.open.swap{grid-template-columns:minmax(0,1fr);height:calc(100dvh - 52px - env(safe-area-inset-bottom))}
  .ib.open .ib-list{display:none}
  .ib:not(.open) .ib-thread{display:none}
  .ib.open.swap .ib-side{grid-column:1}
  body:has(.ib.open){padding:0}
  body:has(.ib.open) .side{display:none}
  body:has(.ib.open) main{padding-bottom:0}
  body:has(.ib.open) .ib{height:100dvh}
  .lh{padding:0 16px}.lh h1{margin:0 -16px 4px;padding:0 16px;height:52px;line-height:51px;font-size:18px}.tabs{margin:0 -16px}
  .conv{padding:8px 16px}
  .back{display:grid}
  .th-head{height:60px;padding:0 8px 0 12px;gap:8px}
  .th-head .av{width:36px;height:36px;font-size:15px}
  .aitog .lbl{display:none}
  .msgs{padding:16px 12px 8px}
  .m{max-width:80%}
  .compose{padding:10px}
  .sd-h{height:60px}
  .pipe{grid-template-columns:repeat(3,1fr);row-gap:18px}
}
</style>`;
