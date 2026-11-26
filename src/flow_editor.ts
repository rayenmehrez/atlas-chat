// The whiteboard flow editor on our graph model (src/graph.ts): a pan/zoom canvas of node
// cards joined by curved edges. Drag a card to move it, drag from a port (Next Step, a button, a quick reply, Yes /
// Otherwise, a randomizer variant) onto a card to connect it, or onto empty canvas to add the next step there; tap
// a card to edit it in the side panel (a bottom sheet on a phone). Mouse, trackpad (two-finger scroll pans, pinch
// zooms) and touch (one finger pans, two pinch) all go through pointer events. Autosaves a draft; Publish makes it
// live. A published automation opens in the published view first: read-only, a "You are viewing a published
// version" bar with Edit, the Key metrics panel down the left (each tile opens the people behind it), and an Edit
// Automation button; editing starts from there (#edit in the URL keeps it across a reload) and Publish returns to it.
// A never-published draft opens straight in the editor. Zoom + / - sit mid-right and ? (how to pan and zoom) bottom
// right. Plain JS with no build step, served by the Worker at /admin/flows/editor.js; no template literals inside,
// so it can live in a String.raw.

export const EDITOR_CSS = `
.fe [hidden]{display:none!important}
.wrap:has(.fe){max-width:none;padding:0}.wrap:has(.fe) .ttl{display:none}
html:has(.fe),body:has(.fe){height:100%;overflow:hidden}
.fe{position:relative;height:100vh;height:100dvh;display:flex;flex-direction:column;--ban:#fff2e0;--banl:#fddb9b}
:root[data-theme=dark] .fe{--ban:#2b2416;--banl:#4d3f1f}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .fe{--ban:#2b2416;--banl:#4d3f1f}}
.fe-top{display:flex;align-items:center;gap:8px;padding:0 16px 0 24px;border-bottom:1px solid var(--line);background:var(--canvas);z-index:5;height:60px;flex:none}
.fe-top a.bk{color:var(--mut);white-space:nowrap;opacity:1}.fe-top a.bk:hover{color:var(--ink)}
.fe-top .sep{display:grid;color:var(--pri)}
.fe-top .nm{flex:0 1 auto;min-width:60px;max-width:40vw;width:auto;margin:0;border:1px solid transparent;background:none;font-weight:500;font-size:14px;padding:6px 4px;text-overflow:ellipsis}
.fe-top .pen{display:grid;color:var(--mut);margin:0 6px 0 -4px;cursor:text}
.fe-edit{display:inline-flex;align-items:center;gap:8px;height:36px;margin:0;padding:0 12px;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:6px;font-weight:500;white-space:nowrap}
.fe-edit:hover{background:var(--hover)}
.fe-mid{position:relative;flex:1;display:flex;min-height:0;overflow:hidden}
/* Key metrics: a 380px white panel over the canvas's left edge, a round handle to slide it away */
.fe-km{position:absolute;left:0;top:0;bottom:0;width:380px;max-width:86vw;padding:24px;overflow-y:auto;background:var(--panel);border-right:1px solid var(--line);box-shadow:12px 0 24px -5px rgba(132,146,166,.16);z-index:4;transition:transform .3s var(--ease),visibility 0s}
.fe-km.shut{transform:translateX(-100%);visibility:hidden;transition:transform .3s var(--ease),visibility 0s .3s}
.fe-km h2{font-size:20px;line-height:32px;font-weight:700;margin:0}
.fe-km .trg{color:var(--mut);font-size:13px;line-height:18px;margin:4px 0 20px}
.fe-km .tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fe-km .tile{position:relative;display:block;width:100%;min-height:96px;margin:0;padding:12px;text-align:left;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:6px;font-weight:400}
.fe-km .tile:hover{background:var(--hover)}
.fe-km .lb{display:block;color:var(--mut);font-size:14px;line-height:20px}
.fe-km .v{display:block;font-size:24px;line-height:36px;font-weight:700;margin-top:10px;font-variant-numeric:tabular-nums;padding-right:20px}
.fe-km .v small{font-size:14px;font-weight:400;margin-left:6px}
.fe-km .go{position:absolute;right:10px;bottom:20px;display:grid}
.fe-km .hint{color:var(--mut);font-size:12px;line-height:17px;margin:16px 0 0}
.fe-kmh{position:absolute;left:394px;top:50%;width:32px;height:32px;margin:-16px 0 0;padding:0;border:0;border-radius:50%;background:color-mix(in srgb,var(--mut) 32%,transparent);color:#fff;display:grid;place-items:center;z-index:4;transition:left .3s var(--ease)}
.fe-kmh:hover{background:color-mix(in srgb,var(--mut) 55%,transparent)}
.fe-kmh.shut{left:14px}.fe-kmh.shut svg{transform:scaleX(-1)}
.fe-ban{position:absolute;top:0;left:calc(50% + 190px);transform:translateX(-50%);display:flex;background:var(--ban);border:1px solid var(--banl);border-top:0;border-radius:0 0 6px 6px;font-size:14px;line-height:30px;color:var(--mut);white-space:nowrap;z-index:2;transition:left .3s var(--ease)}
.fe-ban.wide{left:50%}
.fe-ban span{padding:0 16px}
.fe-ban button{margin:0;padding:0 16px 0 0;background:none;color:var(--pri);font-weight:400;line-height:30px;text-decoration:underline;border-radius:0}
.fe-ban button:hover{background:none;color:var(--ink)}
/* Dialogs: the contacts behind a metric, and how to pan and zoom */
dialog.fe-dlg{border:0;border-radius:8px;padding:0;margin-top:32px;width:min(540px,calc(100% - 32px));max-height:calc(100% - 64px);background:var(--panel);color:var(--ink);box-shadow:0 20px 60px rgba(0,0,0,.3)}
dialog.fe-dlg[open]{display:flex;flex-direction:column}
dialog.fe-dlg::backdrop{background:rgba(0,0,0,.45)}
.fe-dlg .hd{display:flex;align-items:center;gap:16px;padding:20px 16px 12px 24px}
.fe-dlg h3{font-size:20px;line-height:28px;font-weight:700;margin:0}
.fe-dlg .hd form{flex:1;margin:0}.fe-dlg .hd input{margin:0;padding:7px 10px;font-size:14px;background:var(--panel)}
.fe-dlg .x{display:grid;margin:0 0 0 auto;padding:6px;background:none;color:var(--ink);border-radius:6px}.fe-dlg .x:hover{background:var(--hover)}
.fe-dlg .dtabs{display:flex;gap:20px;margin:0 24px;border-bottom:1px solid var(--line)}
.fe-dlg .dtabs button{margin:0 0 -1px;padding:6px 0 8px;background:none;color:var(--mut);font-weight:400;border-radius:0;border-bottom:2px solid transparent}
.fe-dlg .dtabs button[aria-selected=true]{color:var(--ink);border-color:var(--pri)}
.fe-dlg .hrow{display:flex;gap:20px;align-items:center;margin:0 24px;padding:16px 0;border-top:1px solid var(--line)}
.fe-dlg .hrow:first-child{border-top:0}
.fe-dlg .hrow svg{color:var(--mut)}.fe-dlg .hrow b{display:block;font-weight:600}.fe-dlg .hrow small{display:block;color:var(--mut);font-size:13px;line-height:18px;margin-top:2px}
.fe-dlg .bd{overflow-y:auto;overscroll-behavior:contain;border-top:1px solid var(--line)}
.fe-dlg .dtabs+.bd{border-top:0}
.fe-dlg .crow{display:flex;align-items:center;gap:12px;padding:8px 24px;color:var(--ink);opacity:1}
.fe-dlg .crow:hover{background:var(--hover);opacity:1}
.fe-dlg .crow .av{width:36px;height:36px;font-size:14px}
.fe-dlg .crow div{flex:1;min-width:0}.fe-dlg .crow b,.fe-dlg .crow small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fe-dlg .crow b{font-weight:600}.fe-dlg .crow small,.fe-dlg .crow time{color:var(--mut);font-size:12px}
.fe-dlg .msg{padding:24px;text-align:center;color:var(--mut)}
.fe-dlg .ft{padding:12px 24px 16px;border-top:1px solid var(--line);color:var(--mut);font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.fe-dlg .ft button{margin:0}
.fe-top .nm:hover,.fe-top .nm:focus{border-color:var(--line);background:var(--field)}
.fe-top .sp{flex:1}
.fe-top button{margin:0}
.fe-top .saved{color:var(--mut);font-size:12px;white-space:nowrap}
.fe-test{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:rgba(0,0,0,.55);padding:16px}
.fe-test .card{position:relative;width:min(380px,100%);background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:22px 22px 16px;text-align:center}
.fe-test h3{margin:0 0 8px;font-size:17px}
.fe-test p{margin:0 0 14px;color:var(--mut);font-size:14px;line-height:19px}
.fe-test .row{display:flex;align-items:center;gap:8px;background:var(--soft);border-radius:12px;padding:8px 8px 8px 52px;margin-bottom:12px}
.fe-test .code{flex:1;font-size:34px;line-height:44px;font-weight:700;letter-spacing:6px;font-variant-numeric:tabular-nums}
.fe-test .rf{width:44px;height:44px;font-size:20px;padding:0}
.fe-test .nt{font-size:12px;line-height:16px;margin-bottom:8px}
.fe-test .x{position:absolute;top:8px;right:10px;background:none;border:0;font-size:22px;color:var(--mut);padding:4px 8px;margin:0;cursor:pointer}
.fe-st{font-size:10px;font-weight:700;letter-spacing:.04em;padding:0 6px;line-height:18px;border-radius:4px;white-space:nowrap}
.fe-st.live{background:linear-gradient(90deg,#c90083,#e10038);color:#fff}.fe-st.draft,.fe-st.off{background:var(--soft);color:var(--mut)}
.fe-menu{position:relative}.fe-menu>div{position:absolute;right:0;top:40px;background:var(--elev);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.15);padding:6px;min-width:190px;z-index:6}
.fe-menu>div button{display:block;width:100%;text-align:left;background:none;color:var(--ink);font-weight:500;padding:9px 12px;margin:0}
.fe-menu>div button:hover{background:var(--hover)}.fe-menu>div button.dz{color:var(--red)}
.fe-probs{background:color-mix(in srgb,var(--red) 10%,var(--bg));color:var(--ink);border-bottom:1px solid var(--line);padding:10px 16px;font-size:13px;z-index:3}
.fe-probs b{color:var(--red)}.fe-probs ul{margin:4px 0 0;padding-left:18px}
.fe-vp{position:relative;flex:1;overflow:hidden;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;
  background-color:var(--hover)}
/* A plain canvas in both themes: no dot grid. */
.fe-vp.panning{cursor:grabbing}
.fe-w{position:absolute;left:0;top:0;transform-origin:0 0}
.fe-w svg{position:absolute;overflow:visible;pointer-events:none}
.fe-w path.e{fill:none;stroke:var(--mut);stroke-width:1.6}.fe-w path.e.on{stroke:var(--pri);stroke-width:2.2}
.fe-w path.hit{fill:none;stroke:transparent;stroke-width:16;pointer-events:stroke;cursor:pointer}
.fe-w path.tmp{fill:none;stroke:var(--pri);stroke-width:2;stroke-dasharray:6 5}
.nd{position:absolute;width:300px;background:var(--elev);border:1px solid var(--line);border-radius:18px;box-shadow:0 2px 10px rgba(0,0,0,.06);cursor:pointer;font-size:13px;line-height:18px}
.nd.sel{box-shadow:0 0 0 2px var(--pri),0 4px 16px rgba(0,0,0,.12)}
.nd .in{position:absolute;left:-7px;top:21px;width:12px;height:12px;border-radius:50%;background:var(--elev);border:2px solid var(--mut)}
.nd.trigger .in{display:none}
.nd .hd{display:flex;align-items:center;gap:8px;padding:12px 14px;border-radius:17px 17px 0 0;font-weight:600;font-size:14px}
.nd .hd small{display:block;font-weight:400;font-size:11px;color:var(--mut);line-height:12px}
.nd .hd .ic{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;flex:none}
.nd.message .hd .ic{background:linear-gradient(45deg,#fdb641,#f5543b,#d62a8a,#7b3fe4);color:#fff}
.nd.delay .hd{background:color-mix(in srgb,#ff5a5a 16%,var(--elev))}.nd.condition .hd{background:color-mix(in srgb,#3797f0 16%,var(--elev))}
.nd.action .hd{background:color-mix(in srgb,#f5c542 30%,var(--elev))}.nd.randomizer .hd{background:color-mix(in srgb,#8c5ae8 18%,var(--elev))}
.nd .bd{padding:4px 14px 6px}
.nd .stats{display:flex;justify-content:space-between;text-align:center;margin:2px 0 10px}
.nd .stats div{flex:1;font-size:15px;font-weight:600;color:var(--pri);font-variant-numeric:tabular-nums}.nd .stats small{display:block;font-size:10px;font-weight:400;color:var(--mut)}
.nd .trg{background:color-mix(in srgb,var(--green) 16%,var(--elev));border-radius:12px;padding:10px 12px;margin:2px 0 8px}
.nd .trg .chip{padding:0 7px;line-height:18px;margin:2px 3px 0 0;background:var(--elev);border:1px solid var(--line)}
.nd .bb{background:var(--soft);border-radius:14px;padding:9px 12px;margin:0 0 8px}
.nd .tx{white-space:pre-wrap;word-break:break-word;max-height:126px;overflow:hidden}.nd .tx .lk{color:var(--pri)}
.nd .ph{color:var(--mut)}
.nd .bt{position:relative;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--elev);border-radius:10px;margin:7px 0 0;padding:7px 10px;font-weight:600}
.nd .bt small,.nd .qr small{color:var(--pri);font-weight:500}
.nd .qr{position:relative;display:flex;align-items:center;justify-content:space-between;gap:6px;border:1px solid var(--pri);color:var(--pri);border-radius:999px;margin:0 0 6px;padding:4px 12px;font-weight:600;font-size:12px}
.nd .qr small{color:var(--mut)}
.nd .ln{padding:4px 0;border-bottom:1px solid var(--line)}.nd .ln:last-child{border:0}.nd .ln small{color:var(--mut)}
.nd .ft{position:relative;display:flex;justify-content:flex-end;align-items:center;gap:6px;color:var(--mut);font-size:12px;padding:6px 14px 12px}
.nd .br{position:relative;display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid var(--line);font-weight:600}
.nd .br small{color:var(--mut);font-weight:400}
.pt{position:absolute;right:-21px;top:50%;margin-top:-7px;width:14px;height:14px;border-radius:50%;background:var(--elev);border:2px solid var(--mut);cursor:crosshair;z-index:1}
.pt:after{content:"";position:absolute;inset:-9px}
.pt.on{background:var(--mut)}.pt:hover{border-color:var(--pri);background:var(--pri)}
.bt .pt{right:-31px}.qr .pt{right:-27px}.ft .pt{position:relative;right:-9px;top:auto;margin:0}.br .pt{right:-21px}
.edel{position:absolute;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;border:0;padding:0;background:var(--brand);color:#fff;font-size:15px;line-height:24px;text-align:center;cursor:pointer;z-index:2}
/* Canvas controls: 36px squares, + and - stacked mid-right, ? in the bottom right corner */
.fe-zoom{position:absolute;right:38px;top:50%;margin-top:-44px;display:flex;flex-direction:column;gap:16px;z-index:2}
.fe-zoom button,.fe-help{margin:0;width:36px;height:36px;padding:0;border-radius:6px;background:var(--panel);color:var(--ink);border:1px solid var(--line);display:grid;place-items:center}
.fe-help{position:absolute;right:35px;bottom:35px;width:38px;height:38px;z-index:2}
.fe-zoom button:hover,.fe-help:hover{background:var(--hover)}
.fe-add{margin:0;padding:0;border-radius:50%;display:grid;place-items:center;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.fe-add{position:absolute;right:16px;top:16px;width:48px;height:48px;background:var(--brand);color:#fff;border:0;font-size:26px;z-index:2}
.fe-add:hover{background:color-mix(in srgb,var(--brand) 82%,#000)}
.fe-pick{position:absolute;z-index:7;background:var(--elev);border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.18);padding:6px;width:260px}
.fe-pick button{display:flex;gap:10px;align-items:center;width:100%;margin:0;padding:8px 10px;background:none;color:var(--ink);text-align:left;font-weight:600;border-radius:10px}
.fe-pick button:hover{background:var(--hover)}.fe-pick small{display:block;color:var(--mut);font-weight:400;font-size:12px}
.fe-pick .ic,.fe-pn .ic{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;flex:none;background:var(--soft)}
.fe-pn{position:absolute;right:0;top:0;bottom:0;width:390px;max-width:100%;background:var(--bg);border-left:1px solid var(--line);z-index:5;display:flex;flex-direction:column;box-shadow:-8px 0 30px rgba(0,0,0,.08)}
.fe-pn .ph{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);font-weight:600;font-size:15px}
.fe-pn .ph .x{margin:0 0 0 auto;background:none;color:var(--mut);font-size:20px;padding:4px 8px}
.fe-pn .pb{flex:1;overflow:auto;padding:16px;overscroll-behavior:contain}
.fe-pn .grp{border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:12px}
.fe-pn .rw{display:flex;gap:6px;align-items:flex-start}.fe-pn .rw>*{flex:1;min-width:0}.fe-pn .rw>.x{flex:none}
.fe-pn .x{margin:0;padding:9px 10px;background:none;color:var(--mut);font-size:16px;line-height:18px}
.fe-pn .x:hover{color:var(--red);background:none}
.fe-pn .lnk{margin:0 0 10px;padding:6px 12px;background:var(--btn2);color:var(--ink);font-size:13px}
.fe-pn .hint{color:var(--mut);font-size:12px;line-height:16px;margin:-4px 0 10px}
.fe-pn .story-prev{display:block;width:90px;aspect-ratio:9/16;object-fit:cover;border-radius:8px;margin:0 0 10px}
.fe-pn .cnt{float:right;font-weight:400}.fe-pn .cnt.bad{color:var(--red)}
.fe-pn .foot{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--line)}.fe-pn .foot button{margin:0}
.fe-pn .foot .dz{background:none;color:var(--red);margin-left:auto}
.fe-pn label{margin-top:2px}
@media (max-width:767px){
  .fe{height:calc(100dvh - 52px)}
  .fe-top{padding:0 10px;gap:6px}.fe-top a.bk,.fe-top .sep,.fe-top .saved,.fe-top .pen{display:none}.fe-top .nm{flex:1 1 80px;max-width:none}
  .fe-ban,.fe-ban.wide{left:50%}.fe-kmh{left:calc(86vw + 10px)}
  .fe-zoom{right:12px}.fe-help{right:12px;bottom:20px}
  .fe-pn{top:auto;left:0;width:auto;height:62%;border-left:0;border-top:1px solid var(--line);border-radius:18px 18px 0 0;box-shadow:0 -10px 30px rgba(0,0,0,.15)}
  .fe-add{top:auto;bottom:20px;right:62px}
}`;

