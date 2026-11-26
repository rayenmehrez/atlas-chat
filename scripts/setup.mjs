#!/usr/bin/env node
// AtlasChat's installer. One command takes a fresh copy of this folder to a live AtlasChat on your own Cloudflare account:
//
//   npm run setup     the guided setup. Safe to run again at any time: it picks up where it stopped.
//   npm run check     looks at your live install and says, in plain words, what works and what doesn't.
//   npm run update    after `git pull`: applies new database changes and puts the new version live.
//
// What is yours lives in files git never touches, so updating never fights with your settings:
//   fewchat.config.json            your answers (handle, business, link) and the ids setup collected
//   .env                           your passwords and keys
//   src/prompt.ts, src/knowledge.ts  the optional AI's script, once you write it
// wrangler.jsonc and src/brand.ts are built from templates/ and fewchat.config.json every time this runs.
//
// It needs nothing but Node: no extra packages, and it runs the same on Mac, Windows and Linux.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const at = (...p) => join(ROOT, ...p);
const CONFIG = at("fewchat.config.json");
const ENV_FILE = at(".env");
const SHEET = at("MY-SETUP.md");
const LOG = at(".wrangler", "setup.log");
const TRACK = "_fewchat_migrations"; // which files in migrations/ this database already has

const args = process.argv.slice(2);
const MODE = args.find((a) => !a.startsWith("-")) ?? "setup";
const flag = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
};
const TTY = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !flag("no-input");
// Test hook: build the database in wrangler's local store and skip everything that needs a Cloudflare account.
const LOCAL = process.env.FEWCHAT_SETUP_LOCAL === "1";

// ---------------------------------------------------------------------------------------------------------- output

const color = (n) => (s) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const bold = color(1), dim = color(2), green = color(32), red = color(31), yellow = color(33), cyan = color(36);
const say = (s = "") => console.log(s);
const ok = (s) => say(`  ${green("✓")} ${s}`);
const warn = (s) => say(`  ${yellow("!")} ${s}`);
const bad = (s) => say(`  ${red("✗")} ${s}`);
const info = (s) => say(`    ${dim(s)}`);
let stepNo = 0;
const step = (title, why) => {
  say();
  say(bold(cyan(`${++stepNo}. ${title}`)));
  if (why) say(dim(`   ${why}`));
};

// Stops the run with what to do next. Nothing is lost: running `npm run setup` again continues from here.
class Stop extends Error {
  constructor(message, { failed = false } = {}) {
    super(message);
    this.failed = failed;
  }
}
const waitFor = (lines) => new Stop([].concat(lines).join("\n"));
const fail = (lines) => new Stop([].concat(lines).join("\n"), { failed: true });

function log(text) {
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, `\n[${new Date().toISOString()}] ${text}\n`);
  } catch {
    // a log we can't write is not a reason to stop
  }
}

// ----------------------------------------------------------------------------------------------------------- input

let rl = null;
function ask(question, { fallback = "", check = () => null } = {}) {
  return new Promise((resolve) => {
    rl ??= createInterface({ input: process.stdin, output: process.stdout });
    const again = () =>
      rl.question(`  ${question}${fallback ? dim(` [${fallback}]`) : ""}\n  › `, (raw) => {
        const value = raw.trim() || fallback;
        const problem = check(value);
        if (problem) {
          say(`  ${red(problem)}`);
          return again();
        }
        resolve(value);
      });
    again();
  });
}
// A secret typed or pasted into the terminal: what goes in is never shown.
function askHidden(question) {
  return new Promise((resolve) => {
    rl?.close();
    rl = null;
    const hidden = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    hidden._writeToOutput = (text) => {
      if (text.includes(question)) process.stdout.write(text);
    };
    hidden.question(`  ${question}\n  › `, (raw) => {
      hidden.close();
      process.stdout.write("\n");
      resolve(raw.trim());
    });
  });
}
const enter = (what) => ask(`${what} ${dim("(press Enter)")}`);
function openInBrowser(url) {
  if (!TTY) return;
  const [cmd, cmdArgs] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawnSync(cmd, cmdArgs, { stdio: "ignore", timeout: 5000 });
  } catch {
    // the address is printed too
  }
}

// ------------------------------------------------------------------------------------- your settings, kept in JSON

