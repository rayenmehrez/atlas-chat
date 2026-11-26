#!/usr/bin/env node
// fc: run AtlasChat's automations from the terminal. Writes go through the console's own endpoints (same validation as
// the editor), signed in with ADMIN_PASSWORD from .env; lists read D1 through wrangler. The Worker's address is ORIGIN
// in src/brand.ts (FEWCHAT_URL in .env overrides it).
//
//   node scripts/fc.mjs list                      every automation (add --all to include Trash)
//   node scripts/fc.mjs show <id> [--json]        trigger, messages, key metrics (--json: the whole graph)
//   node scripts/fc.mjs posts                     recent posts and reels with their ids
//   node scripts/fc.mjs comments [<media id>]     latest comments and what happened to each
//   node scripts/fc.mjs copy <id> [options]       duplicate as a draft; with --publish it goes live
//   node scripts/fc.mjs set <id> [options]        change the trigger; saved as a draft unless --publish
//   node scripts/fc.mjs publish <id>              publish the current draft
//   node scripts/fc.mjs on|off <id>               switch a published automation on or off
//   node scripts/fc.mjs test <id>                 a 3-digit code: DM it to the account to run the automation on you
//   node scripts/fc.mjs trash <id>                move it to Trash (restore from the console's Trash tab)
//
// Options for copy / set: --post next|any|<media id>  --keyword "A,B"  --name "..."  --replies "one|two|three"  --publish
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const readFileOr = (f) => { try { return readFileSync(root + f, "utf8"); } catch { return ""; } };
const env = { ...Object.fromEntries(readFileOr(".env").split("\n").map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")])), ...process.env };
const BASE = (env.FEWCHAT_URL ?? readFileOr("src/brand.ts").match(/ORIGIN\s*=\s*"([^"]+)"/)?.[1] ?? "").replace(/\/$/, "");
const DB = readFileOr("wrangler.jsonc").match(/"database_name"\s*:\s*"([^"]+)"/)?.[1];
const die = (msg) => (console.error(msg), process.exit(1));
if (!/^https:\/\/[^<]+$/.test(BASE) || BASE.includes("REPLACE") || !env.ADMIN_PASSWORD || !DB) die("Finish setup first: needs ORIGIN in src/brand.ts (or FEWCHAT_URL in .env), ADMIN_PASSWORD in .env and the D1 database in wrangler.jsonc");

const [cmd, ...rest] = process.argv.slice(2);
const flags = {}, args = [];
for (let i = 0; i < rest.length; i++) rest[i].startsWith("--") ? (flags[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true) : args.push(rest[i]);

const sql = (q) => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", DB, "--remote", "--json", "--command", q], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0].results;
const auth = { Authorization: "Basic " + Buffer.from("cli:" + env.ADMIN_PASSWORD).toString("base64"), "User-Agent": "curl/8 atlas-chat-cli" };
async function call(path, body) {
  const r = await fetch(BASE + path, { method: "POST", redirect: "manual", headers: { ...auth, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body ?? {}) });
  const text = await r.text();
  if (r.status >= 400) die(`${path}: ${r.status} ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return { ok: r.status < 400 }; }
}
async function boot(id) {
  const r = await fetch(`${BASE}/admin/flows/${id}`, { headers: auth });
  if (!r.ok) die(`automation ${id}: ${r.status}`);
  const m = (await r.text()).match(/<script type="application\/json" id="fe-data">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : die(`automation ${id}: no editor data on the page`);
}
const num = (s) => (/^\d+$/.test(s ?? "") ? Number(s) : die("Give an automation id (fc list shows them)"));
const postOf = (m) => (m === "next" ? "next post" : m ? `post ${m}` : "any post");

function patch(g) {
  const t = g.trigger;
  if (flags.post) t.media_id = flags.post === "any" ? null : String(flags.post);
  if (flags.keyword) t.keyword = String(flags.keyword);
  if (flags.replies) t.public_reply = String(flags.replies).split("|").map((s) => s.trim()).filter(Boolean).join("\n");
  return g;
}
async function save(id, g) {
  if (flags.name) await call(`/admin/automations/${id}/rename`, { name: String(flags.name) });
  if (!flags.publish) return void (await call(`/admin/flows/${id}/draft`, { graph: g }), console.log(`#${id} saved as a draft (fc publish ${id} to go live)`));
  const r = await fetch(`${BASE}/admin/flows/${id}/publish`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ graph: g }) });
  const res = await r.json().catch(() => ({}));
  res.ok ? console.log(`#${id} is live: ${g.trigger.source} "${g.trigger.keyword}" on ${postOf(g.trigger.media_id)}`) : die(`#${id} not published:\n  ${(res.problems ?? [r.status]).join("\n  ")}`);
}