export const EDITOR_JS = String.raw`(function () {
"use strict";
var B = JSON.parse(document.getElementById("fe-data").textContent);
var root = document.getElementById("fe");
// CAN = may edit at all (the reviewer login can't). A published automation opens in the published view (read-only,
// showing what's live even when a draft is waiting); "Edit Automation" switches to the editor on the draft.
var CAN = !B.ro;
var viewing = B.status !== "draft" || !CAN;
if (CAN && location.hash === "#edit") viewing = false;
var RO = viewing;
var G = viewing && B.published ? B.published : B.graph;
var kmShut = window.innerWidth < 768;
try { if (localStorage.getItem("km") === "shut") kmShut = true; } catch (e) {}
var view = { x: 60, y: 60, z: 1 };
var sel = null, selEdge = null, picker = null;
var status = B.status, dirty = !!B.hasDraft, problems = [];
var undoStack = [], redoStack = [], lastSnap = JSON.stringify(G), snapT = null, saveT = null, saving = false, saveState = dirty ? "unpublished" : "saved";

var ICONS = {
  ig: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/></svg>',
  clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  split: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3v6a6 6 0 0 0 6 6h6M18 15l-3-3M18 15l-3 3M6 9v12"/></svg>',
  bolt: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  shuffle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  link: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  pen: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 7.5 3 3"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  chevl: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  plusbig: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  help: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 0 1 5 .8c0 1.7-2.5 2.2-2.5 3.7"/><path d="M12 17h.01"/></svg>',
  close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  drag: '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="8" width="12" height="20" rx="6"/><path d="M20 8v7M14 15h12"/><path d="M4 18h6M4 18l2.5-2.5M4 18l2.5 2.5M36 18h-6M36 18l-2.5-2.5M36 18l-2.5 2.5"/></svg>',
  wheel: '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="8" width="12" height="20" rx="6"/><path d="M22 12v5"/><path d="M8 10v16M8 10l-2.5 2.5M8 10l2.5 2.5M8 26l-2.5-2.5M8 26l2.5-2.5"/></svg>',
  pad: '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="9" width="28" height="20" rx="3"/><circle cx="16" cy="19" r="2"/><circle cx="24" cy="19" r="2"/></svg>',
  pinch: '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="9" width="28" height="20" rx="3"/><path d="M13 24l5-5M13 24v-3.5M13 24h3.5M27 14l-5 5M27 14v3.5M27 14h-3.5"/></svg>'
};
var KINDS = {
  message: { t: "Send Message", d: "Text, buttons and quick replies", ic: "ig" },
  delay: { t: "Smart Delay", d: "Wait, then continue", ic: "clock" },
  condition: { t: "Condition", d: "Split by tag, stage, keyword, follow", ic: "split" },
  action: { t: "Actions", d: "Tag, stage, pause, hand off to the AI", ic: "bolt" },
  randomizer: { t: "Randomizer", d: "A/B split", ic: "shuffle" }
};
var SRC = {
  comment: "User comments on your Post or Reel",
  dm: "User sends you a DM",
  story: "User replies to your Story",
  mention: "User mentions you in their Story",
  welcome: "New conversation (their first message ever)",
  none: "Only from a button, Conversation Starter or another automation"
};
var FIELDS = { tag: "Tag", stage: "Stage", keyword: "Their last message contains", follows: "Follows you", paused: "AI is paused for them" };
var ACTS = { add_tag: "Add tag", remove_tag: "Remove tag", set_stage: "Set stage", pause_ai: "Pause the AI", resume_ai: "Resume the AI", handoff: "Hand off to the AI setter (ends the flow)", start_automation: "Start another automation" };

// ---------- tiny DOM helper ----------
function h(tag, a, kids) {
  var e = document.createElement(tag);
  if (a) for (var k in a) {
    var v = a[k];
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "icon") e.innerHTML = ICONS[v] || "";
    else if (k === "value") e.value = v;
    else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  add(e, kids);
  return e;
}
function add(e, kids) {
  if (kids == null || kids === false) return;
  if (Array.isArray(kids)) kids.forEach(function (k) { add(e, k); });
  else e.appendChild(typeof kids === "object" ? kids : document.createTextNode(String(kids)));
}
function rid(p) { return p + Math.random().toString(36).slice(2, 8); }
function node(id) { for (var i = 0; i < G.nodes.length; i++) if (G.nodes[i].id === id) return G.nodes[i]; return null; }
function edgeFrom(id, port) { for (var i = 0; i < G.edges.length; i++) if (G.edges[i].from === id && G.edges[i].port === port) return G.edges[i]; return null; }
function stat(id) { return (B.stats && B.stats[id]) || {}; }
function pct(a, b) { return b ? (Math.round((1000 * a) / b) / 10) + "%" : "n/a"; }
function fmt(n) { return (n || 0).toLocaleString("en-US"); }
function dur(s) {
  if (s % 86400 === 0) return [s / 86400, "d"];
  if (s % 3600 === 0) return [s / 3600, "h"];
  if (s % 60 === 0) return [s / 60, "m"];
  return [s, "s"];
}
var UNITS = { s: ["second", 1], m: ["minute", 60], h: ["hour", 3600], d: ["day", 86400] };
function durText(s) { var d = dur(s); return d[0] + " " + UNITS[d[1]][0] + (d[0] === 1 ? "" : "s"); }
function autoName(id) { for (var i = 0; i < B.automations.length; i++) if (String(B.automations[i].id) === String(id)) return B.automations[i].name; return "(pick one)"; }

// ---------- layout ----------
var top = h("div", { class: "fe-top" });
var probBox = h("div", { class: "fe-probs", hidden: true });
var vp = h("div", { class: "fe-vp" });
var world = h("div", { class: "fe-w" });
var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
var gEl = document.createElementNS("http://www.w3.org/2000/svg", "g");
svg.appendChild(gEl);
world.appendChild(svg);
var nodesEl = h("div");
world.appendChild(nodesEl);
vp.appendChild(world);
var panel = h("div", { class: "fe-pn", hidden: true });
var zoom = h("div", { class: "fe-zoom" }, [
  h("button", { type: "button", title: "Zoom in", "aria-label": "Zoom in", icon: "plus", onclick: function () { zoomAt(null, null, 1.2); } }),
  h("button", { type: "button", title: "Zoom out", "aria-label": "Zoom out", icon: "minus", onclick: function () { zoomAt(null, null, 1 / 1.2); } })
]);
vp.appendChild(zoom);
vp.appendChild(h("button", { type: "button", class: "fe-help", title: "Zooming and panning", "aria-label": "Help: zooming and panning", icon: "help", onclick: function (e) { e.stopPropagation(); openHelp(); } }));
var addBtn = h("button", { type: "button", class: "fe-add", title: "Add a step", "aria-label": "Add a step", icon: "plusbig", onclick: function (e) { e.stopPropagation(); var r = vp.getBoundingClientRect(); openPicker(r.left + r.width / 2 - 130, r.top + 80, toWorld(r.left + r.width / 2 - 150, r.top + r.height / 2 - 80), null); } });
vp.appendChild(addBtn);
var ban = h("div", { class: "fe-ban", hidden: true });
vp.appendChild(ban);
var mid = h("div", { class: "fe-mid" });
var km = h("aside", { class: "fe-km", "aria-label": "Key metrics", hidden: true });
var kmh = h("button", { type: "button", class: "fe-kmh", icon: "chevl", hidden: true, onclick: function (e) {
  e.stopPropagation();
  kmShut = !kmShut;
  try { localStorage.setItem("km", kmShut ? "shut" : "open"); } catch (x) {}
  renderChrome();
} });
root.appendChild(top);
root.appendChild(probBox);
root.appendChild(mid);
mid.appendChild(vp);
mid.appendChild(km);
mid.appendChild(kmh);
vp.appendChild(panel);

// ---------- published view: the bar, Key metrics, and the lists behind its tiles ----------
function published() { return viewing && status !== "draft"; }
function renderChrome() {
  var pub = published();
  addBtn.hidden = RO;
  ban.hidden = !pub;
  ban.className = "fe-ban" + (kmShut ? " wide" : "");
  ban.innerHTML = "";
  if (pub) add(ban, [h("span", { text: "You are viewing a published version" }), CAN ? h("button", { type: "button", text: "Edit", onclick: enterEdit }) : null]);
  km.hidden = kmh.hidden = !pub;
  km.className = "fe-km" + (kmShut ? " shut" : "");
  kmh.className = "fe-kmh" + (kmShut ? " shut" : "");
  kmh.setAttribute("aria-label", kmShut ? "Show key metrics" : "Hide key metrics");
  kmh.setAttribute("aria-expanded", String(!kmShut));
  kmh.title = kmShut ? "Show key metrics" : "Hide key metrics";
  if (!pub) return;
  var m = B.metrics || {};
  function tile(label, value, unit, set) {
    return h("button", { type: "button", class: "tile", onclick: function () { openContacts(set, label); } }, [
      h("span", { class: "lb", text: label }),
      h("span", { class: "v" }, [fmt(value), unit ? h("small", { text: unit }) : null]),
      h("span", { class: "go", icon: "chev" })
    ]);
  }
  km.innerHTML = "";
  add(km, [
    h("h2", { text: "Key metrics" }),
    h("p", { class: "trg", text: SRC[G.trigger.source] || "" }),
    h("div", { class: "tiles" }, [
      tile("Sends", m.sends, "times", "all"),
      tile("Unique Contacts", m.contacts, null, "all"),
      tile("Opened", m.opened, m.contacts ? pct(m.opened, m.contacts) : null, "opened"),
      tile("Clicked", m.clicked, m.contacts ? pct(m.clicked, m.contacts) : null, "clicked")
    ]),
    h("p", { class: "hint", text: "Opened counts read receipts, which only some people share, so read it as \"at least\". Clicked is anyone who tapped a button or link." })
  ]);
}
function dialog(title, extra) {
  var d = h("dialog", { class: "fe-dlg", "aria-label": title });
  var x = h("button", { type: "button", class: "x", "aria-label": "Close", icon: "close", onclick: function () { d.close(); } });
  add(d, h("div", { class: "hd" }, [h("h3", { text: title }), extra || null, x]));
  d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
  d.addEventListener("close", function () { d.remove(); });
  document.body.appendChild(d);
  d.showModal();
  return d;
}
function openContacts(set, label) {
  var note = h("span", { text: "" });
  var input = h("input", { placeholder: "Tag These Contacts", maxlength: 40, "aria-label": "Tag these contacts" });
  var form = CAN ? h("form", { onsubmit: function (e) {
    e.preventDefault();
    var tag = input.value.trim();
    if (!tag) return;
    api("tag", { set: set, tag: tag }).then(function (j) {
      note.textContent = j.httpOk ? "Tagged everyone here \"" + j.tag + "\"" + (j.added ? " (" + fmt(j.added) + " new)" : " (they all had it)") : "Couldn't tag them. Try again.";
      if (j.httpOk) input.value = "";
    });
  } }, input) : null;
  var d = dialog("Contacts", form);
  var body = h("div", { class: "bd" }, h("div", { class: "msg", text: "Loading…" }));
  var foot = h("div", { class: "ft" }, [note]);
  add(d, [body, foot]);
  fetch("/admin/flows/" + B.id + "/contacts?set=" + set, { headers: { Accept: "application/json" } })
    .then(function (r) { if (!r.ok) throw r; return r.json(); })
    .then(function (j) {
      body.innerHTML = "";
      if (!j.contacts.length) { add(body, h("div", { class: "msg", text: "No contacts found" })); return; }
      j.contacts.forEach(function (c) {
        var name = c.name || (c.username ? "@" + c.username : c.id);
        var av = h("span", { class: "av", style: "background:#5764fa" }, (name.replace(/^[^A-Za-z0-9]+/, "").charAt(0) || "?").toUpperCase());
        if (c.pic) { var img = h("img", { src: c.pic, alt: "", referrerpolicy: "no-referrer", loading: "lazy" }); img.addEventListener("error", function () { img.remove(); }); av.appendChild(img); }
        add(body, h("a", { class: "crow", href: "/admin/inbox/" + encodeURIComponent(c.id) }, [av, h("div", null, [h("b", { text: name }), c.name && c.username ? h("small", { text: "@" + c.username }) : null]), h("time", { "data-t": c.at, "data-day": true })]));
      });
      if (window.fmtTimes) window.fmtTimes(body);
      if (!note.textContent) note.textContent = label + ": " + fmt(j.total) + (j.total === 1 ? " person" : " people") + (j.total > j.contacts.length ? ", newest " + j.contacts.length + " shown" : "");
    })
    .catch(function () { body.innerHTML = ""; add(body, h("div", { class: "msg", text: "Couldn't load the list. Close this and try again." })); });
}
// The "Zooming and panning" card: how this canvas behaves with a mouse and with a trackpad.
function openHelp() {
  var d = dialog("Zooming and panning");
  var rows = {
    mouse: [["drag", "Pan Around", "Left click + Drag on the canvas, or scroll the wheel"], ["wheel", "Zoom", "Ctrl (or ⌘) + scroll the wheel, or the + and − buttons"]],
    trackpad: [["pad", "Pan Around", "Scroll with two fingers"], ["pinch", "Zoom", "Pinch with two fingers"]]
  };
  var body = h("div", { class: "bd" });
  var tabs = h("div", { class: "dtabs", role: "tablist" });
  function show(k) {
    tabs.innerHTML = "";
    [["mouse", "Mouse"], ["trackpad", "Trackpad"]].forEach(function (t) {
      tabs.appendChild(h("button", { type: "button", role: "tab", "aria-selected": String(t[0] === k), text: t[1], onclick: function () { show(t[0]); } }));
    });
    body.innerHTML = "";
    rows[k].forEach(function (r) { add(body, h("div", { class: "hrow" }, [h("span", { icon: r[0] }), h("div", null, [h("b", { text: r[1] }), h("small", { text: r[2] })])])); });
  }
  show("mouse");
  add(d, [tabs, body, h("div", { class: "ft" }, [h("span", { text: "Lost the flow?" }), h("button", { type: "button", class: "ghost", text: "Fit to screen", onclick: function () { fit(); draw(); d.close(); } })])]);
}
function enterEdit() {
  if (!CAN || !viewing) return;
  viewing = false; RO = false;
  G = JSON.parse(JSON.stringify(B.graph));
  lastSnap = JSON.stringify(G); undoStack = []; redoStack = [];
  sel = null; selEdge = null;
  try { history.replaceState(null, "", "#edit"); } catch (e) {}
  renderAll();
  requestAnimationFrame(function () { fit(); draw(); });
}
// Back to the published view once what's on screen is what's live.
function showPublished() {
  B.graph = JSON.parse(JSON.stringify(G)); B.published = null;
  viewing = true; RO = true;
  sel = null; selEdge = null;
  closePicker();
  try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  renderAll();
  requestAnimationFrame(function () { fit(); draw(); });
}
function renderAll() { renderTop(); renderChrome(); renderNodes(); renderPanel(); renderProblems(); }

// ---------- top bar ----------
function renderTop() {
  top.innerHTML = "";
  var name = h("input", { class: "nm", value: B.name, maxlength: 80, disabled: !CAN, "aria-label": "Automation name" });
  // As wide as its text, so the pencil sits right after the name (measured: an input's own sizing overshoots).
  function sizeName() {
    var c = sizeName.c || (sizeName.c = document.createElement("canvas").getContext("2d"));
    c.font = getComputedStyle(name).font || "500 14px sans-serif";
    name.style.width = Math.ceil(c.measureText(name.value || " ").width) + 12 + "px";
  }
  name.addEventListener("input", sizeName);
  name.addEventListener("change", function () {
    B.name = name.value.trim() || B.name;
    api("rename", { name: B.name });
  });
  var label = { live: "LIVE", off: "OFF", draft: "DRAFT" }[status];
  var savedText = !CAN ? "View only" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save, retrying" : dirty && status !== "draft" ? "Unpublished changes" : "Saved";
  var menuBox = h("div", { hidden: true });
  var menu = h("div", { class: "fe-menu" }, [h("button", { class: "ghost", title: "More", onclick: function (e) { e.stopPropagation(); menuBox.hidden = !menuBox.hidden; } }, "⋯"), menuBox]);
  if (status !== "draft") add(menuBox, h("button", { onclick: toggleLive }, status === "live" ? "Turn off" : "Turn on"));
  if (dirty && status !== "draft") add(menuBox, h("button", { onclick: discard }, "Discard unpublished changes"));
  add(menuBox, h("button", { onclick: function () { undo(); } }, "Undo"));
  add(menuBox, h("button", { onclick: function () { redo(); } }, "Redo"));
  add(menuBox, h("button", { class: "dz", onclick: function () { if (confirm("Move this automation to Trash?")) postForm("/admin/flows/" + B.id + "/delete"); } }, "Delete"));
  add(top, [
    h("a", { class: "bk", href: "/admin/automations" + (B.folder ? "?folder=" + encodeURIComponent(B.folder) : ""), text: "Automations" }),
    h("span", { class: "sep", icon: "chev" }),
    name,
    CAN ? h("span", { class: "pen", icon: "pen", title: "Rename", onclick: function () { name.focus(); name.select(); } }) : null,
    h("span", { class: "fe-st " + status, text: label }),
    h("span", { class: "sp" }),
    viewing
      ? (CAN ? h("button", { type: "button", class: "fe-edit", onclick: enterEdit }, [h("span", { icon: "pen", style: "display:grid" }), "Edit Automation"]) : h("span", { class: "saved", text: savedText }))
      : [
          h("span", { class: "saved", text: savedText }),
          menu,
          h("button", { class: "ghost", onclick: openTest, title: "Run it on yourself from a DM" }, "Test"),
          h("button", { onclick: publish, disabled: status === "live" && !dirty }, status === "draft" ? "Set Live" : "Publish")
        ]
  ]);
  sizeName();
}
document.addEventListener("click", function () { var m = top.querySelector(".fe-menu>div"); if (m) m.hidden = true; });

// Test: a 3-digit code to DM the account from another one; the automation as it is right now runs on
// whoever sent it. Asking again gives a fresh code (and picks up edits made since).
function openTest() {
  var old = document.querySelector(".fe-test");
  if (old) old.remove();
  var codeEl = h("div", { class: "code", text: "···" });
  var to = h("span", { text: "your Instagram account" });
  var note = h("p", { class: "nt", text: "" });
  var box = h("div", { class: "fe-test", role: "dialog", "aria-label": "Test this automation" }, [
    h("div", { class: "card" }, [
      h("button", { class: "x", "aria-label": "Close", onclick: function () { box.remove(); } }, "×"),
      h("h3", { text: "Test this automation" }),
      h("p", null, ["From a different Instagram account, DM this code to ", to, ". The automation runs on you right away, exactly as it is here, unpublished changes included."]),
      h("div", { class: "row" }, [codeEl, h("button", { class: "ghost rf", title: "New code", "aria-label": "New code", onclick: load }, "↻")]),
      note,
      h("p", { class: "nt", text: "The code works for 15 minutes and as many times as you like. Test runs don't count in the stats." })
    ])
  ]);
  box.addEventListener("click", function (e) { if (e.target === box) box.remove(); });
  document.body.appendChild(box);
  function load() {
    codeEl.textContent = "···";
    api("test", { graph: G }).then(function (j) {
      if (!j.httpOk || !j.code) { codeEl.textContent = "-"; note.textContent = "Couldn't make a code. Try again."; return; }
      codeEl.textContent = j.code;
      if (j.handle) to.textContent = "@" + j.handle;
      note.textContent = j.comment ? "This one starts from a comment. In a test the first message comes as a normal DM instead of a reply to your comment." : "";
    });
  }
  load();
}

function renderProblems() {
  probBox.hidden = !problems.length;
  probBox.innerHTML = "";
  if (problems.length) add(probBox, [h("b", { text: "Can't publish yet:" }), h("ul", null, problems.map(function (p) { return h("li", { text: p }); }))]);
}

// ---------- cards ----------
function port(id, p) { return h("span", { class: "pt" + (edgeFrom(id, p) ? " on" : ""), "data-n": id, "data-p": p, title: RO ? null : "Drag to the next step" }); }
function statsRow(items) { return h("div", { class: "stats" }, items.map(function (i) { return h("div", null, [String(i[0]), h("small", { text: i[1] })]); })); }
function richText(t) {
  if (!t) return h("span", { class: "ph", text: "Add a text" });
  var parts = t.split("{{SKOOL_LINK}}"), out = [];
  parts.forEach(function (p, i) { if (i) out.push(h("span", { class: "lk", text: B.link })); out.push(p); });
  return out;
}
function chips(kw) {
  return kw.split(",").map(function (k) { return k.trim(); }).filter(Boolean).map(function (k) { return h("span", { class: "chip", text: k === "*" ? "anything" : k }); });
}
function trigText(t) {
  var any = t.keyword.split(",").some(function (k) { return k.trim() === "*"; }) || !t.keyword.trim();
  switch (t.source) {
    case "comment": return [(t.media_id === "next" ? "User comments on next Post or Reel" : t.media_id ? "User comments on a specific Post or Reel" : "User comments on any Post or Reel") + (any ? "" : " and comment contains "), any ? null : chips(t.keyword)];
    case "dm": return ["User sends a message" + (any ? "" : " that contains "), any ? null : chips(t.keyword)];
    case "story": return [(t.media_id ? "User replies to a specific Story" : "User replies to your Story") + (any ? "" : " with "), any ? null : chips(t.keyword)];
    default: return [SRC[t.source]];
  }
}
function head(n) {
  if (n.kind === "trigger") return h("div", { class: "hd" }, [h("span", { class: "ic", icon: "bolt" }), "When…"]);
  var k = KINDS[n.kind], title = k.t;
  if (n.kind === "message") title += " #" + (G.nodes.filter(function (x) { return x.kind === "message"; }).indexOf(n) + 1);
  return h("div", { class: "hd" }, [h("span", { class: "ic", icon: k.ic }), h("div", null, [n.kind === "message" ? h("small", { text: "Instagram" }) : null, title])]);
}
function nextRow(n, label) { return h("div", { class: "ft" }, [label || "Next Step", port(n.id, "next")]); }

function card(n) {
  var st = stat(n.id), d = n.data, body = [], foot = null;
  if (n.kind === "trigger") {
    body.push(statsRow([[fmt(st.sent), "Runs"]]));
    body.push(h("div", { class: "trg" }, trigText(G.trigger)));
    foot = nextRow(n, "Then");
  } else if (n.kind === "message") {
    var sent = st.sent || 0, ports = st.ports || {};
    body.push(statsRow([[fmt(sent), "Sent"], [pct(st.opened || 0, sent), "Opened"], [pct(st.clicked || 0, sent), "Clicked"]]));
    d.bubbles.forEach(function (b) {
      body.push(h("div", { class: "bb" }, [h("div", { class: "tx" }, richText(b.text))].concat(b.buttons.map(function (x) {
        return h("div", { class: "bt" }, [x.title || "Button", x.url !== undefined ? h("span", { icon: "link" }) : null, sent ? h("small", { text: "CTR " + pct(ports[x.id] || 0, sent) }) : null, x.url === undefined ? port(n.id, x.id) : null]);
      }))));
    });
    d.quick_replies.forEach(function (q) { body.push(h("div", { class: "qr" }, [q.title || "Quick reply", sent ? h("small", { text: pct(ports[q.id] || 0, sent) }) : null, port(n.id, q.id)])); });
    foot = nextRow(n);
  } else if (n.kind === "delay") {
    body.push(statsRow([[fmt((st.waiting || 0) + (st.passed || 0)), "Overall"], [fmt(st.waiting), "Waiting"], [fmt(st.passed), "Passed"]]));
    body.push(h("div", { class: "ln" }, ["Wait for ", h("b", { text: durText(d.seconds) }), " and then continue"]));
    body.push(h("div", { class: "ln" }, h("small", { text: "Skipped if they write back meanwhile" })));
    foot = nextRow(n);
  } else if (n.kind === "condition") {
    var p = st.ports || {};
    body.push(h("div", { class: "ln" }, h("small", { text: d.match === "any" ? "Any of these" : "All of these" })));
    d.rules.forEach(function (r) { body.push(h("div", { class: "ln", text: ruleText(r) })); });
    body.push(h("div", { class: "br" }, [h("span", null, ["Yes ", h("small", { text: fmt(p.yes) })]), port(n.id, "yes")]));
    body.push(h("div", { class: "br" }, [h("span", null, ["Otherwise ", h("small", { text: fmt(p.no) })]), port(n.id, "no")]));
  } else if (n.kind === "action") {
    d.actions.forEach(function (a) { body.push(h("div", { class: "ln" }, [h("small", { text: ACTS[a.type].replace(" (ends the flow)", "") }), h("div", { text: actText(a) })])); });
    if (!d.actions.some(function (a) { return a.type === "handoff"; })) foot = nextRow(n);
  } else if (n.kind === "randomizer") {
    var vp2 = st.ports || {}, tot = d.variants.reduce(function (s, v) { return s + v.weight; }, 0);
    d.variants.forEach(function (v) { body.push(h("div", { class: "br" }, [h("span", null, [v.label + " ", h("small", { text: (tot ? Math.round((100 * v.weight) / tot) : 0) + "% · " + fmt(vp2[v.id]) })]), port(n.id, v.id)])); });
  }
  var el = h("div", { class: "nd " + n.kind + (sel === n.id ? " sel" : ""), "data-id": n.id }, [h("span", { class: "in" }), head(n), h("div", { class: "bd" }, body), foot]);
  el.style.left = n.x + "px";
  el.style.top = n.y + "px";
  return el;
}
function ruleText(r) {
  var not = r.op === "not";
  switch (r.field) {
    case "tag": return (not ? "Doesn't have tag " : "Has tag ") + (r.value || "…");
    case "stage": return "Stage " + (not ? "isn't " : "is ") + (r.value || "…");
    case "keyword": return "Last message " + (not ? "doesn't contain " : "contains ") + (r.value || "…");
    case "follows": return not ? "Doesn't follow you" : "Follows you";
    case "paused": return not ? "AI is on for them" : "AI is paused for them";
  }
  return "";
}
function actText(a) {
  if (a.type === "start_automation") return autoName(a.value);
  if (a.type === "pause_ai" || a.type === "resume_ai" || a.type === "handoff") return a.type === "handoff" ? "The AI setter takes it from here" : "";
  return a.value || "…";
}

function renderNodes() {
  nodesEl.innerHTML = "";
  G.nodes.forEach(function (n) { nodesEl.appendChild(card(n)); });
  draw();
}

// ---------- edges ----------
var tmp = null; // {from, port, x, y} while dragging a new connection
function portXY(id, p) {
  var el = nodesEl.querySelector('.pt[data-n="' + id + '"][data-p="' + p + '"]');
  var n = node(id);
  if (!el || !n) return null;
  var x = el.offsetWidth / 2, y = el.offsetHeight / 2, e = el;
  while (e && !e.classList.contains("nd")) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
  return { x: n.x + x, y: n.y + y };
}
function curve(a, b) {
  var dx = Math.max(50, Math.abs(b.x - a.x) / 2);
  return "M" + a.x + " " + a.y + " C" + (a.x + dx) + " " + a.y + " " + (b.x - dx) + " " + b.y + " " + b.x + " " + b.y;
}
// A connection to a card that isn't to the right (a loop like "I followed" -> the follow check again, or a card
// placed underneath) would run behind cards, so it goes around them: out to the right, through the gap between
// the two cards (or under both when they overlap), and into the input from the left, with rounded corners.
function rects() {
  var out = {};
  nodesEl.querySelectorAll(".nd").forEach(function (el) { var n = node(el.dataset.id); out[n.id] = { l: n.x - 12, r: n.x + el.offsetWidth + 12, t: n.y - 12, b: n.y + el.offsetHeight + 12 }; });
  return out;
}
function rounded(p) {
  var d = "M" + p[0].x + " " + p[0].y;
  for (var i = 1; i < p.length - 1; i++) {
    var a = p[i - 1], c = p[i], n = p[i + 1];
    var l1 = Math.hypot(c.x - a.x, c.y - a.y), l2 = Math.hypot(n.x - c.x, n.y - c.y), r = Math.min(18, l1 / 2, l2 / 2);
    if (!l1 || !l2) continue;
    d += " L" + (c.x - ((c.x - a.x) / l1) * r) + " " + (c.y - ((c.y - a.y) / l1) * r) + " Q" + c.x + " " + c.y + " " + (c.x + ((n.x - c.x) / l2) * r) + " " + (c.y + ((n.y - c.y) / l2) * r);
  }
  var z = p[p.length - 1];
  return d + " L" + z.x + " " + z.y;
}
function around(a, b, from, to, R) {
  var s = R[from], t = R[to], x1 = a.x + 26, x2 = b.x - 26, lo = Math.min(x1, x2), hi = Math.max(x1, x2);
  function clear(y) {
    for (var id in R) {
      var c = R[id];
      if (c.t < y && y < c.b && c.l < hi && c.r > lo) return false; // the run along y
      if (id !== from && c.l < x1 && x1 < c.r && c.t < Math.max(a.y, y) && c.b > Math.min(a.y, y)) return false; // the leg out
      if (id !== to && c.l < x2 && x2 < c.r && c.t < Math.max(b.y, y) && c.b > Math.min(b.y, y)) return false; // the leg in
    }
    return true;
  }
  var under = -1e9, over = 1e9;
  for (var id in R) if (R[id].l < hi && R[id].r > lo) { under = Math.max(under, R[id].b); over = Math.min(over, R[id].t); }
  var tries = [];
  if (t.t > s.b) tries.push((s.b + t.t) / 2);
  if (s.t > t.b) tries.push((t.b + s.t) / 2);
  tries.push(under + 24, over - 24);
  var y = tries.filter(clear)[0];
  if (y === undefined) y = under + 24;
  return { d: rounded([a, { x: x1, y: a.y }, { x: x1, y: y }, { x: x2, y: y }, { x: x2, y: b.y }, b]), mid: { x: (x1 + x2) / 2, y: y }, pts: [{ x: x1, y: y }, { x: x2, y: y }] };
}
function draw() {
  var paths = [], pts = [], R = null;
  G.edges.forEach(function (e) {
    var a = portXY(e.from, e.port), t = node(e.to);
    if (!a || !t) return;
    var b = { x: t.x - 1, y: t.y + 27 };
    if (b.x < a.x + 30) {
      var l = around(a, b, e.from, e.to, R || (R = rects()));
      paths.push({ d: l.d, e: e, mid: l.mid, loop: true });
      pts.push(a, b, l.pts[0], l.pts[1]);
      return;
    }
    paths.push({ d: curve(a, b), e: e, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
    pts.push(a, b);
  });
  if (tmp) { var a = portXY(tmp.from, tmp.port); if (a) { paths.push({ d: curve(a, tmp), tmp: true }); pts.push(a, tmp); } }
  var minX = 0, minY = 0, maxX = 1, maxY = 1;
  pts.forEach(function (p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
  minX -= 200; minY -= 200; maxX += 200; maxY += 200;
  svg.style.left = minX + "px"; svg.style.top = minY + "px";
  svg.setAttribute("width", maxX - minX); svg.setAttribute("height", maxY - minY);
  gEl.setAttribute("transform", "translate(" + -minX + "," + -minY + ")");
  gEl.innerHTML = "";
  var old = world.querySelector(".edel");
  if (old) old.remove();
  paths.forEach(function (p) {
    var on = selEdge && p.e && selEdge.from === p.e.from && selEdge.port === p.e.port;
    var v = document.createElementNS("http://www.w3.org/2000/svg", "path");
    v.setAttribute("d", p.d);
    v.setAttribute("class", p.tmp ? "tmp" : "e" + (on ? " on" : ""));
    gEl.appendChild(v);
    if (p.tmp || RO) return;
    var hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", p.d);
    hit.setAttribute("class", "hit");
    hit.dataset.from = p.e.from;
    hit.dataset.port = p.e.port;
    gEl.appendChild(hit);
    if (on) {
      var del = h("button", { class: "edel", title: "Remove this connection", onpointerdown: function (ev) { ev.stopPropagation(); }, onclick: function () { removeEdge(p.e.from, p.e.port); } }, "×");
      del.style.left = p.mid.x + "px";
      del.style.top = p.mid.y + "px";
      world.appendChild(del);
    }
  });
}
function setEdge(from, p, to) {
  G.edges = G.edges.filter(function (e) { return !(e.from === from && e.port === p); });
  G.edges.push({ from: from, port: p, to: to });
  changed(true);
}
function removeEdge(from, p) {
  G.edges = G.edges.filter(function (e) { return !(e.from === from && e.port === p); });
  selEdge = null;
  changed(true);
}

// ---------- view ----------
function apply() {
  world.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.z + ")";
}
function toWorld(cx, cy) { var r = vp.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z }; }
function zoomAt(cx, cy, f) {
  var r = vp.getBoundingClientRect();
  var px = cx == null ? r.width / 2 : cx - r.left, py = cy == null ? r.height / 2 : cy - r.top;
  var z = Math.min(2, Math.max(0.2, view.z * f));
  var wx = (px - view.x) / view.z, wy = (py - view.y) / view.z;
  view.z = z;
  view.x = px - wx * z;
  view.y = py - wy * z;
  apply();
}
function fit() {
  var r = vp.getBoundingClientRect(), minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  nodesEl.querySelectorAll(".nd").forEach(function (el) {
    var n = node(el.dataset.id);
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + el.offsetWidth + 30); maxY = Math.max(maxY, n.y + el.offsetHeight);
  });
  if (minX > maxX) return;
  var phone = r.width < 768, left = published() && !kmShut && !phone ? 380 : 0; // the Key metrics panel covers the left edge
  var pad = phone ? 24 : 40, w = r.width - left - 2 * pad - (phone ? 0 : 60), hh = r.height - 2 * pad - (phone ? 80 : 0);
  var W = maxX - minX, H = maxY - minY;
  // Zoomed out past readable, a long flow starts at its When... card instead (scroll or pinch for the rest).
  view.z = Math.min(1, Math.max(phone ? 0.5 : 0.3, Math.min(w / W, hh / H)));
  view.x = left + (W * view.z <= w ? pad + (w - W * view.z) / 2 - minX * view.z : pad - minX * view.z);
  view.y = H * view.z <= hh ? pad + (hh - H * view.z) / 2 - minY * view.z : pad - minY * view.z;
  apply();
}

// ---------- gestures: pan, pinch, drag cards, connect ports ----------
// Every pointer that goes down on the canvas is captured by it, so its moves and its release come back here even
// when they happen over the top bar, the panel or outside the window. A release that never arrives anyway (lost
// capture, a mouse whose buttons are already up on the next move) still ends the gesture where it was last seen.
var touches = {}, gest = null;
function count() { return Object.keys(touches).length; }
vp.addEventListener("pointerdown", function (e) {
  if (e.button > 0 || e.target.closest(".fe-zoom,.fe-help,.fe-ban,.fe-add,.fe-pn,.edel,.fe-pick")) return;
  closePicker();
  if (tmp) { tmp = null; draw(); }
  touches[e.pointerId] = { x: e.clientX, y: e.clientY };
  try { vp.setPointerCapture(e.pointerId); } catch (x) { /* synthetic or already gone */ }
  if (count() === 2) {
    var ids = Object.keys(touches), a = touches[ids[0]], b = touches[ids[1]];
    var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    gest = { type: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: view.z, w: toWorld(mid.x, mid.y) };
    tmp = null;
    draw();
    return;
  }
  if (count() > 2) return;
  var t = e.target, pt = t.closest(".pt"), nd = t.closest(".nd"), hit = t.closest("path.hit");
  var base = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY };
  if (pt && !RO) gest = Object.assign(base, { type: "connect", from: pt.dataset.n, port: pt.dataset.p, pt: pt });
  else if (nd) { var n = node(nd.dataset.id); gest = Object.assign(base, { type: "node", id: n.id, el: nd, ox: n.x, oy: n.y }); }
  else if (hit) { selEdge = { from: hit.dataset.from, port: hit.dataset.port }; draw(); gest = null; return; }
  else gest = Object.assign(base, { type: "pan", ox: view.x, oy: view.y });
  e.preventDefault();
});
function move(e) {
  if (!touches[e.pointerId]) return;
  // A mouse that moves with no button down was released somewhere we never heard about.
  if (e.pointerType === "mouse" && e.buttons === 0 && gest && gest.type !== "pinch") { up(e); return; }
  touches[e.pointerId] = { x: e.clientX, y: e.clientY };
  if (!gest) return;
  if (gest.type === "pinch") {
    if (count() < 2) return;
    var ids = Object.keys(touches), a = touches[ids[0]], b = touches[ids[1]];
    var r = vp.getBoundingClientRect(), mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    view.z = Math.min(2, Math.max(0.2, (gest.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / gest.d0));
    view.x = mid.x - gest.w.x * view.z;
    view.y = mid.y - gest.w.y * view.z;
    apply();
    return;
  }
  if (e.pointerId !== gest.pid) return;
  gest.lx = e.clientX;
  gest.ly = e.clientY;
  var dx = e.clientX - gest.sx, dy = e.clientY - gest.sy;
  if (!gest.moved && Math.hypot(dx, dy) < 5) return;
  gest.moved = true;
  if (gest.type === "pan") { vp.classList.add("panning"); view.x = gest.ox + dx; view.y = gest.oy + dy; apply(); }
  else if (gest.type === "node" && !RO) {
    var n = node(gest.id);
    n.x = Math.round(gest.ox + dx / view.z);
    n.y = Math.round(gest.oy + dy / view.z);
    gest.el.style.left = n.x + "px";
    gest.el.style.top = n.y + "px";
    draw();
  } else if (gest.type === "connect") {
    var w = toWorld(e.clientX, e.clientY);
    tmp = { from: gest.from, port: gest.port, x: w.x, y: w.y };
    draw();
  }
}
function up(e) {
  if (!touches[e.pointerId]) return;
  delete touches[e.pointerId];
  try { if (vp.hasPointerCapture(e.pointerId)) vp.releasePointerCapture(e.pointerId); } catch (x) { /* fine */ }
  vp.classList.remove("panning");
  var g = gest;
  if (g && g.type === "pinch") { if (!count()) gest = null; return; }
  if (!g || g.pid !== e.pointerId) return;
  gest = null;
  // Cancelled, or released where we can't see: the last known position counts, and a connection isn't made.
  var lost = e.type === "pointercancel" || e.type === "lostpointercapture" || (e.pointerType === "mouse" && e.type === "pointermove");
  var x = lost ? g.lx : e.clientX, y = lost ? g.ly : e.clientY;
  if (g.type === "pan" && !g.moved) { select(null); selEdge = null; draw(); }
  else if (g.type === "node") { if (g.moved) { if (!RO) changed(false); } else if (!lost) select(g.id); }
  else if (g.type === "connect") {
    tmp = null;
    draw();
    if (e.type === "pointercancel") return;
    var w = toWorld(x, y);
    if (!g.moved) { var r = g.pt.getBoundingClientRect(); openPicker(r.right + 12, r.top - 20, { x: w.x + 70, y: w.y - 30 }, { from: g.from, port: g.port }); return; }
    var over = document.elementFromPoint(x, y), nd = over && over.closest(".nd");
    if (nd && nd.dataset.id !== g.from && nd.dataset.id !== "trigger") setEdge(g.from, g.port, nd.dataset.id);
    else if (!nd && over && vp.contains(over) && !over.closest(".fe-zoom,.fe-help,.fe-ban,.fe-add,.fe-pn")) openPicker(x + 8, y - 20, { x: w.x + 20, y: w.y - 30 }, { from: g.from, port: g.port });
  }
}
window.addEventListener("pointermove", move);
window.addEventListener("pointerup", up);
window.addEventListener("pointercancel", up);
vp.addEventListener("lostpointercapture", up);
vp.addEventListener("wheel", function (e) {
  if (e.target.closest(".fe-pn,.fe-pick")) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
  else { view.x -= e.deltaX; view.y -= e.deltaY; apply(); }
}, { passive: false });
// Safari's trackpad pinch
vp.addEventListener("gesturestart", function (e) { e.preventDefault(); gest = { type: "gesture", z0: view.z }; });
vp.addEventListener("gesturechange", function (e) { e.preventDefault(); if (gest && gest.type === "gesture") zoomAt(e.clientX, e.clientY, (gest.z0 * e.scale) / view.z); });
document.addEventListener("keydown", function (e) {
  var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName);
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing && !RO) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (e.key === "Escape") { closePicker(); select(null); return; }
  if ((e.key === "Delete" || e.key === "Backspace") && !typing && !RO) {
    if (selEdge) removeEdge(selEdge.from, selEdge.port);
    else if (sel && sel !== "trigger") removeNode(sel);
  }
});

// ---------- adding steps ----------
function closePicker() { if (picker) { picker.remove(); picker = null; } }
function openPicker(cx, cy, at, link) {
  closePicker();
  var r = root.getBoundingClientRect();
  picker = h("div", { class: "fe-pick" }, Object.keys(KINDS).map(function (k) {
    return h("button", { onclick: function () { closePicker(); addNode(k, at, link); } }, [h("span", { class: "ic", icon: KINDS[k].ic }), h("div", null, [KINDS[k].t, h("small", { text: KINDS[k].d })])]);
  }));
  picker.style.left = Math.max(8, Math.min(cx - r.left, r.width - 270)) + "px";
  root.appendChild(picker);
  picker.style.top = Math.max(60, Math.min(cy - r.top, r.height - picker.offsetHeight - 8)) + "px";
}
function blank(kind) {
  switch (kind) {
    case "message": return { bubbles: [{ text: "", buttons: [] }], quick_replies: [] };
    case "delay": return { seconds: 3600 };
    case "condition": return { match: "all", rules: [{ field: "tag", op: "is", value: "" }] };
    case "action": return { actions: [{ type: "add_tag", value: "" }] };
    case "randomizer": return { variants: [{ id: rid("v"), label: "A", weight: 50 }, { id: rid("v"), label: "B", weight: 50 }] };
  }
}
function addNode(kind, at, link) {
  var n = { id: rid("n"), kind: kind, x: Math.round(at.x), y: Math.round(at.y), data: blank(kind) };
  G.nodes.push(n);
  if (link) G.edges = G.edges.filter(function (e) { return !(e.from === link.from && e.port === link.port); }).concat([{ from: link.from, port: link.port, to: n.id }]);
  sel = n.id;
  changed(true);
}
function removeNode(id) {
  G.nodes = G.nodes.filter(function (n) { return n.id !== id; });
  G.edges = G.edges.filter(function (e) { return e.from !== id && e.to !== id; });
  if (sel === id) sel = null;
  changed(true);
}
function duplicate(id) {
  var n = node(id), c = JSON.parse(JSON.stringify(n));
  c.id = rid("n"); c.x += 40; c.y += 40;
  (c.data.bubbles || []).forEach(function (b) { b.buttons.forEach(function (x) { x.id = rid("b"); }); });
  (c.data.quick_replies || []).forEach(function (q) { q.id = rid("q"); });
  (c.data.variants || []).forEach(function (v) { v.id = rid("v"); });
  G.nodes.push(c);
  sel = c.id;
  changed(true);
}
// Ports that no longer exist (a removed button) lose their edges.
function prune() {
  var ok = {};
  G.nodes.forEach(function (n) {
    var ps = ["next"];
    if (n.kind === "message") { n.data.bubbles.forEach(function (b) { b.buttons.forEach(function (x) { if (x.url === undefined) ps.push(x.id); }); }); n.data.quick_replies.forEach(function (q) { ps.push(q.id); }); }
    if (n.kind === "condition") ps = ["yes", "no"];
    if (n.kind === "randomizer") ps = n.data.variants.map(function (v) { return v.id; });
    ps.forEach(function (p) { ok[n.id + " " + p] = 1; });
  });
  G.edges = G.edges.filter(function (e) { return ok[e.from + " " + e.port] && node(e.to); });
}

// ---------- the side panel ----------
function select(id) {
  sel = id;
  nodesEl.querySelectorAll(".nd").forEach(function (el) { el.classList.toggle("sel", el.dataset.id === id); });
  renderPanel();
}
function inp(val, on, a) {
  var e = h(a && a.rows ? "textarea" : "input", Object.assign({ value: val == null ? "" : val, disabled: RO }, a || {}));
  e.addEventListener("input", function () { on(e.value); changed(false); });
  return e;
}
function pick(val, opts, on, a) {
  var e = h("select", Object.assign({ disabled: RO }, a || {}), Object.keys(opts).map(function (k) { return h("option", { value: k, selected: String(k) === String(val) }, opts[k]); }));
  e.addEventListener("change", function () { on(e.value); changed(true); });
  return e;
}
function lbl(t, extra) { return h("label", null, [t, extra || null]); }
function xBtn(on, title) { return RO ? null : h("button", { class: "x", title: title || "Remove", onclick: function () { on(); changed(true); } }, "×"); }
function more(t, on, dis) { return RO ? null : h("button", { class: "lnk", disabled: !!dis, onclick: function () { on(); changed(true); } }, t); }
function tagList() { return h("datalist", { id: "fe-tags" }, B.tags.map(function (t) { return h("option", { value: t }); })); }
function stageOpts() { var o = {}; B.stages.forEach(function (s) { o[s] = s.replace("_", " "); }); return o; }
function autoOpts() { var o = { "": "Pick an automation" }; B.automations.forEach(function (a) { if (String(a.id) !== String(B.id)) o[a.id] = a.name; }); return o; }

function triggerForm() {
  var t = G.trigger, out = [];
  out.push(lbl("When…"), pick(t.source, SRC, function (v) { if (v !== t.source) t.media_id = null; t.source = v; if (v === "mention" || v === "welcome" || v === "none") t.keyword = "*"; else if (t.keyword === "*") t.keyword = ""; }));
  if (t.source === "comment" || t.source === "dm" || t.source === "story") {
    out.push(lbl("Keywords"), inp(t.keyword === "*" && t.source !== "story" ? "*" : t.keyword, function (v) { t.keyword = v; }, { placeholder: "guide, ai   (* = anything)" }));
    out.push(h("p", { class: "hint", text: "Comma separated. Whole words, any case. * matches anything." }));
  }
  if (t.source === "comment") {
    var media = { "": "Any Post or Reel", next: "Next Post or Reel" };
    B.media.forEach(function (m) { media[m.id] = m.label; });
    if (t.media_id && !media[t.media_id]) media[t.media_id] = "Post " + t.media_id;
    out.push(lbl("Which post"), pick(t.media_id || "", media, function (v) { t.media_id = v || null; }));
    if (t.media_id === "next") out.push(h("p", { class: "hint", text: "Waits for the first post or reel you publish after this goes live, then stays on that one. Only one automation can wait for the next post at a time." }));
    out.push(lbl("Public reply under the comment (optional, one per line, picked at random)"), inp(t.public_reply || "", function (v) { t.public_reply = v || null; }, { rows: 3, placeholder: "sent 📩\ncheck your DMs" }));
    out.push(h("p", { class: "hint", text: "Instagram allows one private reply per comment: the first text of the first message goes out, and the rest of the flow waits until they tap a button or reply." }));
  }
  if (t.source === "story") {
    var up = B.stories.slice().reverse(), stories = { "": "Any Story" }; // oldest first, numbered in the order they were posted
    up.forEach(function (s, i) {
      stories[s.id] = "Story " + (i + 1) + " of " + up.length + (s.at ? " · " + new Date(s.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "") + (s.video ? " · video" : "");
    });
    if (t.media_id && !stories[t.media_id]) stories[t.media_id] = "Story " + t.media_id + " (no longer up)";
    out.push(lbl("Which story"), pick(t.media_id || "", stories, function (v) { t.media_id = v || null; }));
    var shown = up.filter(function (s) { return s.id === t.media_id && s.img; })[0];
    if (shown) out.push(h("img", { class: "story-prev", src: shown.img, alt: "" }));
    out.push(h("p", { class: "hint", text: "Stories up right now (the last 24 hours). Pick one and only replies to that story run this; keyword * runs it on any reply to it." }));
  }
  if (t.source === "welcome") out.push(h("p", { class: "hint", text: "Runs for someone's very first DM when no keyword automation matched." }));
  if (t.source === "none") out.push(h("p", { class: "hint", text: "Starts only from a quick reply, Conversation Starter, Main Menu item or another automation's Start action." }));
  return out;
}
function messageForm(n) {
  var d = n.data, out = [];
  d.bubbles.forEach(function (b, i) {
    var cnt = h("span", { class: "cnt" });
    function count() { var max = b.buttons.length ? 640 : 1000; cnt.textContent = b.text.length + " / " + max; cnt.className = "cnt" + (b.text.length > max ? " bad" : ""); }
    count();
    var ta = inp(b.text, function (v) { b.text = v; count(); }, { rows: 4, maxlength: 1000, placeholder: "yoooo what up! tap the button below and I'll send it over" });
    var g = h("div", { class: "grp" }, [
      h("div", { class: "rw" }, [lbl("Text " + (i + 1), cnt), d.bubbles.length > 1 ? xBtn(function () { d.bubbles.splice(i, 1); }, "Remove this text") : null]),
      ta,
      RO ? null : h("button", { class: "lnk", onclick: function () { var p = ta.selectionStart || ta.value.length; b.text = b.text.slice(0, p) + "{{SKOOL_LINK}}" + b.text.slice(p); renderPanel(); changed(false); } }, "+ Skool link")
    ]);
    b.buttons.forEach(function (x, j) {
      g.appendChild(h("div", { class: "rw" }, [
        inp(x.title, function (v) { x.title = v; }, { maxlength: 20, placeholder: "Button title" }),
        pick(x.url === undefined ? "next" : "url", { next: "Next step", url: "Open link" }, function (v) { if (v === "url") x.url = x.url || ""; else delete x.url; }),
        xBtn(function () { b.buttons.splice(j, 1); })
      ]));
      if (x.url !== undefined) g.appendChild(inp(x.url, function (v) { x.url = v; }, { placeholder: "https://...  or {{SKOOL_LINK}}" }));
    });
    add(g, more("+ Add button", function () { b.buttons.push({ id: rid("b"), title: "", url: undefined }); }, b.buttons.length >= 3));
    out.push(g);
  });
  out.push(more("+ Add text", function () { d.bubbles.push({ text: "", buttons: [] }); }, d.bubbles.length >= 10));
  var q = h("div", { class: "grp" }, [lbl("Quick replies"), h("p", { class: "hint", text: "Tappable chips under the last text (13 max, 20 characters). Instagram app only, not desktop. With a button on that text they show as buttons instead (3 max in all)." })]);
  d.quick_replies.forEach(function (r, j) { q.appendChild(h("div", { class: "rw" }, [inp(r.title, function (v) { r.title = v; }, { maxlength: 20, placeholder: "Yes please" }), xBtn(function () { d.quick_replies.splice(j, 1); })])); });
  add(q, more("+ Quick reply", function () { d.quick_replies.push({ id: rid("q"), title: "" }); }, d.quick_replies.length >= 13));
  out.push(q);
  out.push(h("p", { class: "hint", text: "Next-step buttons and quick replies each get their own connector on the card: drag it to whatever should happen when they tap. Next Step runs right after sending." }));
  return out;
}
function delayForm(n) {
  var d = dur(n.data.seconds), unit = d[1], val = d[0];
  function set() { n.data.seconds = Math.max(1, Math.round(Number(val) || 1)) * UNITS[unit][1]; }
  return [lbl("Wait for"), h("div", { class: "rw" }, [
    inp(val, function (v) { val = v; set(); }, { type: "number", min: 1 }),
    pick(unit, { s: "seconds", m: "minutes", h: "hours", d: "days" }, function (v) { unit = v; set(); })
  ]), h("p", { class: "hint", text: "Then the flow continues from Next Step. Cancelled if they write back meanwhile (the chat moved on), and nothing sends outside Instagram's 24h window." })];
}
function conditionForm(n) {
  var d = n.data, out = [lbl("Go to Yes when"), pick(d.match, { all: "All of these are true", any: "Any of these is true" }, function (v) { d.match = v; }), tagList()];
  d.rules.forEach(function (r, i) {
    var row = [pick(r.field, FIELDS, function (v) { r.field = v; r.value = ""; }), pick(r.op, { is: "is / yes", not: "is not / no" }, function (v) { r.op = v; })];
    var val = r.field === "stage" ? pick(r.value || "", Object.assign({ "": "Pick a stage" }, stageOpts()), function (v) { r.value = v; })
      : r.field === "tag" ? inp(r.value, function (v) { r.value = v; }, { list: "fe-tags", placeholder: "tag" })
      : r.field === "keyword" ? inp(r.value, function (v) { r.value = v; }, { placeholder: "price, cost" }) : null;
    out.push(h("div", { class: "grp" }, [h("div", { class: "rw" }, row.concat([xBtn(function () { d.rules.splice(i, 1); })])), val, r.field === "follows" ? h("p", { class: "hint", text: "Asks Instagram live. Only known after they've DM'd or tapped something, so a comment run counts as no." }) : null]));
  });
  out.push(more("+ Add condition", function () { d.rules.push({ field: "tag", op: "is", value: "" }); }, d.rules.length >= 10));
  return out;
}
function actionForm(n) {
  var d = n.data, out = [tagList()];
  d.actions.forEach(function (a, i) {
    var val = a.type === "add_tag" || a.type === "remove_tag" ? inp(a.value, function (v) { a.value = v; }, { list: "fe-tags", placeholder: "tag" })
      : a.type === "set_stage" ? pick(a.value || "", Object.assign({ "": "Pick a stage" }, stageOpts()), function (v) { a.value = v; })
      : a.type === "start_automation" ? pick(a.value || "", autoOpts(), function (v) { a.value = v; }) : null;
    out.push(h("div", { class: "grp" }, [h("div", { class: "rw" }, [pick(a.type, ACTS, function (v) { a.type = v; a.value = ""; }), xBtn(function () { d.actions.splice(i, 1); })]), val]));
  });
  out.push(more("+ Add action", function () { d.actions.push({ type: "add_tag", value: "" }); }, d.actions.length >= 10));
  out.push(h("p", { class: "hint", text: "Hand off ends the flow: the AI setter answers their next message (and is switched back on for them if it was paused)." }));
  return out;
}
function randomizerForm(n) {
  var d = n.data, out = [];
  var tot = d.variants.reduce(function (s, v) { return s + (Number(v.weight) || 0); }, 0);
  d.variants.forEach(function (v, i) {
    out.push(h("div", { class: "rw" }, [inp(v.label, function (x) { v.label = x; }, { maxlength: 30 }), inp(v.weight, function (x) { v.weight = Math.max(0, Math.min(100, Math.round(Number(x) || 0))); }, { type: "number", min: 0, max: 100 }), d.variants.length > 2 ? xBtn(function () { d.variants.splice(i, 1); }) : null]));
  });
  out.push(h("p", { class: "hint", text: "Weights out of " + tot + ". Each variant gets its own connector." }));
  out.push(more("+ Add variant", function () { d.variants.push({ id: rid("v"), label: String.fromCharCode(65 + d.variants.length), weight: 50 }); }, d.variants.length >= 6));
  return out;
}
function renderPanel() {
  var n = sel && node(sel);
  panel.hidden = !n;
  panel.innerHTML = "";
  if (!n) return;
  var k = n.kind === "trigger" ? { t: "When…", ic: "bolt" } : KINDS[n.kind];
  var body = n.kind === "trigger" ? triggerForm() : n.kind === "message" ? messageForm(n) : n.kind === "delay" ? delayForm(n) : n.kind === "condition" ? conditionForm(n) : n.kind === "action" ? actionForm(n) : randomizerForm(n);
  add(panel, [
    h("div", { class: "ph" }, [h("span", { class: "ic", icon: k.ic }), k.t, h("button", { class: "x", title: "Close", onclick: function () { select(null); } }, "×")]),
    h("div", { class: "pb" }, body),
    RO || n.kind === "trigger" ? null : h("div", { class: "foot" }, [
      h("button", { class: "ghost", onclick: function () { duplicate(n.id); } }, "Duplicate"),
      h("button", { class: "dz", onclick: function () { removeNode(n.id); } }, "Delete step")
    ])
  ]);
}

// ---------- changes, undo, autosave, publish ----------
function changed(structural) {
  if (RO) return;
  if (structural) { prune(); renderNodes(); renderPanel(); } else renderNodes();
  problems = [];
  renderProblems();
  clearTimeout(snapT);
  snapT = setTimeout(snapshot, structural ? 0 : 600);
  dirty = true;
  queueSave();
}
function snapshot() {
  var now = JSON.stringify(G);
  if (now === lastSnap) return;
  undoStack.push(lastSnap);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  lastSnap = now;
}
function restore(json) { G = JSON.parse(json); lastSnap = json; if (sel && !node(sel)) sel = null; selEdge = null; renderNodes(); renderPanel(); dirty = true; queueSave(); }
function undo() { clearTimeout(snapT); snapshot(); if (!undoStack.length) return; redoStack.push(lastSnap); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(lastSnap); restore(redoStack.pop()); }
function queueSave() { clearTimeout(saveT); saveT = setTimeout(save, 800); if (saveState !== "saving") { saveState = "pending"; renderTop(); } }
function api(path, body) {
  return fetch("/admin/flows/" + B.id + "/" + path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body || {}) })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.httpOk = r.ok; return j; }); });
}
function save() {
  if (saving) { queueSave(); return Promise.resolve(); }
  saving = true;
  saveState = "saving";
  renderTop();
  return api("draft", { graph: G }).then(function (j) {
    saving = false;
    saveState = j.httpOk ? "saved" : "error";
    if (!j.httpOk) saveT = setTimeout(save, 4000);
    renderTop();
  }, function () { saving = false; saveState = "error"; saveT = setTimeout(save, 4000); renderTop(); });
}
function publish() {
  clearTimeout(saveT);
  api("publish", { graph: G }).then(function (j) {
    if (!j.httpOk) { problems = j.problems || ["Publishing failed. Try again."]; renderProblems(); return; }
    status = "live"; dirty = false; saveState = "saved"; problems = [];
    showPublished();
  });
}
function discard() {
  if (!confirm("Throw away the unpublished changes and go back to the live version?")) return;
  clearTimeout(saveT);
  api("discard").then(function () { location.reload(); });
}
function toggleLive() { api("toggle").then(function (j) { if (j.status) { status = j.status; renderTop(); } }); }
function postForm(action) { var f = h("form", { method: "post", action: action }); document.body.appendChild(f); f.submit(); }
window.addEventListener("beforeunload", function (e) { if (saveState === "pending" || saveState === "saving") { save(); e.preventDefault(); } });

renderTop();
renderChrome();
renderNodes();
requestAnimationFrame(function () { fit(); draw(); });
window.addEventListener("resize", function () { draw(); });
})();`;