const BLANK = {
  instagram_handle: "rayen.mhz",
  business_name: "Atlas AI",
  contact_email: "",
  website: "rayenmehrez.me",
  link: "",
  community_name: "Atlas AI Academy",
  skool_slugs: [],
  worker_name: "atlas-chat",
  cloudflare_account_id: "",
  database_id: "",
  instagram_app_id: "",
  url: "",
};
// A copy from before this installer kept its settings inside wrangler.jsonc and src/brand.ts themselves.
// Read them out once, so an older install carries on without answering anything again.
function adopt() {
  const c = { ...BLANK };
  const read = (f) => (existsSync(at(f)) ? readFileSync(at(f), "utf8") : "");
  const w = read("wrangler.jsonc"), b = read(join("src", "brand.ts"));
  if (/BUILT by/.test(w + b)) return c;
  const real = (v) => (v && !/REPLACE/.test(v) ? v : "");
  const fromW = (key) => real(w.match(new RegExp(`"${key}":\\s*"([^"]*)"`))?.[1]);
  const fromB = (key) => real(b.match(new RegExp(`export const ${key} = "([^"]*)"`))?.[1]);
  c.worker_name = fromW("name") || c.worker_name;
  c.cloudflare_account_id = fromW("account_id") || c.cloudflare_account_id;
  c.database_id = fromW("database_id") || c.database_id;
  c.instagram_app_id = fromW("META_IG_APP_ID") || c.instagram_app_id;
  c.link = fromW("SKOOL_LINK") || c.link;
  c.url = fromB("ORIGIN") || c.url;
  // A missing or still-placeholder file must not wipe the defaults in BLANK.
  c.instagram_handle = fromB("IG_HANDLE") || c.instagram_handle;
  c.business_name = fromB("BUSINESS") || c.business_name;
  c.website = fromB("SITE") || c.website;
  c.contact_email = fromB("CONTACT_EMAIL") || c.contact_email;
  c.community_name = fromB("COMMUNITY") || c.community_name;
  c.skool_slugs = [...(b.match(/export const SKOOL_GROUPS[^=]*= \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter(real);
  if (c.instagram_handle || c.database_id) saveConfig(c);
  return c;
}
function readConfig() {
  if (!existsSync(CONFIG)) return adopt();
  try {
    return { ...BLANK, ...JSON.parse(readFileSync(CONFIG, "utf8")) };
  } catch (e) {
    throw fail([`fewchat.config.json isn't valid JSON (${e.message}).`, "Fix the typo, or delete the file and run `npm run setup` again to answer the questions fresh."]);
  }
}
function saveConfig(c) {
  writeFileSync(CONFIG, `${JSON.stringify(c, null, 2)}\n`);
}

// .env: KEY=value lines. Read without ever printing; written back with every comment and unknown line kept.
function readEnv() {
  const out = {};
  if (!existsSync(ENV_FILE)) return out;
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}
function setEnv(key, value) {
  if (!existsSync(ENV_FILE)) copyFileSync(at(".env.example"), ENV_FILE);
  const lines = readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(ENV_FILE, lines.join("\n").replace(/\n*$/, "\n"));
}
const SECRET_NAMES = ["INBOUND_SECRET", "ADMIN_PASSWORD", "META_VERIFY_TOKEN", "META_APP_SECRET", "ANTHROPIC_API_KEY", "REVIEW_PASSWORD", "SKOOL_AUTH_TOKEN", "ALERT_TOPIC", "MANYCHAT_API_KEY"];
const hex = (bytes) => randomBytes(bytes).toString("hex");
// A password a person can read and type: four groups, no look-alike characters.
function password() {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  const pick = () => Array.from(randomBytes(4), (b) => letters[b % letters.length]).join("");
  return [pick(), pick(), pick(), pick()].join("-");
}

// --------------------------------------------------------------------- the files built from templates/ + your settings

const cleanHandle = (s) => s.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?].*$/, "").toLowerCase();
const cleanSite = (s) => s.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
const skoolSlug = (link) => link.match(/skool\.com\/([a-z0-9-]+)/i)?.[1]?.toLowerCase() ?? null;
const ts = (s) => JSON.stringify(String(s)); // a safe TypeScript / JSON string literal

// Writes wrangler.jsonc and src/brand.ts from their templates. A value you haven't given yet stays a REPLACE marker,
// which is what `npm run deploy` looks for before it lets anything go live.
function build(c) {
  const name = c.worker_name || "atlas-chat";
  let w = readFileSync(at("templates", "wrangler.jsonc"), "utf8");
  w = w
    .replace('"name": "atlas-chat"', `"name": ${ts(name)}${c.cloudflare_account_id ? `,\n  "account_id": ${ts(c.cloudflare_account_id)}` : ""}`)
    .replace('"database_name": "atlas-chat"', `"database_name": ${ts(name)}`)
    .replaceAll('"queue": "atlas-chat-send"', `"queue": ${ts(`${name}-send`)}`);
  if (c.database_id) w = w.replace("REPLACE_D1_DATABASE_ID", c.database_id);
  if (c.instagram_app_id) w = w.replace("REPLACE_INSTAGRAM_APP_ID", c.instagram_app_id);
  if (c.link) w = w.replace("https://REPLACE_YOUR_LINK", c.link);
  writeIfChanged(at("wrangler.jsonc"), `// BUILT by \`npm run setup\` from templates/wrangler.jsonc and fewchat.config.json. Edit those, not this file.\n${w}`);

  let b = readFileSync(at("templates", "brand.ts"), "utf8");
  const handle = c.instagram_handle;
  const set = (marker, value) => {
    if (value) b = b.replace(`"${marker}"`, ts(value));
  };
  set("https://atlas-chat.REPLACE-SUBDOMAIN.workers.dev", c.url);
  set("REPLACE_IG_HANDLE", handle);
  set("REPLACE_BUSINESS_NAME", c.business_name);
  set("REPLACE_WEBSITE", c.website || (handle ? `instagram.com/${handle}` : ""));
  set("REPLACE_CONTACT_EMAIL", c.contact_email);
  set("REPLACE_COMMUNITY_NAME", c.community_name || c.business_name);
  if (handle) b = b.replace('["REPLACE-SKOOL-SLUG"]', JSON.stringify(c.skool_slugs ?? []));
  writeIfChanged(at("src", "brand.ts"), `// BUILT by \`npm run setup\` from templates/brand.ts and fewchat.config.json. Edit those, not this file.\n${b}`);

  // The optional AI's script: yours to write, so it is only ever copied in once.
  for (const f of ["prompt.ts", "knowledge.ts"]) if (!existsSync(at("src", f))) copyFileSync(at("templates", f), at("src", f));
}
function writeIfChanged(file, text) {
  if (!existsSync(file) || readFileSync(file, "utf8") !== text) writeFileSync(file, text);
}
// What still has to be filled in before a deploy makes sense.
function placeholders() {
  const left = [];
  for (const f of ["wrangler.jsonc", join("src", "brand.ts")]) {
    readFileSync(at(f), "utf8").split("\n").forEach((line, i) => {
      if (/REPLACE[_-]/.test(line)) left.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  return left;
}
const aiScriptReady = () => ["prompt.ts", "knowledge.ts"].every((f) => existsSync(at("src", f)) && !/<<FILL/.test(readFileSync(at("src", f), "utf8")));

// ------------------------------------------------------------------------------------------------------ Cloudflare

const WRANGLER = at("node_modules", "wrangler", "bin", "wrangler.js");
// Runs one wrangler command. Quiet by default (the output goes to .wrangler/setup.log); `show` hands it the terminal,
// for the steps where Cloudflare needs to talk to you (logging in, picking a workers.dev address).
function wrangler(wArgs, { show = false, input, timeout = 300_000 } = {}) {
  const r = spawnSync(process.execPath, [WRANGLER, ...wArgs], {
    cwd: ROOT,
    encoding: "utf8",
    input,
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    stdio: show ? "inherit" : ["pipe", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (!show) log(`wrangler ${wArgs.join(" ")}\nexit ${r.status}\n${out}`);
  return { ok: r.status === 0, out };
}
// The useful part of a wrangler error: its own message, without the banner and the log-file footer.
function reason(out) {
  const lines = out
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^⛅|^─+$|^🪵|Logs were written|open an issue|update available/.test(l));
  const error = lines.findIndex((l) => /\bERROR\b/.test(l));
  return (error >= 0 ? lines.slice(error) : lines.slice(-6)).slice(0, 6).join("\n      ");
}

function accounts(out) {
  return [...out.matchAll(/│\s*(.+?)\s*│\s*([0-9a-f]{32})\s*│/g)].map((m) => ({ name: m[1], id: m[2] }));
}
async function signIn(c) {
  let who = wrangler(["whoami"]);
  if (!who.ok || /not authenticated|not logged in/i.test(who.out)) {
    say("  A browser tab opens now. Sign in to Cloudflare (or create a free account) and click " + bold("Allow") + ".");
    info("Cloudflare is where AtlasChat runs. Nothing is charged for signing in.");
    wrangler(["login"], { show: true });
    who = wrangler(["whoami"]);
    if (!who.ok || /not authenticated|not logged in/i.test(who.out)) {
      throw fail(["Cloudflare sign-in didn't finish.", "Run `npm run setup` again and click Allow in the browser tab it opens."]);
    }
  }
  ok("Signed in to Cloudflare");
  const list = accounts(who.out);
  if (c.cloudflare_account_id || process.env.CLOUDFLARE_ACCOUNT_ID || list.length <= 1) return;
  // More than one Cloudflare account on this login: AtlasChat has to know which one to live in.
  const wanted = flag("account");
  let pick = list.find((a) => a.id === wanted || a.name === wanted);
  if (!pick && TTY) {
    say("  Your login can use more than one Cloudflare account:");
    list.forEach((a, i) => say(`    ${i + 1}. ${a.name}`));
    const n = await ask("Which one should AtlasChat run in? Type its number.", { check: (v) => (list[Number(v) - 1] ? null : `Type a number from 1 to ${list.length}.`) });
    pick = list[Number(n) - 1];
  }
  if (!pick) {
    throw waitFor(["Your Cloudflare login can use more than one account. Run setup again with the one to use:", ...list.map((a) => `  npm run setup -- --account=${a.id}    (${a.name})`)]);
  }
  c.cloudflare_account_id = pick.id;
  saveConfig(c);
  build(c);
  ok(`Using the Cloudflare account "${pick.name}"`);
}

function workerExists(name) {
  const r = wrangler(["deployments", "list", "--name", name]);
  if (/10007|does not exist/i.test(r.out)) return false;
  return r.ok;
}

function d1List() {
  const r = wrangler(["d1", "list", "--json"]);
  if (!r.ok) throw fail(["Couldn't read your Cloudflare databases:", `      ${reason(r.out)}`]);
  return JSON.parse(r.out.slice(r.out.indexOf("[")));
}
function ensureDatabase(c) {
  const name = c.worker_name;
  if (LOCAL) {
    c.database_id ||= "00000000-0000-0000-0000-000000000000";
    return;
  }
  const mine = d1List().find((d) => d.name === name);
  if (c.database_id && mine?.uuid === c.database_id) return ok(`Database "${name}" is there`);
  if (mine) {
    c.database_id = mine.uuid;
    return ok(`Found your database "${name}" and connected it`);
  }
  const made = wrangler(["d1", "create", name]);
  const created = made.ok ? d1List().find((d) => d.name === name) : null;
  if (!created) throw fail([`Cloudflare didn't create the database "${name}":`, `      ${reason(made.out)}`]);
  c.database_id = created.uuid;
  ok(`Created your database "${name}"`);
}
function ensureQueue(c) {
  if (LOCAL) return;
  const name = `${c.worker_name}-send`;
  const r = wrangler(["queues", "create", name]);
  if (r.ok) return ok(`Created the send queue "${name}"`);
  if (/already (exists|taken)|11009/i.test(r.out)) return ok(`Send queue "${name}" is there`);
  throw fail([
    `Cloudflare didn't create the send queue "${name}":`,
    `      ${reason(r.out)}`,
    "Queues are included on the Workers Free plan (10,000 operations a day). Do not switch to Workers Paid ($5 a month) unless the error above says the account must, and you have decided to pay.",
    "Otherwise run `npm run setup` again. What each binding costs is in docs/HOW-IT-WORKS.md, under What it costs to run.",
  ]);
}

// One SQL statement against the database, as rows. Never printed.
function sql(c, query) {
  const r = wrangler(["d1", "execute", c.worker_name, LOCAL ? "--local" : "--remote", "--json", "--command", query]);
  if (!r.ok) return { ok: false, rows: [], out: r.out };
  try {
    const parsed = JSON.parse(r.out.slice(r.out.indexOf("[")));
    return { ok: true, rows: parsed.flatMap((p) => p.results ?? []), out: r.out };
  } catch {
    return { ok: false, rows: [], out: r.out };
  }
}
function runSqlFile(c, file) {
  return wrangler(["d1", "execute", c.worker_name, LOCAL ? "--local" : "--remote", "--file", file, "-y"], { timeout: 600_000 });
}
const migrationFiles = () => readdirSync(at("migrations")).filter((f) => f.endsWith(".sql")).sort();
// Several SQL files as one upload. Cloudflare refuses an empty statement, so they are joined with nothing in between
// (every file ends its last statement itself).
const joined = (...texts) => texts.map((t) => t.trim()).filter(Boolean).join("\n\n") + "\n";
const record = (names) => `CREATE TABLE IF NOT EXISTS ${TRACK} (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);\n` + names.map((n) => `INSERT OR IGNORE INTO ${TRACK} (name, applied_at) VALUES ('${n}', ${Date.now()});`).join("\n") + "\n";

// Brings the database up to this folder's version: everything on a new one, only what's new on an existing one.
function migrate(c) {
  const seen = sql(c, `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('leads', '${TRACK}')`);
  if (!seen.ok) throw fail(["Couldn't read the database:", `      ${reason(seen.out)}`]);
  const has = new Set(seen.rows.map((r) => r.name));
  const all = migrationFiles();
  const scratch = at(".wrangler", "setup.sql");
  mkdirSync(dirname(scratch), { recursive: true });

  if (!has.has("leads")) {
    // New database: the base tables, every change since, and the list of what's in, as one upload.
    writeFileSync(scratch, joined(readFileSync(at("schema.sql"), "utf8"), ...all.map((f) => readFileSync(at("migrations", f), "utf8")), record(all)));
    const r = runSqlFile(c, scratch);
    if (!r.ok) throw fail(["Building the database tables failed:", `      ${reason(r.out)}`, "Run `npm run setup` again. If it keeps failing, the details are in .wrangler/setup.log."]);
    return ok(`Built the database tables (${all.length + 1} files)`);
  }

  let applied;
  if (has.has(TRACK)) {
    applied = new Set(sql(c, `SELECT name FROM ${TRACK}`).rows.map((r) => r.name));
  } else {
    // A database from before this installer kept track. Try each change: one that is already in says so ("duplicate
    // column", "already exists") and is ticked off; anything else is a real error.
    applied = new Set();
    for (const f of all) {
      const r = runSqlFile(c, at("migrations", f));
      if (!r.ok && !/duplicate column name|already exists/i.test(r.out)) throw fail([`Database change ${f} failed:`, `      ${reason(r.out)}`]);
      applied.add(f);
    }
    writeFileSync(scratch, record(all));
    runSqlFile(c, scratch);
    return ok("Database was set up before this installer: checked every change and noted them");
  }
  const fresh = all.filter((f) => !applied.has(f));
  if (!fresh.length) return ok("Database is up to date");
  for (const f of fresh) {
    writeFileSync(scratch, joined(readFileSync(at("migrations", f), "utf8"), record([f])));
    const r = runSqlFile(c, scratch);
    if (!r.ok) throw fail([`Database change ${f} failed:`, `      ${reason(r.out)}`, "Nothing was deployed. The details are in .wrangler/setup.log."]);
  }
  ok(`Applied ${fresh.length} new database change${fresh.length === 1 ? "" : "s"}`);
}

function pushSecrets(c) {
  const env = readEnv();
  const values = Object.fromEntries(SECRET_NAMES.filter((k) => env[k]).map((k) => [k, env[k]]));
  const r = wrangler(["secret", "bulk", "--name", c.worker_name], { input: JSON.stringify(values) });
  if (!r.ok) throw fail(["Couldn't store your passwords and keys in the Worker:", `      ${reason(r.out)}`]);
  ok(`Stored ${Object.keys(values).length} passwords and keys in the Worker ${dim("(encrypted; nobody can read them back)")}`);
}

async function deploy(c, label) {
  let r = wrangler(["deploy"]);
  if (!r.ok && /workers\.dev subdomain|register a workers\.dev/i.test(r.out)) {
    if (!TTY) {
      throw waitFor([
        "Your Cloudflare account doesn't have a workers.dev address yet (every account picks one, once).",
        "Open dash.cloudflare.com → Workers & Pages. It asks you to choose a subdomain: pick any name, save, then run `npm run setup` again.",
      ]);
    }
    say("  Cloudflare needs you to pick your workers.dev address (once per account). Answer its question below:");
    wrangler(["deploy"], { show: true });
    r = wrangler(["deploy"]);
  }
  if (!r.ok) {
    const hints = [];
    if (/verify your email|email.*verif/i.test(r.out)) hints.push("Cloudflare wants your email address verified first: click the link in the email it sent you, then run `npm run setup` again.");
    if (/durable objects|paid plan|10097/i.test(r.out)) hints.push("This app's Durable Object uses SQLite storage, which the Workers Free plan includes. Do not switch to Workers Paid ($5 a month) unless Cloudflare's message says the account must, and you have decided to pay. See docs/HOW-IT-WORKS.md, What it costs to run.");
    throw fail([`Putting AtlasChat live failed (${label}):`, `      ${reason(r.out)}`, ...hints]);
  }
  const url = r.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0] ?? null;
  return url;
}

// ------------------------------------------------------------------------------------------------- checks from outside

async function get(url, { timeout = 15_000, headers } = {}) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers, redirect: "manual" });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { status: 0, text: String(e) };
  }
}
// Acts like Meta checking your webhook address: proves the Worker is up and has its verify token.
async function webhookAnswers(c) {
  const token = readEnv().META_VERIFY_TOKEN;
  if (!c.url || !token) return false;
  const q = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "atlaschat-ok" });
  for (let i = 0; i < 6; i++) {
    const r = await get(`${c.url}/meta?${q}`);
    if (r.status === 200 && r.text === "atlaschat-ok") return true;
    await new Promise((res) => setTimeout(res, 5000)); // a brand-new workers.dev address takes a moment to answer
  }
  return false;
}
function settings(c) {
  const r = sql(c, `SELECT key, value FROM settings WHERE key IN ('ig_token', 'ig_token_at', 'ig_account_id', 'webhook_at', 'ig_profile')`);
  return r.ok ? Object.fromEntries(r.rows.map((x) => [x.key, x.value])) : null;
}
async function instagram(token, path) {
  try {
    const res = await fetch(`https://graph.instagram.com/v26.0${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    return await res.json();
  } catch {
    return null;
  }
}
const ago = (ms) => {
  const min = Math.round((Date.now() - ms) / 60_000);
  return min < 2 ? "just now" : min < 120 ? `${min} minutes ago` : min < 48 * 60 ? `${Math.round(min / 60)} hours ago` : `${Math.round(min / 1440)} days ago`;
};

// ------------------------------------------------------------------------------------- your own page of instructions

const WEBHOOK_FIELDS = ["messages", "messaging_postbacks", "messaging_seen", "messaging_referral", "message_reactions", "message_edit", "comments", "live_comments"];
function metaSteps(c) {
  const host = c.url.replace(/^https:\/\//, "");
  return [
    `1. Open https://developers.facebook.com/apps and log in with the Facebook account that manages your Instagram. If it asks you to register as a developer, say yes (free).`,
    `2. Click **Create app**. Name it anything (for example "AtlasChat"). When it asks what the app is for, choose **Other**, then the type **Business**.`,
    `3. On the app's page, find **Instagram** in the product list and click **Set up**. Pick **API setup with Instagram login**.`,
    `4. That page shows an **Instagram app ID** and an **Instagram app secret** (click Show). Setup asks you for both at the end: keep the tab open.`,
    `5. Under **Configure webhooks** paste these two, click **Verify and save**, then switch on every field in the list below it:\n   - Callback URL: \`${c.url}/meta\`\n   - Verify token: \`${readEnv().META_VERIFY_TOKEN ?? "(in .env: META_VERIFY_TOKEN)"}\`\n   - Fields: ${WEBHOOK_FIELDS.map((f) => `\`${f}\``).join(", ")}`,
    `6. Under **Set up Instagram business login** (open that section first, the button does nothing while it's folded), click **Business login settings** and paste:\n   - OAuth redirect URI: \`${c.url}/auth/callback\`\n   - Deauthorize callback URL: \`${c.url}/deauthorize\`\n   - Data deletion request URL: \`${c.url}/data-deletion\``,
    `7. In the left menu open **App settings → Basic** and fill in, then **Save changes**:\n   - App domains: \`${host}\`\n   - Privacy policy URL: \`${c.url}/privacy\`\n   - Terms of service URL: \`${c.url}/terms\`\n   - User data deletion → Data deletion callback URL: \`${c.url}/data-deletion\`\n   - Category: any that fits (for example Business and pages)\n   - App icon: any square picture (assets/icon.png in this folder works)`,
    `8. In the left menu open **App roles → Roles**, click **Add people**, choose **Instagram tester** and add @${c.instagram_handle}. Then, in the Instagram app or on instagram.com: **Settings → Website permissions → Apps and websites → Tester invites → Accept**.`,
    `9. At the top of the app's page, switch **App mode** from Development to **Live**. (If Meta asks for a "data use checkup" or business details first, fill those in. You do **not** need App Review for your own account.)`,
  ];
}
function writeSheet(c) {
  const env = readEnv();
  const text = `# My AtlasChat setup

**Keep this file to yourself.** It holds your console password. Git ignores it, so it never leaves this computer.
It is rewritten every time you run \`npm run setup\`.

## Your console

- Address: ${c.url}/login
- Log in with the **Log in with Instagram** button (on a computer), or with this password:
- Password: \`${env.ADMIN_PASSWORD ?? ""}\`

## The Meta app (about 15 minutes, once)

Instagram only lets an app send DMs for you if you register that app with Meta. It's free, and yours alone.
Paste the values exactly as they are here.

${metaSteps(c).join("\n\n")}

When that's done, run \`npm run setup\` again: it asks for the Instagram app ID and secret, then finishes on its own.

## Connect your Instagram account (after the Meta app)

The usual way is Log in with Instagram. That is the OAuth flow: it exchanges a short code for a 60-day token, saves it in the database, subscribes to your DMs and comments, and renews the token weekly.

If you already have a long-lived Instagram user token from this same Meta app, you can skip the button:

1. Put it in \`.env\` as \`IG_ACCESS_TOKEN=\` (never in chat, never in git).
2. Run \`npm run setup\` again. Setup checks the token is for @${c.instagram_handle}, saves it in the database, and subscribes to DMs and comments.

A token from a different app, or a short-lived token, will send for a while and then fail the weekly refresh. Log in with Instagram avoids that.

Or, on a computer:

1. Open ${c.url}/login and click **Log in with Instagram**.
2. Log in as @${c.instagram_handle} and approve the three permissions. That connects your account.
3. Run \`npm run check\`: it tells you whether everything is working.

If the button gives an error, log in with the password instead and click **Connect Instagram** at the top left.

## Useful later

- \`npm run check\`: is everything working? What's wrong, in plain words.
- \`npm run update\`: get the newest version of AtlasChat.
- Your settings: \`fewchat.config.json\`. Your passwords and keys: \`.env\`. Change either, then run \`npm run setup\`.
`;
  writeFileSync(SHEET, text);
}