switch (cmd) {
  case "list": {
    const rows = sql(`SELECT t.id, t.name, t.keyword, t.source, t.media_id, t.enabled, t.published_at, t.deleted_at, (SELECT COUNT(*) FROM flow_starts s WHERE s.trigger_id = t.id) runs
      FROM triggers t WHERE t.id > 0 ${flags.all ? "" : "AND t.deleted_at IS NULL"} ORDER BY t.id`);
    for (const t of rows) {
      const st = t.deleted_at ? "TRASH" : t.enabled ? "LIVE " : t.published_at ? "OFF  " : "DRAFT";
      console.log(`#${String(t.id).padEnd(4)} ${st} ${String(t.runs).padStart(5)} runs  ${t.source.padEnd(7)} ${String(t.keyword || "-").padEnd(12)} ${postOf(t.media_id).padEnd(23)} ${t.name ?? ""}`);
    }
    break;
  }
  case "show": {
    const b = await boot(num(args[0]));
    if (flags.json) { console.log(JSON.stringify(b.graph, null, 2)); break; }
    const t = b.graph.trigger;
    console.log(`#${b.id} ${b.name}  [${b.status.toUpperCase()}${b.hasDraft ? ", unpublished draft" : ""}]`);
    console.log(`When: ${t.source} "${t.keyword}" on ${postOf(t.media_id)}${t.public_reply ? `\nPublic replies: ${t.public_reply.split("\n").join(" | ")}` : ""}`);
    for (const n of b.graph.nodes.filter((n) => n.kind !== "trigger")) {
      const s = b.stats?.[n.id];
      const head = `- ${n.id} ${n.kind}${s?.sent != null ? ` (sent ${s.sent}${s.clicked != null ? `, clicked ${s.clicked}` : ""})` : ""}`;
      if (n.kind === "message") console.log(head + "\n" + n.data.bubbles.map((x) => "    " + x.text.replace(/\n/g, "\n    ") + x.buttons.map((y) => `\n    [${y.title}${y.url ? " -> " + y.url : ""}]`).join("")).join("\n"));
      else console.log(`${head} ${JSON.stringify(n.data)}`);
    }
    console.log(`Key metrics: ${b.metrics.sends} sends, ${b.metrics.contacts} contacts, ${b.metrics.opened} opened, ${b.metrics.clicked} clicked`);
    break;
  }
  case "posts": {
    const first = sql(`SELECT id FROM triggers WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1`)[0];
    const b = first ? await boot(first.id) : die("no automations yet");
    for (const m of b.media) console.log(`${m.id}  ${m.label}`);
    break;
  }
  case "comments": {
    const where = args[0] ? `WHERE c.media_id = '${args[0].replace(/\D/g, "")}'` : "";
    const rows = sql(`SELECT datetime(c.created_at/1000,'unixepoch') at, c.username, c.text, c.status, c.trigger_id, c.error FROM comments c ${where} ORDER BY c.created_at DESC LIMIT ${Number(flags.limit) || 20}`);
    for (const c of rows.reverse()) console.log(`${c.at}  ${String(c.status).padEnd(7)} ${c.trigger_id ? "#" + c.trigger_id : "  -"}  @${c.username ?? "?"}: ${c.text.replace(/\s+/g, " ").slice(0, 70)}${c.error ? `  (${c.error.slice(0, 80)})` : ""}`);
    break;
  }
  case "copy": {
    const src = num(args[0]);
    const before = sql(`SELECT COALESCE(MAX(id), 0) m FROM triggers`)[0].m;
    await call(`/admin/automations/${src}/duplicate`);
    const copy = sql(`SELECT id FROM triggers WHERE id > ${before} ORDER BY id LIMIT 1`)[0]?.id ?? die("the copy didn't show up");
    console.log(`#${src} copied to #${copy}`);
    await save(copy, patch((await boot(copy)).graph));
    break;
  }
  case "set": {
    const id = num(args[0]);
    await save(id, patch((await boot(id)).graph));
    break;
  }
  case "publish": {
    const id = num(args[0]);
    flags.publish = true;
    await save(id, (await boot(id)).graph);
    break;
  }
  case "on":
  case "off": {
    const id = num(args[0]);
    const b = await boot(id);
    if (b.status === "draft") die(`#${id} was never published: fc publish ${id}`);
    const want = cmd === "on" ? "live" : "off";
    const status = b.status === want ? want : (await call(`/admin/automations/${id}/toggle`)).status;
    status === want ? console.log(`#${id} is ${want}`) : die(`#${id} stayed ${status} (another automation may already be waiting for the next post)`);
    break;
  }
  case "test": {
    const r = await call(`/admin/flows/${num(args[0])}/test`);
    console.log(`DM "${r.code}" to @${r.handle ?? "your account"} within 15 minutes to run it on yourself${r.comment ? " (the first message arrives as a plain DM)" : ""}`);
    break;
  }
  case "trash": {
    const id = num(args[0]);
    await call(`/admin/automations/${id}/delete`);
    console.log(`#${id} is in Trash`);
    break;
  }
  default:
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
}
