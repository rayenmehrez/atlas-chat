# CLAUDE.md

AtlasChat is Rayen Mehrez's self-hosted Instagram DM automation for `@rayen.mhz`, built on FewChat (MIT, Copyright 2026 Jason Cooperson). It does comment-to-DM, story and keyword automations on a visual flow builder, a live Inbox, Contacts, and a Home page of DM metrics, in a console (Home, Contacts, Automation, AI, Inbox, Settings) that anyone who has used Manychat will find familiar. An AI setter that answers DMs in your voice with Claude is included as a beta, off by default. It runs on your own Cloudflare account through the official Instagram API. The Worker name is `atlas-chat`. Defaults for the business (Atlas AI), the site (rayenmehrez.me) and the community name (Atlas AI Academy) live in `scripts/setup.mjs`. Contact email, the DM link, the Meta app, and every token stay blank until setup.

**First time here?** The user says "set this up" → follow [`SETUP.md`](SETUP.md). `npm run setup` (`scripts/setup.mjs`) does the work and continues where it stopped; `npm run check` says what works and what doesn't; `npm run update` brings a newer version live.

**Who you're helping.** Many people running this have never used a terminal. Explain in plain words, do every step you can yourself, and hand over one thing at a time. The plain-language docs are `README.md`, `docs/HOW-IT-WORKS.md`, `docs/TROUBLESHOOTING.md` and `docs/AI.md`: keep them true when you change how something works.