// ----------------------------------------------------------------------------------------------------------- setup

async function basics(c) {
  const given = { instagram_handle: flag("handle"), business_name: flag("business"), contact_email: flag("email"), website: flag("website"), link: flag("link"), worker_name: flag("name"), instagram_app_id: flag("app-id") };
  for (const [k, v] of Object.entries(given)) if (v && v !== "true") c[k] = v;
  const need = ["instagram_handle", "business_name", "contact_email"].filter((k) => !c[k]);
  if (need.length && !TTY) {
    const bits = [];
    if (!c.instagram_handle) bits.push("--handle=yourhandle");
    if (!c.business_name) bits.push('--business="Your Name or Company"');
    if (!c.contact_email) bits.push("--email=you@example.com");
    throw waitFor([
      "I still need an answer before I can start. Pass it like this (quotes around anything with a space):",
      `  npm run setup -- ${bits.join(" ")}`,
      `Already set for this install: @${c.instagram_handle || "?"} (${c.business_name || "?"}${c.website ? `, ${c.website}` : ""}).`,
      "Optional overrides: --handle=  --business=  --website=  --link=https://the-link-your-dms-send  --name=atlas-chat",
      "The contact email is shown on the privacy page. Do not commit it. The DM link stays a placeholder until you pass --link=.",
    ]);
  }
  if (need.length) {
    say("  A couple of questions. Your answers are saved in fewchat.config.json and you can change them later.");
    say();
  }
  if (!c.instagram_handle) c.instagram_handle = await ask("What's your Instagram username?", { check: (v) => (/^@?[a-z0-9._]{1,30}$/i.test(cleanHandle(v)) ? null : "That doesn't look like an Instagram username. Type it without spaces, like yourhandle.") });
  c.instagram_handle = cleanHandle(c.instagram_handle);
  if (!c.business_name) c.business_name = await ask("Your name or your business's name? " + dim("(shown on your privacy page, which Meta requires)"), { check: (v) => (v ? null : "Type a name.") });
  if (!c.contact_email) c.contact_email = await ask("An email people can reach you at? " + dim("(also shown on that privacy page)"), { check: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : "That doesn't look like an email address.") });
  if (!c.website && TTY && need.length) c.website = await ask("Your website? " + dim("(press Enter to skip)"));
  c.website = cleanSite(c.website || "");
  if (!c.link && TTY && need.length) {
    const profile = `https://www.instagram.com/${c.instagram_handle}/`;
    c.link = await ask("One link your DMs can send with a single tap: your site, shop or community. " + dim("(you can change it any time in Settings)"), { fallback: profile, check: (v) => (/^https:\/\/\S+\.\S+$/.test(v) ? null : "Paste the full link, starting with https://") });
  }
  if (!c.skool_slugs?.length && skoolSlug(c.link)) c.skool_slugs = [skoolSlug(c.link)];
  if (!/^[a-z0-9][a-z0-9-]{0,50}$/.test(c.worker_name)) throw fail(`"${c.worker_name}" can't be a Worker name: use lowercase letters, numbers and dashes.`);
  saveConfig(c);
  build(c);
  ok(`Set up for @${c.instagram_handle} (${c.business_name})`);
}

