# SETUP.md: from this folder to a live FewChat

**If you're a person:** you don't need this page. Run `npm run setup` and follow it. The README has the short version.

**If you're Claude (or another coding agent):** the user said "set this up". This page is your runbook. Assume they have never used a terminal: explain each step in a sentence of plain words before you do it, do everything you can yourself, and only hand them what needs their hands (signing in, clicking in Meta's dashboard, pasting a secret into `.env`). One thing at a time. Tick steps off in chat as they land.

## Rules

- **`npm run setup` does the work.** Don't run wrangler commands by hand, don't edit `wrangler.jsonc` or `src/brand.ts` (they are built from `templates/` and `fewchat.config.json`), and don't re-implement its steps. If it stops, it says why and what to do; fix that and run it again. It always continues where it left off.
- **Secrets never go in chat.** The user pastes them into `.env` themselves. Never `cat .env`, never read `MY-SETUP.md` aloud (it holds their console password): tell the user to open it.
- **Never use `--replace`** unless the user says the existing Worker is an old FewChat of theirs.
- You can't answer the script's questions as it runs, so pass the answers as flags (below). Run by an agent, it never asks: it pauses, prints what it needs, and exits.

## 0. Before you start

Check, and help with whatever is missing:

- `node -v` is 22 or newer. If not: nodejs.org, the LTS installer, then reopen the terminal.
- They have an **Instagram professional account** (Business or Creator). In the Instagram app: Settings → Account type and tools → Switch to professional account. Free.
- They have a **Facebook account** they can log in to (for Meta's developer site).
- A **Cloudflare account** is created during setup if they don't have one. Free to start.

## 1. Three answers

Ask, one at a time:

1. Their Instagram username.
2. Their name or business name. It's shown on the privacy page Meta requires.
3. A contact email. Also shown on that page, so one they're fine with being public.

Optional: their website, and one link their DMs should be able to send (a site, shop or community). Without one, setup uses their Instagram profile, and they can change it later in the console's Settings.

## 2. Run setup

```bash
npm run setup -- --handle=<username> --business="<name>" --email=<email>
```

Add `--website=<site>` and `--link=<https link>` if they gave them.

A browser tab opens for Cloudflare: tell them to sign in (or create a free account) and click **Allow**. Then setup creates the database and queue, builds the tables, makes their passwords, puts FewChat live, and writes `MY-SETUP.md`. It pauses at "Waiting on the Meta app".

If it pauses earlier:

- **More than one Cloudflare account**: it lists them. Ask which, run again with `--account=<id>`.
- **No workers.dev address yet** (brand-new Cloudflare accounts): they pick a subdomain once at dash.cloudflare.com → Workers & Pages. Then run setup again.
- **A Worker with this name already exists**: ask whether it's an old FewChat of theirs. If not, run again with `--name=fewchat-2`.
- **Anything about their plan**: Workers Paid, $5 a month, at dash.cloudflare.com → Workers & Pages → Plans.

## 3. The Meta app (the user clicks, you guide)

Tell the user to open `MY-SETUP.md` in this folder: it has the 9 steps with their own addresses already filled in, to copy and paste. Walk them through one step at a time and wait for "done" after each. Their address is the `url` in `fewchat.config.json`, if you need to refer to it.

The steps, so you can answer questions (in every address, `<url>` is theirs):

1. developers.facebook.com/apps, logged in with the Facebook account that manages the Instagram account. Register as a developer if asked.
2. **Create app** → any name → use case **Other** → type **Business**.
3. Add the **Instagram** product → **API setup with Instagram login**.
4. Note the **Instagram app ID** and **Instagram app secret** on that page.
5. **Configure webhooks**: callback URL `<url>/meta`, verify token from `MY-SETUP.md`. Verify and save, then switch on the fields `messages`, `messaging_postbacks`, `messaging_seen`, `messaging_referral`, `message_reactions`, `message_edit`, `comments`, `live_comments`.
6. **Set up Instagram business login** (unfold that section first: the button does nothing while it's folded) → Business login settings: OAuth redirect URI `<url>/auth/callback`, deauthorize callback `<url>/deauthorize`, data deletion request URL `<url>/data-deletion`.
7. **App settings → Basic**: app domain (the address without `https://`), privacy policy URL `<url>/privacy`, terms URL `<url>/terms`, data deletion callback `<url>/data-deletion`, a category, an app icon (`assets/icon.png` works). Save.
8. **App roles → Roles**: add their Instagram account as an **Instagram tester**, then accept it in Instagram: Settings → Website permissions → Apps and websites → Tester invites.
9. Switch the app from Development to **Live**. Meta may ask for a data use checkup or business details first. **App Review is not needed** for an account they own.

Meta moves things around. If a label isn't where a step says, look for the nearest match on the same page before sending the user elsewhere.

Then:

- Have the user paste the **Instagram app secret** into `.env`, after `META_APP_SECRET=`, and say done.
- Ask for the **Instagram app ID** (a number, not secret) and run:

```bash
npm run setup -- --app-id=<Instagram app ID>
```

It stores the secret, puts the final version live and pauses at "Connect your Instagram account".

## 4. Connect Instagram

Tell the user to, on a computer (the button isn't shown on phones):

1. Open `<url>/login` and click **Log in with Instagram**.
2. Log in as the account they gave in step 1 and approve the three permissions. The first sign-in connects the account; any other Instagram account is turned away.

If Instagram shows an error instead, it names the cause (the redirect URI from Meta step 6, or the tester invite from step 8). They can always get in with the password from `MY-SETUP.md` on the same page, then click **Connect Instagram** at the top left.

They can also paste a long-lived Instagram access token under **Settings**, in **Instagram connection**. That stores the same connection as the button. The box is masked, and the token is never shown again. **Connect with Instagram** on that card is the same approval flow.

Then run:

```bash
npm run check
```

Every line should have a ✓ except "Nothing has ever arrived from Instagram", which is next.

## 5. Prove it

From a **second** Instagram account (a friend's or a spare; a message to yourself doesn't count):

1. **A DM.** Send the account a DM. It should be in the console's Inbox within seconds, and `npm run check` now shows Instagram's last delivery. Nothing arriving means step 9 (not Live) or step 5 (webhook) in almost every case.
2. **A comment automation.** In the console: Automation → New Automation → the template **Comment keyword → DM link** → pick a post, a test keyword and their link → **Publish**. Comment the keyword from the second account: the DM arrives within seconds.

Done = both worked. Show them where things are: the console address, `MY-SETUP.md`, `npm run check`, `npm run update`.

## 6. Offer the extras, one question each

- **Phone alerts** (recommended): install the free ntfy app, subscribe to a long random topic, put it in `.env` as `ALERT_TOPIC=`, run `npm run setup`.
- **Workers Paid** ($5 a month): once people message them daily. See docs/HOW-IT-WORKS.md, "What it costs to run".
- **AI replies (beta)**: docs/AI.md. When they say "help me write the AI script": interview them one short question at a time (what they sell, the price, what's inside, real member results, who buys), and ask them to paste 10 to 20 messages they really typed to people in their DMs. Build the voice from those messages, not from adjectives. Fill every `<<FILL: ...>>` in `src/prompt.ts` and `src/knowledge.ts`, keep the framework, objections and actions as written, then `npm run setup`. They add `ANTHROPIC_API_KEY=` to `.env` themselves.
- **Also running Manychat on this account?** Read CLAUDE.md, "Manychat", before moving any keyword over.
- **Past conversations**: `scripts/backfill.mjs` imports DM history (CLAUDE.md, Lab Notes). 90 days is plenty.
