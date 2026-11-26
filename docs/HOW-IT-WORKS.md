# How AtlasChat works, in plain words

You don't need any of this to use AtlasChat. It's here for when you're curious, or when something breaks and you want to know which piece to look at.

## The five pieces

| Piece | What it is | Where it lives |
| --- | --- | --- |
| **Instagram** | Where your followers comment and message you | Instagram |
| **Your Meta app** | Your permission slip. Instagram only lets a registered app read and send DMs for an account, so setup has you register one. It's free and only you use it. | developers.facebook.com |
| **Your AtlasChat** | A small program that is always on. It receives what happens on your Instagram and sends your replies. | Your Cloudflare account |
| **Your database** | Every conversation, contact, automation and number | Your Cloudflare account |
| **The console** | The website where you build automations, read your inbox and see your numbers. It's part of your AtlasChat, at your own address. | Your browser |

Nothing runs on your computer once setup is done. You can close the laptop: your automations keep answering.

## What happens when someone comments

Say your automation is "when someone comments `GUIDE` on this reel, DM them the guide".

1. **They comment "guide".** Instagram notices your Meta app is listening and sends your AtlasChat a short notification within a second. (That notification is called a *webhook*.)
2. **AtlasChat checks it's really Instagram.** Every notification is signed with your app's secret. Anything unsigned is thrown away.
3. **AtlasChat looks for a matching automation.** The keyword has to appear as a whole word. Capital letters don't matter: `guide`, `Guide` and `GUIDE!!` all match; `guides` does not.
4. **It sends your DM** through Instagram's official API, and your public reply under the comment if you wrote one.
5. **They tap your button.** Instagram tells AtlasChat, and the next message in your flow goes out.
6. **Everything is saved.** The conversation shows up in your Inbox and the numbers on Home and on the automation go up.

Each person gets an automation once. If they comment the same keyword again, nothing is sent twice.

## What happens when someone DMs you

The same thing, without the comment. The message arrives in your Inbox right away. If you have an automation for a keyword in DMs, a story reply or a first-ever message, it runs. Otherwise the message waits for you to answer from the Inbox or from the Instagram app.

## The 24-hour rule

Instagram's most important rule for any DM tool: **an automated message can only be sent within 24 hours of that person's last message, comment or button tap.** After that the door closes until they write again. AtlasChat never sends outside it, and each conversation in the Inbox shows how long is left.

You, by hand, can always reply from the Instagram app. The rule is only for automation.

## Your passwords and keys

Setup makes them on your computer and puts them in two places:

- **`.env`** in this folder: your own copy.
- **Your Worker's secrets** on Cloudflare: stored encrypted. They can be used by your AtlasChat but never read back out, not even by you.

`MY-SETUP.md` also has your console password, so you can find it. All of these files are ignored by git, which means they're never uploaded if you share your code.

## How updates work

`npm run update` downloads the newest AtlasChat, applies any database changes it brings (each change is applied once and ticked off), and puts the new version live. Your settings live in `fewchat.config.json` and `.env`, which updates never touch.

## What it costs to run

AtlasChat deploys on **Cloudflare's Workers Free plan ($0)**. Nothing in this repo turns on Workers Paid. Do not upgrade to the $5 a month plan unless you decide the free caps below are too small.

Checked against Cloudflare's pricing docs. These bindings are in `templates/wrangler.jsonc`:

| Binding | What it does | Workers Free | When $5/mo (Workers Paid) matters |
| --- | --- | --- | --- |
| Worker (`atlas-chat`) | The program itself, including the webhook | 100,000 requests a day, 10 ms of CPU per invocation | A busy day, or any invocation that needs more than 10 ms of CPU (Cloudflare error 1102). Typing pauses do not count as CPU. |
| Cron (`* * * * *`) | Once a minute: quiet threads, due sends, token refresh | Cron triggers are included. 5 per account. This app uses one. Each run counts as a request and has the same 10 ms CPU cap. | The CPU cap, not the existence of the cron. |
| D1 (`DB`, database `atlas-chat`) | Conversations, automations, settings | 5 million row reads a day, 100,000 row writes a day, 5 GB, 10 databases | A busy inbox or a history import. Past the daily read cap, every read fails until midnight UTC. |
| Queue (`SEND_QUEUE`, `atlas-chat-send`) | Autopilot sends, so typing pauses can outlast a webhook | 10,000 operations a day (about 3 per message: write, read, delete). 24 hour retention. | More than a few thousand queued sends a day. If the binding is missing, the fast path and the cron send inline instead. |
| Durable Object (`LIVE`, class `LiveHub`, SQLite) | Live Inbox tabs | SQLite Durable Objects are included. 100,000 requests a day, 13,000 GB-s a day. Sockets hibernate between pings. The paid-only key-value backend is not used. | Many Inbox tabs left open all day, past the free duration. |
| Workers AI (`AI`) | Voice notes and video, via Deepgram Nova-3 with Whisper as fallback | 10,000 neurons a day. These two models are in the free allocation. | More transcription than that in one UTC day. Photos use Anthropic, not Workers AI. |

- **The AI replies**, if you turn them on, are billed by Anthropic for what they write: roughly a few cents per conversation. That is separate from Cloudflare, and the setter stays off until you add a key.
- **Instagram and Meta** charge nothing for an app on your own account. App Review is not required. The app does have to be Live.

## Glossary

- **API**: the official door a program uses to talk to a service. AtlasChat only uses Instagram's official one.
- **Automation**: one "when this happens, send that" that you built in the console. Also called a flow.
- **Cloudflare**: the company whose computers run your AtlasChat.
- **Console**: AtlasChat's website, at your own address ending in `/admin`.
- **D1**: Cloudflare's name for the database.
- **Deploy**: put a version of AtlasChat live. Setup and update do it for you.
- **Keyword**: the word that starts an automation.
- **Meta app**: your registration with Meta that lets AtlasChat act for your Instagram account.
- **Node.js**: the free program that runs AtlasChat's setup on your computer.
- **Private reply**: Instagram's name for the DM a tool may send to someone who just commented. One per comment.
- **Queue**: a waiting line for outgoing messages, so they go out in order and under Instagram's hourly limit.
- **Secret**: a password or key stored encrypted in your Worker.
- **Terminal**: the app where you type commands (Terminal on a Mac, PowerShell on Windows).
- **Token**: Instagram's 60-day pass that lets AtlasChat act for your account. Log in with Instagram, or paste a long-lived token under Settings. AtlasChat renews it by itself and never shows it back.
- **Trigger**: what starts an automation: a comment, a story reply, a DM keyword.
- **Webhook**: the notification Instagram sends your AtlasChat the moment something happens.
- **Worker**: Cloudflare's name for a small always-on program. Your AtlasChat is one.
- **wrangler**: Cloudflare's command-line tool. Setup drives it for you.
