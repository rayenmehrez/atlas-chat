// How the Inbox thread draws a message, Instagram-style: photos and GIFs inline, video players, voice-note bubbles
// with the transcript under them, file chips, post/reel cards, story replies and mentions, reactions, unsent
// messages, our buttons. Media comes through /admin/media (src/attachments.ts) and lazy-loads; anything that can't
// be fetched falls back to a plain label. Every string from a message is escaped.

import { esc } from "./admin";
import { asEmoji } from "./meta";
import { inferParts, isPermalink, partsOf, splitText, tagType, threadLink, wantsMedia, type MediaRow, type Part, type Resolved } from "./attachments";

const LABEL: Record<Part["type"], [preview: string, gone: string]> = {
  image: ["Sent a photo", "Photo unavailable"],
  gif: ["Sent a GIF", "GIF unavailable"],
  sticker: ["Sent a sticker", "Sticker unavailable"],
  video: ["Sent a video", "Video unavailable"],
  audio: ["Sent a voice message", "Voice message unavailable"],
  file: ["Sent a file", "File unavailable"],
  post: ["Shared a post", "Post unavailable"],
  reel: ["Shared a reel", "Reel unavailable"],
  story_reply: ["Replied to your story", "Story unavailable"],
  story_mention: ["Mentioned you in their story", "Story unavailable"],
  story_share: ["Shared a story", "Story unavailable"],
  like: ["Sent a heart", ""],
  card: ["Sent a card", ""],
  unsupported: ["Sent an attachment", "This message can't be shown here. Open Instagram to see it."],
};

// The conversation list's one-liner: what Instagram's own inbox would say.
export function previewText(text: string): string {
  const s = splitText(text);
  const first = s.tags[0] ? tagType(s.tags[0].tag) : null;
  if (first === "unsent") return "Unsent a message";
  if (first === "tapped") return s.text;
  if (first === "story_prefix") return "Replied to your story";
  if (first === "attachment") return s.text || "Sent an attachment";
  if (first) return LABEL[first][0];
  return s.text || text;
}

const ICON = {
  play: '<svg class="pl" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/></svg><svg class="pa" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  file: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  ig: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/></svg>',
  reel: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M3 8h18M8 3l3 5M14 3l3 5"/><path d="m10 11.5 4.5 2.5-4.5 2.5z" fill="currentColor"/></svg>',
};

// A fake waveform, stable per message.
function bars(seed: number): string {
  let x = seed || 7;
  return Array.from({ length: 28 }, () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return `<i style="height:${30 + (x % 70)}%"></i>`;
  }).join("");
}

function reactionsOf(m: MediaRow, r: Resolved | undefined): string[] {
  const out = new Set<string>();
  try {
    for (const v of Object.values(JSON.parse(m.reactions ?? "{}") as Record<string, string>)) if (typeof v === "string" && v) out.add(v);
  } catch {
    // ignore a bad row
  }
  for (const e of r?.reactions ?? []) out.add(e);
  return [...new Set([...out].map(asEmoji))].slice(0, 4);
}

// "Guide (https://...)" -> a button that opens the link; anything else a plain button label.
function button(label: string): string {
  const m = label.match(/^(.*) \((https?:\/\/[^\s)]+)\)$/);
  return m
    ? `<a class="mx-btn" href="${esc(m[2])}" target="_blank" rel="noopener noreferrer">${esc(m[1])}</a>`
    : `<span class="mx-btn">${esc(label)}</span>`;
}