async function metaApp(c) {
  const env = readEnv();
  if (c.instagram_app_id && env.META_APP_SECRET) return true;
  say("  Instagram only lets an app send DMs for you if you register that app with Meta. It's free and takes about 15 minutes.");
  say(`  Every click, with your own addresses already filled in, is in ${bold("MY-SETUP.md")} in this folder. Open it and follow the 9 steps.`);
  say();
  if (!TTY) {
    throw waitFor([
      "Waiting on the Meta app. When the 9 steps in MY-SETUP.md are done:",
      "  1. Put the Instagram app secret in .env on the line META_APP_SECRET=  (never in chat)",
      "  2. Run: npm run setup -- --app-id=<the Instagram app ID>",
    ]);
  }
  openInBrowser("https://developers.facebook.com/apps");
  const ready = await ask("Type " + bold("done") + " when you've finished the 9 steps, or " + bold("later") + " to stop here and come back.", { check: (v) => (/^(done|later)$/i.test(v) ? null : "Type done or later.") });
  if (/later/i.test(ready)) throw waitFor(["No problem. When the Meta app is done, run `npm run setup` again: it continues from here."]);
  if (!c.instagram_app_id) c.instagram_app_id = await ask("Paste the " + bold("Instagram app ID") + " (a long number).", { check: (v) => (/^\d{8,20}$/.test(v) ? null : "The Instagram app ID is only digits. It's on Instagram → API setup with Instagram login.") });
  if (!env.META_APP_SECRET) {
    const secret = await askHidden("Paste the " + bold("Instagram app secret") + " (it stays hidden as you paste), then press Enter.");
    if (!/^[0-9a-f]{20,64}$/i.test(secret)) throw fail(["That doesn't look like an Instagram app secret (letters a-f and numbers, about 32 long).", "Run `npm run setup` again and paste the one behind **Show** next to the Instagram app ID."]);
    setEnv("META_APP_SECRET", secret);
  }
  saveConfig(c);
  build(c);
  return true;
}