**One link** (`SKOOL_LINK`, any link of the owner's: a site, a shop, a Skool community) is what automations and the AI send as `{{SKOOL_LINK}}`. When the AI setter is on, it never books calls, never discounts, never promises what isn't in the script.

## Where your stuff lives

Everything that is the owner's is git-ignored, so `git pull` never collides with it:

- `fewchat.config.json`: their answers (handle, business, contact email, link) and the ids setup collected (Worker name, Cloudflare account, D1 id, Instagram app id, the Worker's URL). **`wrangler.jsonc` and `src/brand.ts` are built from `templates/` and this file** by `npm run setup` (and by `postinstall`): edit the JSON or the template, never the built file.
- `.env`: passwords and keys. `npm run setup` stores every one that's filled in as a Worker secret (`wrangler secret bulk`). Never print it.
- `MY-SETUP.md`: their console address and password and the Meta steps with their values. Rewritten on every setup run. Never read it aloud.
- `src/prompt.ts`, `src/knowledge.ts`: the optional AI's script and product facts, copied from `templates/` once. The framework (engage → rapport → permission → qualify → bridge → link → close), objections and actions are proven; the facts and the voice are theirs. **Every handoff the setter shouldn't have needed = a line added to `src/knowledge.ts`.** While a `<<FILL` is left in either, or there's no `ANTHROPIC_API_KEY`, the AI can't be switched on and never drafts (`aiBlocker` in `src/ready.ts`); nothing else needs them.

The database keeps a list of the files in `migrations/` it already has (table `_fewchat_migrations`). A new migration is a new `.sql` file there; setup and update apply it once. A database from before that table existed is adopted on the first run (each file is tried; "duplicate column" / "already exists" counts as applied).

## How it works

Cloudflare Worker `atlas-chat`, D1 database `atlas-chat`, queue `atlas-chat-send`, Durable Object `LiveHub` (SQLite), Workers AI. All five are on the Workers Free plan, with daily caps. Workers Paid ($5/mo) is not required to deploy. See docs/HOW-IT-WORKS.md, "What it costs to run". Do not upgrade the Cloudflare plan unless Rayen says so.

1. **Inbound.** Webhook `POST /meta` (signed `X-Hub-Signature-256` with the Instagram app secret), field `messages` (echoes arrive inside it with `is_echo`). Attachments become `[voice note]`, `[image]`, `[shared a post]`, story replies are prefixed. Messages dedupe on Instagram `mid`. A missed-DM sync (`src/sync.ts`) runs every minute against the conversations API. Group chats only arrive through that sync and each is its own read-only Inbox conversation (`g:<thread id>`, sender per message); the AI never answers one.
2. **Echoes** (anything sent from the account that this Worker didn't send: you by hand, another tool) are recorded as "YOU" and kill any pending draft. A thread is only drafted when its last message is from the lead.
3. **Drafting.** The webhook fast path waits 5s for a burst to settle, then Claude (`src/brain.ts`, script in `src/prompt.ts`) drafts JSON `reply | stop | react | handoff | flag`, 1-4 bubbles, stage, note. The cron (every minute) is the fallback once a thread has been quiet 45s. It also refreshes the 60-day Instagram token weekly.
4. **AI on or off, no approval queue.** The switch on the AI page (`autopilot`) sends drafts within seconds; off drafts nothing (flows still run, you reply from the Inbox). Each thread also has its own "turn on here" switch, for testing on one thread while the master switch stays off.
5. **Outbound.** `POST graph.instagram.com/v26.0/me/messages`, one call per bubble, with seen + typing dots paced at 100 wpm. `{{SKOOL_LINK}}` is filled at send time. **Never sends outside the 24h window** (Instagram's rule for automated messages).
6. **Comment-to-DM** (`src/comments.ts`): a comment matching a trigger keyword (whole word, any case, `*` = any; post-specific triggers win) gets one private reply DM plus an optional public reply. One DM per person per trigger. The setter only drafts once they answer the DM.
7. **Connect Instagram:** the first "Log in with Instagram" on a fresh install claims and connects it (only the account named in `fewchat.config.json` may), and `/auth/start` (console login) reconnects later. Either runs Instagram business login, stores a 60-day token in D1 `settings`, and subscribes the account to the webhook fields.

## Automations (node graph)

`src/graph.ts` (model, validate, publish, stats), `src/flows.ts` (runtime), `src/admin_flows.ts` (page + editor routes), `src/flow_editor.ts` (the canvas). Tests: `test/automations.test.ts`, `test/flows.test.ts`.

- **Model.** An automation = a `triggers` row (source comment | dm | story | mention | welcome | none, keywords, post or story, public replies, name, folder) + its graph: `flow_nodes` (trigger | message | delay | condition | action | randomizer) and `flow_edges` (one per output port). Message = bubbles with buttons + quick replies, one Send API call per bubble.
- **Published view.** A published automation opens read-only with a "You are viewing a published version" bar, a Key metrics panel (sends, unique contacts, opened, clicked; each tile lists the people and can tag them) and an Edit Automation button. Editing starts from there; Publish returns to it. A never-published draft opens straight in the editor.
- **Draft vs live.** The editor autosaves the draft; Publish validates and copies it live. LIVE = enabled, OFF = disabled after a publish, DRAFT = never published. Delete = Trash.
- **Runtime.** One run per person per automation. Messages send (24h window), smart delays of 15s or less run inline (a pause, then typing dots), longer ones park for the cron. Conditions: tag, stage, last message keyword, follows you, AI paused. Actions: tag, set stage, pause / resume AI, start another automation, **handoff** (resumes the AI for the lead and ends the flow). Comment triggers: the first bubble goes out as the private reply (button templates work there), then the run waits for a tap or reply.
- **Stats.** Sent, Opened (read receipts, a floor), Clicked, per-button CTR. Instagram has no delivery webhook.
- **Testing.** The editor's Test button gives a 3-digit code; DM it to the account from a second account and it runs the editor's current graph on a hidden copy, repeatable, never touching real stats. A comment trigger's first message goes as a plain DM in a test.
- **Not possible on Instagram Login:** follow-triggered DMs (no follow webhook), buttons and quick replies on desktop (Instagram doesn't render them), more than one private reply per comment.

## Console (`/admin/*`)

Log in with Instagram (`/login`, owner-only: it checks the account id; phones only get the password form) or the password, `ADMIN_PASSWORD`, in the form on the same page (`/admin/password` is the same password as browser basic auth, for scripts). Every request is wrapped (`guarded` in `src/index.ts`): an error gives a self-reloading "busy" page, never Cloudflare's error screen.

The shell (`page()` in `src/admin.ts`, CSS in `src/theme.ts`): a sidebar with Home, Contacts, Automation, AI, Inbox, Settings, a collapse button, My Profile and a light / dark toggle; a title bar; white panels on a gray canvas. On a phone the sidebar is a bottom tab bar.

- **Home** `/admin/dashboard?range=7d|30d|90d|all` (`src/home.ts`, charts in `src/charts.ts`): messages received, people who messaged, new contacts, automation reach, reply rate and click-through rate, each against the same number of days before; messages per day; what people did with your automation DMs (opened is a floor: read receipts only); top automations; runs by trigger. Days are your local days (a `tz` cookie).
- **Contacts** `/admin/contacts` (`src/contacts.ts`): everyone who DMed or commented, searchable, filtered by tag; a row opens the thread.
- **AI** `/admin/ai`: the setter's on/off switch, its numbers (AI messages sent and spend, links sent, link clicks, handoffs waiting, flagged), the stage funnel (`src/moves.ts` reads each lead's furthest move from the thread itself), its settings, what it learned, and friends & family.
- **Inbox** `/admin/inbox`: live (WebSocket to `LiveHub`, 3s poll fallback), search and filters, full thread with media, 24h window countdown, hand reply, react, reply-to, pause/resume, tags, per-thread AI switch.
- **Settings** `/admin/settings` (your link, link tracking) and the AI page's settings → D1 `settings`: `autopilot`, `skool_link`, `track_links`, `pause_on_manual_reply`, `auto_resume_hours`. `withSettings(env)` layers them over the wrangler vars everywhere. **Friends & family** (on the AI page): a lead tagged `friend` never gets the AI (automations they trigger still run).
- **Link tracking** (`src/links.ts`, off by default): `{{SKOOL_LINK}}` goes out as `<ORIGIN>/l/<code>`, which logs the click (city/country) and 302s. Instagram's preview crawler is not counted.

## Autonomy

`src/autonomy.ts`, `src/fastpath.ts`, `src/media.ts`; tests in `test/autonomy.test.ts`.

- **Your manual reply pauses the thread** (`pause_on_manual_reply`), auto-resuming `auto_resume_hours` (default 6, `0` = never) after your last hand-sent DM. Instagram echoes carry no app id, so another tool's automated echo is told apart by shape: a template card, or text that already went out to 3+ other people. Admin pauses and handoffs never auto-resume. **Any new sender must call `markOutgoing` before the Send API**, or its own echo pauses the thread.
- **Follow-ups:** nudge 1 at +3h, nudge 2 at +6h after that, none later than 20h after the lead's last message, max 2. Any lead message, echo, pause, flag or stop cancels.
- **Voice notes, images, shares, story replies:** voice notes and videos transcribe on Workers AI (Deepgram Nova-3, Whisper fallback); images, shared posts and the story they replied to go through Claude vision. **Instagram's media links need a User-Agent header** or they 302 to an HTML page. Some messages arrive `is_unsupported` with no file at all; nothing can fetch those.
- **React instead of reply:** closers after a wrapped convo ("thanks", "🙏") get a ❤️, not another closer.
- **Bot disclosure:** `DISCLOSE` in `src/autonomy.ts` (off by default) adds one "heads up, i use an AI assistant" line to the first autopilot reply in a thread. California's bot law covers sales bots; turning it on is the owner's call.

## Customers (Skool, optional)

With `SKOOL_AUTH_TOKEN` set (your Skool `auth_token` cookie, a one-year token), the cron reads your Skool group (`SKOOL_GROUPS[0]` in `src/brand.ts`):
- **Join verification** (`src/joins.ts`): every 10 min, new members are matched to DM leads, only on proof of WHO (full name, their own tracked link opened from the member's Skool location, a nickname + "just joined" at that moment) plus an independent signal. A click alone is never proof. Confirmed = stage `joined`, tag `member`, nudges stop.
- **Roster** (`src/roster.ts`): the whole member list (active + churned), 3 pages per 10 min (Skool's WAF blocks bursts), matched by the Instagram link on their Skool profile, a confirmed join, or a unique exact full name. The setter gets a "Customer:" line: members are never pitched, churned members get one no-guilt win-back.
Without the token both are skipped and everything else works.

## Manychat (if you also run it)

- **Thread ownership:** Instagram gives an active thread to one app, and Manychat owns every thread its flows touch. Our send then fails with `code 100 ... not the thread owner` (subcode 2534037); `deliver` in `src/setter.ts` catches it, finds the lead in Manychat by IG id and sends through Manychat's API instead. That needs `MANYCHAT_API_KEY`. Moving the automations here removes the dependency.
- **Never run the same keyword in both**, or leads get two DMs. Move a keyword here, then toggle Manychat's off (don't delete it: that's the rollback).
- **Never set a default IG conversation-routing app on your Facebook Page.** It can break Manychat.
- Follow-to-DM ("say hi to new followers") is Manychat-only (a Meta-gated event); its DM echoes here as YOU and the follower's reply goes to the setter.

## Rules

- Bots reply only within 24h of the lead's last message. Humans (you, from the Instagram app) have no limit.
- Official Instagram APIs only. Meta also wants automated replies within 30 seconds: the fast path is built for that, don't add long send delays.
- Instagram only details a conversation's newest 20 messages; older media shows as labels. Media is fetched at view time and never stored (Meta Platform Terms: delete Platform Data when it's no longer needed).
- `Standard Access` with Instagram Login covers an account you own or manage: **App Review is not required** (Meta's own table), but the app must be **Live** for outside accounts' webhooks to arrive.

## Commands

```bash
npm run setup       # the installer: safe to run again any time (scripts/setup.mjs)
npm run check       # looks at the live install and says what works
npm run update      # git pull, npm install, new migrations, deploy
npm run preview     # the console on localhost:8791 with sample data (password: ADMIN_PASSWORD in .dev.vars)
npm test            # vitest, real SQL via a node:sqlite D1 shim (test/d1shim.ts); runs against the stand-ins in test/
npm run typecheck
npm run deploy      # refuses while setup isn't finished
npx wrangler tail   # live logs
node scripts/fc.mjs # automations from the terminal: list, show, posts, comments, copy, set, publish, on/off, test, trash
```

**Use `scripts/fc.mjs` for automation work instead of driving the console in a browser.** It changes automations through the console's own endpoints (so the editor's validation runs), signed in with `ADMIN_PASSWORD` from `.env`, at `ORIGIN` from `src/brand.ts`; lists read D1 through wrangler. A follow-up post on the same keyword is `node scripts/fc.mjs copy <id> --post next --publish`, run before the post goes up. Each automation has its own one-DM-per-person, so someone who comments on both posts gets both DMs.

## Lab Notes

- `wrangler d1 execute --remote --file` runs through D1's import API, which blocks every other write while it runs: space big imports out. D1 refuses `CREATE TEMP TABLE`; use a real scratch table and drop it.
- D1 allows 100 bound params: batch cron reads 90 ids per `IN (...)` query, never one query per lead (it silently stalls on the subrequest limit).
- The Workers Free plan's 5M D1 row reads/day runs out fast with a big inbox or a history import, and then every read fails until midnight UTC (console, cron and webhook recording all go down). Workers Paid ($5/mo) removes that ceiling.
- History import: `IG_TOKEN=... SKOOL_GROUP=<slug> node scripts/backfill.mjs .backfill/out --since=<ISO date>` writes resumable SQL chunks; `scripts/import-loop.sh .backfill/out` streams them into D1. Start with 90 days.
- Phone alerts: install ntfy, pick a long random topic, add `ALERT_TOPIC=` to `.env`, `npm run setup`. You get pinged on failed sends, a stuck queue, no webhook for 60 min, missed comments, or a cron step failing 5 runs in a row.
- Removing an install: `wrangler queues consumer remove <name>-send <name>` first (a Worker that consumes a queue can't be deleted), then `wrangler delete --name <name>`, `wrangler queues delete <name>-send`, `wrangler d1 delete <name>`.
- Cloudflare's remote D1 refuses an upload containing an empty statement (a stray `;`), which the local one accepts: test SQL changes against a real database, not only `--local`.
- After a non-trivial change, note what was non-obvious here so the next session doesn't relearn it.