export function messageHtml(m: MediaRow, r: Resolved | undefined, tail = "", acts = ""): string {
  const s = splitText(m.text);
  const first = s.tags[0] ? tagType(s.tags[0].tag) : null;
  if (m.unsent_at || first === "unsent") return `<div class="m ${m.role} unsent">Unsent a message${tail}</div>`;
  const live = wantsMedia(m); // has a mid the proxy can resolve
  const parts = live ? partsOf(m, r) : inferParts(s);
  const rx = reactionsOf(m, r);
  const plain = !parts.length && !s.buttons.length && !rx.length && !m.edited_at && first !== "tapped" && first !== "attachment";
  if (plain) return `<div class="m ${m.role}">${esc(m.text)}${tail}${acts}</div>`;

  // Resolved and Instagram says there's nothing: labels straight away, no requests that would 404.
  const dead = Boolean(r && !r.parts.length);
  const src = (n: number, thumb = false) => `/admin/media/${m.id}/${n}${thumb ? "/thumb" : ""}`;
  // Transcripts and descriptions ride on the tags, in order per kind.
  const notes = { audio: [] as (string | null)[], image: [] as (string | null)[] };
  for (const t of s.tags) {
    const k = tagType(t.tag);
    if (k === "audio" || k === "image") notes[k].push(t.note);
  }
  const gone = (p: Part) => `<div class="mx-gone">${esc(LABEL[p.type][1])}</div>`;
  const can = (p: Part) => live && !dead && (!r || Boolean(p.url || p.preview));

  const blocks: string[] = [];
  let story = "";
  parts.forEach((p, n) => {
    const note = (p.type === "audio" ? notes.audio.shift() : p.type === "image" || p.type === "gif" || p.type === "sticker" ? notes.image.shift() : null) ?? null;
    switch (p.type) {
      case "image":
      case "gif":
      case "sticker":
        blocks.push(
          can(p)
            ? `<div class="mx${p.type === "sticker" ? " stk" : ""}"><a class="mx-img" href="${src(n)}" target="_blank" onclick="return lb(this)"><img src="${src(n)}" loading="lazy" decoding="async" alt="${esc(note ?? LABEL[p.type][0].replace("Sent a ", ""))}" onerror="mf(this)"></a>${gone(p)}</div>`
            : `<div class="mx gone">${gone(p)}</div>`,
        );
        break;
      case "video":
        blocks.push(
          can(p)
            ? `<div class="mx"><video class="mx-vid" controls playsinline preload="${p.preview ? "none" : "metadata"}" data-src="${src(n)}"${p.preview ? ` poster="${src(n, true)}"` : ""} onerror="mf(this)"></video>${gone(p)}</div>`
            : `<div class="mx gone">${gone(p)}</div>`,
        );
        break;
      case "audio":
        blocks.push(
          `<div class="mx vn${can(p) ? "" : " gone"}">${
            can(p)
              ? `<button type="button" class="vn-b" onclick="vn(this)" aria-label="Play voice message">${ICON.play}</button><span class="vn-w">${bars(m.id)}</span><span class="vn-t">0:00</span><audio preload="metadata" data-src="${src(n)}" onerror="mf(this)"></audio>`
              : ""
          }${gone(p)}</div>${note ? `<div class="vn-x">${esc(note)}</div>` : ""}`,
        );
        break;
      case "file":
        blocks.push(
          can(p)
            ? `<a class="mx-file" href="${src(n)}?dl=1">${ICON.file}<span><b>${esc(p.title || "File")}</b><small>Download</small></span></a>`
            : `<div class="mx-file off">${ICON.file}<span><b>${esc(p.title || "File")}</b><small>Unavailable</small></span></div>`,
        );
        break;
      case "post":
      case "reel": {
        const head = `<div class="mx-ch">${p.type === "reel" ? ICON.reel : ICON.ig}<b>${p.author ? `@${esc(p.author)}` : p.type === "reel" ? "Reel" : "Post"}</b></div>`;
        // Tapping the card opens it on Instagram, never the raw media: reels and the owner's own posts have their link;
        // other people's posts come as a bare image with no link the API will give, so those open the chat they're in.
        const link = isPermalink(p.link) ? p.link! : null;
        const chat = link ? null : threadLink(m.mid);
        const href = link ?? chat;
        const thumb = can(p)
          ? `<div class="mx mx-th${p.type === "reel" ? " tall" : ""}"><img src="${src(n, true)}" loading="lazy" alt=""${p.type === "reel" || p.url ? ` data-v="${src(n)}"` : ""} onerror="mf(this)">${gone(p)}</div>`
          : href
            ? `<div class="mx-open">${link ? "View on Instagram" : "Open chat on Instagram"} ↗</div>`
            : `<div class="mx mx-th gone">${gone(p)}</div>`;
        const cap = p.title ? `<div class="mx-cap">${esc(p.title.slice(0, 180))}</div>` : "";
        const inner = `${head}${thumb}${cap}`;
        const tip = chat ? ` title="Opens this chat on Instagram (Instagram doesn't share links to other people's posts)"` : "";
        blocks.push(href ? `<a class="mx-card" href="${esc(href)}" target="_blank" rel="noopener noreferrer"${tip}>${inner}</a>` : `<div class="mx-card">${inner}</div>`);
        break;
      }
      case "story_reply":
        story = `<div class="mx-story"><small>${m.role === "lead" ? "Replied to your story" : "You replied to their story"}</small>${
          can(p)
            ? `<div class="mx mx-sth"><img src="${src(n, true)}" loading="lazy" alt="Story" data-v="${src(n)}" onerror="mf(this)">${gone(p)}</div>`
            : `<div class="mx mx-sth gone">${gone(p)}</div>`
        }</div>`;
        break;
      case "story_mention":
      case "story_share":
        blocks.push(
          `<div class="mx-card story"><div class="mx-ch">${ICON.ig}<b>${LABEL[p.type][0]}</b></div>${
            can(p)
              ? `<div class="mx mx-sth"><img src="${src(n, true)}" loading="lazy" alt="Story" data-v="${src(n)}" onerror="mf(this)">${gone(p)}</div>`
              : `<div class="mx mx-sth gone">${gone(p)}</div>`
          }</div>`,
        );
        break;
      case "like":
        blocks.push(`<div class="mx-like" role="img" aria-label="Heart">❤️</div>`);
        break;
      case "card":
        // A button card, drawn like our own flow sends: optional image, the text, then its buttons.
        blocks.push(
          `<div class="mx-tpl">${p.preview ? `<img class="mx-tpl-img" src="${esc(p.preview)}" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.remove()">` : ""}${
            p.title ? `<div class="t">${esc(p.title)}</div>` : ""
          }${(p.buttons ?? []).map(button).join("")}</div>`,
        );
        break;
      default:
        blocks.push(`<div class="bb muted">${esc(LABEL.unsupported[1])}</div>`);
    }
  });
  if (first === "attachment" && !parts.length) blocks.push(`<div class="bb muted">Sent an attachment</div>`);
  if (first === "tapped") blocks.push(`<div class="bb"><small class="tap">Tapped</small>${esc(s.text)}</div>`);
  else if (s.buttons.length) blocks.push(`<div class="mx-tpl">${s.text ? `<div class="t">${esc(s.text)}</div>` : ""}${s.buttons.map(button).join("")}</div>`);
  else if (s.text) blocks.push(`<div class="bb">${esc(s.text)}</div>`);
  const meta = m.edited_at ? `<span class="mx-ed">Edited</span>` : "";
  const badge = rx.length ? `<span class="rx">${rx.map(esc).join("")}</span>` : "";
  return `<div class="m ${m.role} rich${rx.length ? " has-rx" : ""}">${meta}${story}${blocks.join("")}${badge}${tail}${acts}</div>`;
}

// Styles and the few lines of script the thread needs (lightbox, lazy media, voice-note player, fallbacks).
// IG's hover row on a message: react, reply, more (time + copy). Only messages Instagram knows (a mid) get one.
const svg = (d: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export function actsHtml(m: { mid: string | null; created_at: number; role: string }): string {
  if (!m.mid) return "";
  return `<span class="acts" data-mid="${esc(m.mid)}" data-t="${m.created_at}">
<button type="button" onclick="rxPick(this)" title="React" aria-label="React">${svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/><path d="M9 9.5h.01M15 9.5h.01"/>')}</button>
<button type="button" onclick="rp(this)" title="Reply" aria-label="Reply">${svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>')}</button>
<button type="button" onclick="more(this)" title="More" aria-label="More">${svg('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>')}</button></span>`;
}

// IG's swipe-to-reply, drawn above the reply: who answered whom, over a dimmed copy of the message it answers. Tapping
// the copy scrolls to the original. `orig` is null when that message isn't in our history (older than the import).
type Quoted = Pick<MediaRow, "role" | "text" | "unsent_at">;
export function quoteHtml(m: Pick<MediaRow, "role" | "reply_to">, orig: Quoted | null, name: string): string {
  if (!m.reply_to) return "";
  const toLead = orig ? orig.role === "lead" : null;
  const label = m.role === "bot" ? (toLead === false ? "You replied to yourself" : "You replied") : toLead ? `${name} replied to themself` : `${name} replied to you`;
  const unsent = Boolean(orig && (orig.unsent_at || splitText(orig.text).tags.some((t) => tagType(t.tag) === "unsent")));
  const body = !orig ? "Message unavailable" : unsent ? "Unsent message" : previewText(orig.text).replace(/^Sent an? (.)/, (_, c: string) => c.toUpperCase());
  return `<div class="rq ${m.role}${!orig || unsent ? " gone" : ""}"><small>${esc(label)}</small><button type="button" class="rq-b" data-to="${esc(m.reply_to)}" onclick="rqj(this)">${esc(body)}</button></div>`;
}

export const THREAD_ASSETS = `<style>
.m{position:relative}
.rq{display:flex;flex-direction:column;max-width:min(560px,70%);margin:8px 0 -6px}
.rq.bot{align-self:flex-end;align-items:flex-end}.rq.lead{align-self:flex-start;align-items:flex-start;margin-left:36px}
.rq small{font-size:12px;line-height:16px;color:var(--mut);padding:0 12px 4px}
.rq-b{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;max-width:100%;margin:0;padding:8px 12px 14px;border:0;border-radius:18px;background:var(--soft);color:var(--mut);font:inherit;font-size:14px;line-height:18px;text-align:left;white-space:pre-wrap;word-break:break-word;cursor:pointer}
.rq-b:hover{color:var(--ink)}
.rq.gone .rq-b{font-style:italic;cursor:default}.rq.gone .rq-b:hover{color:var(--mut)}
.rq+.m{z-index:1}
.m.flash{animation:mflash 1.4s ease-out}
@keyframes mflash{0%,35%{filter:brightness(1.4)}100%{filter:none}}
.acts{position:absolute;top:50%;transform:translateY(-50%);display:none;gap:2px;white-space:nowrap}
.m.lead .acts{left:100%;padding-left:6px}.m.bot .acts{right:100%;padding-right:6px}
.m:hover .acts,.acts.open{display:flex}
.acts button{display:grid;place-items:center;width:28px;height:28px;padding:0;margin:0;border-radius:50%;background:none;color:var(--mut);border:0;cursor:pointer}
.acts button:hover{background:var(--hover);color:var(--ink)}
.pop{position:absolute;z-index:20;bottom:calc(100% + 4px);background:var(--bg);border:1px solid var(--line);border-radius:14px;box-shadow:0 4px 18px rgba(0,0,0,.25);white-space:nowrap;color:var(--ink);font-size:14px;line-height:18px}
.m.lead .pop{left:0}.m.bot .pop{right:0}
.pop button{background:none;border:0;margin:0;padding:0;color:inherit;cursor:pointer;font:inherit}
.pop button:hover{background:var(--hover)}
.pop.rxs{display:flex;gap:2px;padding:4px 6px;border-radius:999px}
.pop.rxs button{width:36px;height:36px;font-size:22px;border-radius:50%}
.pop.menu{min-width:180px;padding:6px 0}
.pop.menu .tm{padding:6px 14px 8px;color:var(--mut);font-size:12px;border-bottom:1px solid var(--line);margin-bottom:4px}
.pop.menu button{display:flex;width:100%;height:auto;padding:9px 14px;border-radius:0;justify-content:flex-start;color:var(--ink);font-size:14px}
.compose [hidden]{display:none!important}
.rpbar{display:flex;align-items:center;gap:12px;margin:-16px -16px 12px;padding:16px 16px 4px;border-top:1px solid var(--line)}
.rpbar .rp-t{flex:1;min-width:0}
.rpbar .rp-to{font-size:13px;line-height:16px;color:var(--ink)}
.rpbar .rp-q{font-size:12px;line-height:16px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rpbar button{display:grid;place-items:center;width:24px;height:24px;padding:0;margin:0;border:0;background:none;color:var(--ink);cursor:pointer}
.m.bot .acts{flex-direction:row-reverse}
.m.pending{opacity:.55}
.m.typing{display:flex;gap:4px;align-items:center;padding:14px 14px}.m.typing i{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.4;animation:tdot 1.2s infinite}
.m.typing i:nth-child(2){animation-delay:.15s}.m.typing i:nth-child(3){animation-delay:.3s}
@keyframes tdot{0%,60%,100%{opacity:.35;transform:none}30%{opacity:1;transform:translateY(-3px)}}
.emo{position:absolute;left:16px;bottom:calc(100% - 8px);z-index:20;display:grid;grid-template-columns:repeat(8,36px);gap:2px;padding:8px;background:var(--bg);border:1px solid var(--line);border-radius:14px;box-shadow:0 4px 18px rgba(0,0,0,.25)}
.emo button{width:36px;height:36px;padding:0;margin:0;border:0;border-radius:8px;background:none;font-size:22px;cursor:pointer}
.emo button:hover{background:var(--hover)}
.m.rich{background:none;padding:0;display:flex;flex-direction:column;gap:4px;white-space:normal}
.m.lead.rich{align-items:flex-start}.m.bot.rich{align-items:flex-end}
.m.rich .bb{padding:8px 12px;border-radius:22px;white-space:pre-wrap;max-width:100%}
.m.lead.rich .bb{background:var(--soft);color:var(--ink)}.m.bot.rich .bb{background:var(--out);color:#fff}
.m.rich .bb.muted{font-style:italic;opacity:.8}
.m.rich .tap{display:block;font-size:11px;opacity:.7;margin-bottom:2px}
.m.unsent{background:none!important;border:1px solid var(--line);color:var(--mut)!important;font-style:italic}
.mx{position:relative;max-width:240px}
.mx-img{display:block;opacity:1}
.mx-img img{display:block;max-width:240px;max-height:320px;min-width:80px;min-height:60px;border-radius:18px;object-fit:cover;background:var(--soft)}
.mx.stk .mx-img img{max-width:140px;max-height:140px;background:none;border-radius:0}
.mx-vid{display:block;width:240px;max-height:360px;border-radius:18px;background:#000}
.mx-gone{display:none;padding:10px 14px;border-radius:18px;border:1px solid var(--line);color:var(--mut);font-size:13px;line-height:18px}
.mx.gone>*:not(.mx-gone){display:none!important}.mx.gone>.mx-gone{display:block}
.vn{display:flex;align-items:center;gap:10px;padding:8px 14px 8px 8px;border-radius:22px;width:240px;max-width:100%}
.m.lead .vn{background:var(--soft);color:var(--ink)}.m.bot .vn{background:var(--out);color:#fff}
.vn.gone{padding:0;background:none!important;width:auto}
.vn-b{flex:none;display:grid;place-items:center;width:36px;height:36px;margin:0;padding:0;border-radius:50%;border:0;background:none;color:inherit;cursor:pointer}
.vn-b:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
.vn-b .pa,.vn.on .vn-b .pl{display:none}.vn.on .vn-b .pa{display:block}
.vn-w{flex:1;display:flex;align-items:center;gap:2px;height:28px;--p:0}
.vn-w i{flex:1;border-radius:2px;background:currentColor;opacity:.35}
.vn-t{flex:none;font-size:12px;font-variant-numeric:tabular-nums;opacity:.85;min-width:30px;text-align:right}
.vn-x{max-width:240px;padding:0 6px;color:var(--mut);font-size:13px;line-height:18px;white-space:pre-wrap}
.mx-file,.m.rich a.mx-file{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:18px;border:1px solid var(--line);color:var(--ink);text-decoration:none;max-width:260px;opacity:1}
.mx-file:hover{background:var(--hover)}
.mx-file span{display:flex;flex-direction:column;min-width:0}.mx-file b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mx-file small{color:var(--pri);font-size:12px}.mx-file.off small{color:var(--mut)}
.mx-card,.m.rich a.mx-card{display:flex;flex-direction:column;width:240px;border-radius:18px;overflow:hidden;background:var(--soft);color:var(--ink);opacity:1;text-decoration:none!important}
.mx-ch{display:flex;align-items:center;gap:8px;padding:10px 12px;font-size:13px}
.mx-ch b{font-weight:600}
.mx-th{max-width:none}
.mx-th img,.mx-th video{display:block;width:100%;aspect-ratio:1;object-fit:cover;background:var(--line)}
.mx-th.tall img,.mx-th.tall video{aspect-ratio:9/16;max-height:340px}
.mx-th .mx-gone{border:0;border-radius:0;padding:24px 12px;text-align:center}
.mx-cap{padding:0 12px;margin:8px 0 12px;font-size:13px;line-height:17px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal}
.mx-story{display:flex;flex-direction:column;gap:4px;padding-left:10px;border-left:3px solid var(--line)}
.m.bot .mx-story{align-items:flex-end;border-left:0;border-right:3px solid var(--line);padding:0 10px 0 0}
.mx-story small{color:var(--mut);font-size:12px}
.mx-sth{width:110px}
.mx-sth img,.mx-sth video{display:block;width:110px;aspect-ratio:9/16;object-fit:cover;border-radius:12px;background:var(--soft)}
.mx-card.story{width:180px}.mx-card.story .mx-sth{width:auto;padding:0 10px 10px}.mx-card.story .mx-sth img,.mx-card.story .mx-sth video{width:100%}
.mx-sth .mx-gone{font-size:12px}
.mx-like{font-size:44px;line-height:52px}
.mx-tpl{display:flex;flex-direction:column;width:260px;max-width:100%;border-radius:18px;overflow:hidden;border:1px solid var(--line);background:var(--bg)}
.mx-tpl .t{padding:10px 14px;white-space:pre-wrap;color:var(--ink)}
.mx-tpl-img{display:block;width:100%;max-height:260px;object-fit:cover}
.mx-open{padding:10px 14px 12px;color:var(--pri);font-weight:600;font-size:13px}
.mx-btn,.m.rich a.mx-btn{display:block;padding:10px 14px;text-align:center;border-top:1px solid var(--line);color:var(--pri);font-weight:600;opacity:1;text-decoration:none!important}
.mx-ed{font-size:11px;color:var(--mut);padding:0 6px}
.m.has-rx{position:relative;margin-bottom:14px}
.rx{position:absolute;bottom:-14px;display:flex;gap:1px;padding:1px 5px;border-radius:12px;background:var(--soft);border:2px solid var(--bg);font-size:13px;line-height:18px}
.m.lead .rx{left:10px}.m.bot .rx{right:10px}
.lb{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:rgba(0,0,0,.88);cursor:zoom-out;padding:16px}
.lb img{max-width:100%;max-height:100%;border-radius:8px}
</style>
<script>
function lb(a){var d=document.createElement("div");d.className="lb";var i=document.createElement("img");i.src=a.getAttribute("href");d.appendChild(i);
d.onclick=function(){d.remove()};document.addEventListener("keydown",function k(e){if(e.key==="Escape"){d.remove();document.removeEventListener("keydown",k)}});document.body.appendChild(d);return false}
function mf(el){var v=el.dataset&&el.dataset.v;if(el.tagName==="IMG"&&v){var x=document.createElement("video");x.muted=true;x.playsInline=true;x.preload="metadata";
x.onerror=function(){mf(x)};x.src=v+"#t=0.1";el.replaceWith(x);return}var w=el.closest(".mx");if(w)w.classList.add("gone")}
function shut(){document.querySelectorAll(".pop").forEach(function(p){p.remove()});document.querySelectorAll(".acts.open").forEach(function(a){a.classList.remove("open")})}
function txt(b){var m=b.closest(".m").cloneNode(true);m.querySelectorAll(".acts,.rx,.av,.pop").forEach(function(x){x.remove()});return m.textContent.trim()}
function pop(b,cls,html){var open=b.parentNode.querySelector(".pop."+cls);shut();if(open)return null;var p=document.createElement("div");p.className="pop "+cls;p.innerHTML=html;
b.closest(".m").appendChild(p);b.parentNode.classList.add("open");return p}
function rxPick(b){var p=pop(b,"rxs",["\u2764\ufe0f","\ud83d\ude02","\ud83d\ude2e","\ud83d\ude22","\ud83d\ude21","\ud83d\udc4d"].map(function(e){return '<button type="button">'+e+"</button>"}).join(""));
if(!p)return;var mid=b.parentNode.dataset.mid;p.querySelectorAll("button").forEach(function(x){x.onclick=function(){var f=document.getElementById("rxf");f.mid.value=mid;f.emoji.value=x.textContent;f.submit()}})}
function rp(b){shut();var bar=document.querySelector(".rpbar"),f=document.querySelector(".cbox");if(!bar||!f||!f.reply_to)return;f.reply_to.value=b.parentNode.dataset.mid;
var lead=b.closest(".m").classList.contains("lead");bar.querySelector(".rp-to").innerHTML="Replying to <b></b>";bar.querySelector(".rp-to b").textContent=lead?bar.dataset.name:"yourself";
bar.querySelector(".rp-q").textContent=txt(b);bar.hidden=false;var t=f.querySelector("textarea");if(t)t.focus()}
function unrp(){var bar=document.querySelector(".rpbar"),f=document.querySelector(".cbox");if(f&&f.reply_to)f.reply_to.value="";if(bar)bar.hidden=true}
function rqj(b){var to=b.dataset.to,a=null;document.querySelectorAll(".acts[data-mid]").forEach(function(x){if(x.dataset.mid===to)a=x});var m=a&&a.closest(".m");if(!m)return;
m.scrollIntoView({block:"center",behavior:"smooth"});m.classList.remove("flash");void m.offsetWidth;m.classList.add("flash")}
// The message box: Enter sends, Shift+Enter is a new line, the box grows to 160px. Sending shows the bubble right away,
// then swaps in the thread as the server has it (or shows why it didn't send).
function cgrow(t){t.style.height="18px";t.style.height=Math.min(t.scrollHeight,160)+"px"}
function ckey(e,t){if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(t.value.trim())t.form.requestSubmit()}}
function csend(f){var t=f.querySelector("textarea"),v=t.value.trim();if(!v)return false;var box=document.querySelector(".msgs"),fd=new FormData(f);
var p=document.createElement("div");p.className="m bot pending";p.textContent=v;box.appendChild(p);box.scrollTop=box.scrollHeight;t.value="";cgrow(t);unrp();t.focus();
fetch(f.action,{method:"POST",body:fd}).then(function(r){return r.text()}).then(function(h){var d=new DOMParser().parseFromString(h,"text/html"),nm=d.querySelector(".msgs"),er=d.querySelector(".ib-thread .err"),old=document.querySelector(".ib-thread .err");
if(old)old.remove();if(nm){box.innerHTML=nm.innerHTML;fmtTimes(box);box.scrollTop=box.scrollHeight}if(er){box.parentNode.insertBefore(er,box);if(!nm)p.remove()}}).catch(function(){p.classList.remove("pending");p.style.outline="1px solid var(--red)";p.title="Not sent: network error"});return false}
function emo(b){var open=document.querySelector(".emo");if(open){open.remove();return}var p=document.createElement("div");p.className="emo";
["😂","❤️","🔥","🙏","😭","👀","💯","🙌","😅","👍","🤝","💪","🎉","😎","🤔","😍","🫡","🚀","✅","👇","😤","🥲","😮","😢","😡","👏","💸","📈","🤯","😁","🙂","🤣"].forEach(function(e){var x=document.createElement("button");x.type="button";x.textContent=e;
x.onclick=function(){var t=document.querySelector(".cbox textarea"),s=t.selectionStart||t.value.length;t.value=t.value.slice(0,s)+e+t.value.slice(t.selectionEnd||s);t.focus();t.selectionStart=t.selectionEnd=s+e.length;cgrow(t)};p.appendChild(x)});
b.closest(".compose").appendChild(p)}
document.addEventListener("click",function(e){if(!e.target.closest(".emo,.c-emo")){var o=document.querySelector(".emo");if(o)o.remove()}});
function more(b){var d=new Date(+b.parentNode.dataset.t);var p=pop(b,"menu",'<div class="tm">'+d.toLocaleString([],{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+'</div><button type="button">Copy</button>');
if(!p)return;var t=txt(b);p.querySelector("button").onclick=function(){navigator.clipboard.writeText(t);shut()}}
document.addEventListener("click",function(e){if(!e.target.closest(".acts,.pop"))shut()});
document.addEventListener("keydown",function(e){if(e.key==="Escape")shut()});
function fmt(s){s=Math.max(0,Math.round(s||0));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")}
function vn(b){var w=b.closest(".vn"),a=w.querySelector("audio");if(!a.src&&a.dataset.src)a.src=a.dataset.src;
document.querySelectorAll(".vn.on audio").forEach(function(o){if(o!==a)o.pause()});if(a.paused)a.play().catch(function(){mf(a)});else a.pause()}
document.addEventListener("DOMContentLoaded",function(){var box=document.querySelector(".msgs");if(box)initMsgs(box)});
// Voice notes, lazy media, stick-to-bottom: on load and again whenever live updates swap in new messages.
function initMsgs(box){
var stick=function(){if(box.scrollHeight-box.scrollTop-box.clientHeight<400)box.scrollTop=box.scrollHeight};
box.querySelectorAll("img").forEach(function(i){if(!i.complete)i.addEventListener("load",stick)});
box.querySelectorAll(".vn audio").forEach(function(a){var w=a.closest(".vn"),t=w.querySelector(".vn-t"),bs=w.querySelectorAll(".vn-w i");
a.addEventListener("loadedmetadata",function(){if(isFinite(a.duration))t.textContent=fmt(a.duration)});
a.addEventListener("play",function(){w.classList.add("on")});a.addEventListener("pause",function(){w.classList.remove("on")});
a.addEventListener("timeupdate",function(){var p=a.duration?a.currentTime/a.duration:0;t.textContent=fmt(a.currentTime);bs.forEach(function(b,k){b.style.opacity=k/bs.length<p?1:.35})});
a.addEventListener("ended",function(){t.textContent=fmt(a.duration);bs.forEach(function(b){b.style.opacity=.35})})});
var lazy=box.querySelectorAll("[data-src]");var load=function(el){if(!el.getAttribute("src"))el.src=el.dataset.src};
if(!("IntersectionObserver" in window)){lazy.forEach(load);return}
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.querySelectorAll("[data-src]").forEach(load);io.unobserve(e.target)}})},{root:box,rootMargin:"600px 0px"});
lazy.forEach(function(el){io.observe(el.closest(".mx")||el.parentNode)})}
</script>`;