// A long-lived Instagram user token from .env, stored in D1. The Worker reads ig_token from the database
// (and refreshes it there); it is not a Worker secret. OAuth via Log in with Instagram does the same write.
async function storeAccessToken(c) {
  const token = (readEnv().IG_ACCESS_TOKEN ?? "").trim();
  if (!token) return false;
  if (!/^[A-Za-z0-9._-]{20,}$/.test(token)) {
    throw fail(["IG_ACCESS_TOKEN doesn't look like an Instagram access token.", "Paste the long-lived token on that line in .env, or clear the line and use Log in with Instagram."]);
  }
  const me = await instagram(token, "/me?fields=username,user_id");
  if (!me?.username) {
    throw fail([
      "Instagram refused IG_ACCESS_TOKEN.",
      "Use a long-lived user token from this same Meta app (Instagram Login), with permission to read the account and to manage messages and comments.",
      "A short-lived token, or a token from a different app, will not refresh weekly. Clear the line and use Log in with Instagram instead.",
    ]);
  }
  if (String(me.username).toLowerCase() !== String(c.instagram_handle).toLowerCase()) {
    throw fail([`IG_ACCESS_TOKEN belongs to @${me.username}. This install is for @${c.instagram_handle}.`]);
  }
  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const scratch = at(".wrangler", "ig-token.sql");
  mkdirSync(dirname(scratch), { recursive: true });
  const rows = [
    `INSERT INTO settings (key, value) VALUES ('ig_token', ${lit(token)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    `INSERT INTO settings (key, value) VALUES ('ig_token_at', ${lit(String(Date.now()))}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
  ];
  if (me.user_id != null && String(me.user_id) !== "") {
    rows.push(`INSERT INTO settings (key, value) VALUES ('ig_account_id', ${lit(String(me.user_id))}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
  }
  writeFileSync(scratch, `${rows.join("\n")}\n`);
  let stored;
  try {
    stored = runSqlFile(c, scratch);
  } finally {
    try {
      unlinkSync(scratch);
    } catch {
      // already gone
    }
  }
  if (!stored.ok) throw fail(["Couldn't store the Instagram access token in the database.", `      ${reason(stored.out).replaceAll(token, "[token]")}`]);
  const sub = await fetch(
    `https://graph.instagram.com/v26.0/me/subscribed_apps?${new URLSearchParams({ subscribed_fields: "messages,messaging_postbacks,messaging_seen,comments,live_comments", access_token: token })}`,
    { method: "POST" },
  ).catch(() => null);
  if (!sub?.ok) warn("The token is saved, but subscribing to DMs and comments failed. Use Connect Instagram in the console, or run setup again.");
  else ok("Subscribed to DMs and comments");
  ok(`Stored the Instagram access token for @${me.username}`);
  return true;
}

async function connectInstagram(c) {
  await storeAccessToken(c);
  let s = settings(c);
  if (!s?.ig_token) {
    say(`  Last step. On this computer, open ${bold(`${c.url}/login`)}`);
    say(`  Click ${bold("Log in with Instagram")}, log in as @${c.instagram_handle} and approve the three permissions.`);
    say("  Or put a long-lived Instagram user token in .env as IG_ACCESS_TOKEN= and run setup again. It is saved in the database, not as a Worker secret.");
    if (!TTY) throw waitFor(["Waiting on you to connect Instagram (see above). Then run `npm run check`.", "Or set IG_ACCESS_TOKEN in .env (see .env.example) and run `npm run setup` again."]);
    openInBrowser(`${c.url}/login`);
    await enter("When Instagram is connected, come back here.");
    s = settings(c);
    if (!s?.ig_token) throw waitFor(["Instagram isn't connected yet.", `Open ${c.url}/login, click Log in with Instagram, then run \`npm run check\`. If Instagram shows an error there, step 6 or 8 in MY-SETUP.md is the usual cause.`]);
  }
  const me = await instagram(s.ig_token, "/me?fields=username");
  ok(`Instagram is connected${me?.username ? ` as @${me.username}` : ""}`);
  if (s.webhook_at) return ok(`Instagram is sending AtlasChat your messages (last one ${ago(Number(s.webhook_at))})`);
  if (!TTY) return warn("No message has arrived from Instagram yet. Send your account a DM from another account, then run `npm run check`.");
  say("  Now the real test: from " + bold("another") + " Instagram account (a friend's, or a spare), send your account a DM.");
  await enter("Sent it?");
  for (let i = 0; i < 12; i++) {
    if (settings(c)?.webhook_at) return ok("It arrived. Open the Inbox in your console: the message is there.");
    await new Promise((res) => setTimeout(res, 5000));
  }
  warn("Nothing arrived in the last minute. The usual causes: the Meta app isn't Live (step 9), or the webhook wasn't saved (step 5).");
  info("Fix that in MY-SETUP.md, send another DM, then run `npm run check`.");
}

async function setup() {
  say();
  say(bold("AtlasChat setup"));
  say(dim("   Sets everything up on your own Cloudflare account. Safe to stop and run again: it continues where it left off."));

  step("Getting this folder ready");
  const c = readConfig();
  build(c);
  ok("Tools installed");

  step("About you");
  await basics(c);

  if (LOCAL) {
    step("Database (local test mode)");
    ensureDatabase(c);
    saveConfig(c);
    build(c);
    migrate(c);
    return;
  }

  step("Your Cloudflare account", "Cloudflare runs AtlasChat for you. The free plan is enough to start.");
  await signIn(c);
  if (!c.url && workerExists(c.worker_name) && !flag("replace")) {
    throw fail([
      `Your Cloudflare account already has a Worker called "${c.worker_name}", and this folder didn't create it.`,
      "Going on would replace it. Pick one:",
      `  • A different name for this install:   npm run setup -- --name=${c.worker_name}-2`,
      "  • It's an old AtlasChat you want to keep using from this folder:   npm run setup -- --replace",
    ]);
  }

  step("Database and send queue", "The database keeps your conversations and automations. The queue sends messages in order.");
  ensureDatabase(c);
  saveConfig(c);
  build(c);
  ensureQueue(c);
  migrate(c);

  step("Passwords and keys", "Made on this computer, saved in .env, and stored encrypted in your Worker.");
  const env = readEnv();
  let made = 0;
  for (const [k, make] of [["INBOUND_SECRET", () => hex(16)], ["META_VERIFY_TOKEN", () => hex(16)], ["ADMIN_PASSWORD", password]]) {
    if (!env[k]) {
      setEnv(k, make());
      made++;
    }
  }
  ok(made ? `Created ${made} and saved them in .env` : "Already in .env");

  step("Putting AtlasChat live");
  const first = !c.url;
  const url = await deploy(c, "first deploy");
  if (url && url !== c.url) {
    c.url = url;
    saveConfig(c);
    build(c);
  }
  if (!c.url) {
    if (!TTY) throw fail(["AtlasChat was deployed, but I couldn't read its address from Cloudflare.", 'Find it on dash.cloudflare.com → Workers & Pages → your Worker (it ends in .workers.dev), put it in fewchat.config.json as "url", then run `npm run setup` again.']);
    c.url = await ask("AtlasChat is live, but I couldn't read its address. Paste it from dash.cloudflare.com → Workers & Pages (it ends in .workers.dev).", { check: (v) => (/^https:\/\/[a-z0-9.-]+$/i.test(v) ? null : "Paste the full address, starting with https://") });
    saveConfig(c);
    build(c);
  }
  pushSecrets(c);
  if (first) await deploy(c, "second deploy"); // the first one told us the address; this one puts it into AtlasChat's own links
  ok(`Live at ${bold(c.url)}`);
  writeSheet(c);
  if (await webhookAnswers(c)) ok("It answers Instagram's webhook check");
  else warn("It isn't answering the webhook check yet. A new workers.dev address can take a few minutes: run `npm run check` shortly.");

  step("The Meta app", "The part only you can do: a few screens on Meta's developer site.");
  await metaApp(c);
  pushSecrets(c);
  const left = placeholders();
  if (left.length) throw fail(["Something is still not filled in:", ...left.map((l) => `  ${l}`)]);
  await deploy(c, "final deploy");
  writeSheet(c);
  ok("Meta app connected to AtlasChat");

  step("Connect your Instagram account");
  await connectInstagram(c);

  say();
  say(bold(green("🎉 AtlasChat is set up.")));
  say(`   Console:   ${c.url}/admin/dashboard`);
  say(`   Next:      make your first automation → README.md, "Your first automation"`);
  say(`   Any time:  npm run check   ${dim("(is everything working?)")}`);
  if (!aiScriptReady()) say(dim("   The AI replies (beta) stay off until you write their script: see docs/AI.md. Everything else works without them."));
}

// ----------------------------------------------------------------------------------------------------------- check

async function check() {
  say();
  say(bold("AtlasChat check"));
  const c = readConfig();
  build(c);
  let problems = 0;
  const no = (what, fix) => {
    problems++;
    bad(what);
    info(fix);
  };

  const left = placeholders();
  if (left.length) no("Setup isn't finished", "Run `npm run setup`: it continues where it stopped.");
  else ok(`Set up for @${c.instagram_handle}`);

  const who = wrangler(["whoami"]);
  if (!who.ok || /not authenticated|not logged in/i.test(who.out)) {
    no("Not signed in to Cloudflare on this computer", "Run `npm run setup` and click Allow in the browser tab.");
    return done(problems);
  }
  ok("Signed in to Cloudflare");
  if (!c.url || !c.database_id) {
    no("AtlasChat hasn't been put live yet", "Run `npm run setup`.");
    return done(problems);
  }

  const page = await get(`${c.url}/privacy`);
  if (page.status === 200) ok(`Live at ${c.url}`);
  else no(`${c.url} isn't answering (${page.status || "no connection"})`, "Run `npm run setup` to put it live again. If your internet is down, that's the cause.");

  if (await webhookAnswers(c)) ok("Answers Instagram's webhook check");
  else no("The webhook check fails", "Your Worker doesn't have its keys. Run `npm run setup`: it stores them again.");

  const env = readEnv();
  const listed = wrangler(["secret", "list", "--name", c.worker_name]);
  const missing = ["INBOUND_SECRET", "ADMIN_PASSWORD", "META_VERIFY_TOKEN", "META_APP_SECRET"].filter((k) => !listed.out.includes(`"${k}"`));
  if (listed.ok && missing.length) no(`Missing in the Worker: ${missing.join(", ")}`, missing.includes("META_APP_SECRET") && !env.META_APP_SECRET ? "The Meta app isn't finished. Run `npm run setup`." : "Run `npm run setup`: it stores them again.");
  else if (listed.ok) ok("Passwords and keys are stored");

  const pending = (() => {
    const t = sql(c, `SELECT name FROM ${TRACK}`);
    return t.ok ? migrationFiles().filter((f) => !t.rows.some((r) => r.name === f)) : null;
  })();
  if (pending === null) no("Couldn't read the database", "Run `npm run setup`.");
  else if (pending.length) no(`The database is ${pending.length} change${pending.length === 1 ? "" : "s"} behind this folder`, "Run `npm run update`.");
  else ok("Database is up to date");

  const s = settings(c);
  if (!s?.ig_token) {
    no("Instagram isn't connected", `Open ${c.url}/login on a computer and click Log in with Instagram.`);
    return done(problems);
  }
  const me = await instagram(s.ig_token, "/me?fields=username");
  if (me?.username) ok(`Instagram connected as @${me.username}`);
  else no("Instagram refused the saved login", `It expired or was revoked. Open ${c.url}/auth/start and approve again.`);

  const subs = await instagram(s.ig_token, "/me/subscribed_apps");
  const fields = subs?.data?.[0]?.subscribed_fields ?? [];
  if (fields.includes("messages") && fields.includes("comments")) ok("Subscribed to your DMs and comments");
  else if (subs) no("Instagram isn't set to send your DMs and comments here", `Open ${c.url}/auth/start and approve again: that switches them on.`);

  if (!s.webhook_at) {
    no("Nothing has ever arrived from Instagram", "Send your account a DM from another account. Still nothing? The Meta app isn't Live (step 9 in MY-SETUP.md) or its webhook wasn't saved (step 5).");
  } else if (Date.now() - Number(s.webhook_at) > 24 * 3600_000) {
    warn(`Nothing has arrived from Instagram since ${ago(Number(s.webhook_at))}`);
    info("Fine on a quiet account. If people did message you, check the Meta app is still Live and its webhook still points at your address.");
  } else ok(`Instagram's last delivery: ${ago(Number(s.webhook_at))}`);

  const errors = sql(c, `SELECT kind, COUNT(*) n FROM errors WHERE created_at > ${Date.now() - 24 * 3600_000} GROUP BY kind ORDER BY n DESC LIMIT 5`);
  if (errors.ok && errors.rows.length) {
    warn(`Problems logged in the last 24 hours: ${errors.rows.map((r) => `${r.kind} (${r.n})`).join(", ")}`);
    info("A handful is normal (deleted comments, accounts that vanished). Many of one kind: see docs/TROUBLESHOOTING.md.");
  } else if (errors.ok) ok("No problems logged in the last 24 hours");

  if (aiScriptReady() && env.ANTHROPIC_API_KEY) ok("AI replies (beta) are ready to switch on in the console");
  else info("AI replies (beta) are off: optional, see docs/AI.md.");
  done(problems);
}
function done(problems) {
  say();
  say(problems ? bold(red(`${problems} thing${problems === 1 ? "" : "s"} to fix (above).`)) : bold(green("Everything checks out.")));
  process.exitCode = problems ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------------- update

async function update() {
  say();
  say(bold("AtlasChat update"));
  const c = readConfig();
  build(c);
  if (!c.url || !c.database_id || placeholders().length) throw fail("AtlasChat isn't set up yet in this folder. Run `npm run setup`.");
  step("Database");
  migrate(c);
  step("Putting the new version live");
  await deploy(c, "update");
  ok(`Live at ${c.url}`);
  say();
  say(bold(green("Updated.")) + dim("  Run `npm run check` if you want to be sure."));
}

// ------------------------------------------------------------------------------------------------------------ main

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`AtlasChat needs Node 22 or newer (you have ${process.versions.node}). Install the current version from https://nodejs.org, then run this again.`);
  process.exit(1);
}

try {
  if (MODE === "prepare") {
    // Runs after every `npm install`: makes sure the built files exist, so tests, typecheck and the preview work on a
    // fresh copy. Never asks anything, never touches the network.
    build(readConfig());
  } else {
    if (!existsSync(WRANGLER)) {
      say("Installing AtlasChat's tools (about a minute, once)…");
      // `npm ci` installs exactly what package-lock.json lists and never rewrites it, so the folder stays clean for updates.
      const r = spawnSync(existsSync(at("package-lock.json")) ? "npm ci --no-audit --no-fund" : "npm install --no-audit --no-fund", { cwd: ROOT, stdio: "inherit", shell: true });
      if (r.status !== 0) throw fail("Installing the tools failed (see above). Check your internet connection and run `npm run setup` again.");
    }
    if (MODE === "setup") await setup();
    else if (MODE === "check") await check();
    else if (MODE === "update") await update();
    else if (MODE === "preflight") {
      build(readConfig());
      const left = placeholders();
      if (left.length) throw fail(["Setup isn't finished, so nothing was deployed. Run `npm run setup`.", ...left.map((l) => `  ${l}`)]);
    } else throw fail(`Unknown command "${MODE}". Use: npm run setup, npm run check or npm run update.`);
  }
} catch (e) {
  if (!(e instanceof Stop)) throw e;
  say();
  say(e.failed ? red(bold("Stopped: ")) + e.message : yellow(bold("Paused: ")) + e.message);
  if (e.failed) say(dim("\nNothing is lost. Fix the above and run `npm run setup` again: it continues from here."));
  process.exitCode = e.failed ? 1 : 0;
} finally {
  rl?.close();
}
