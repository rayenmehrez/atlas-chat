# How FewChat works, in plain words

You don't need any of this to use FewChat. It's here for when you're curious, or when something breaks and you want to know which piece to look at.

## The five pieces

| Piece | What it is | Where it lives |
| --- | --- | --- |
| **Instagram** | Where your followers comment and message you | Instagram |
| **Your Meta app** | Your permission slip. Instagram only lets a registered app read and send DMs for an account, so setup has you register one. It's free and only you use it. | developers.facebook.com |
| **Your FewChat** | A small program that is always on. It receives what happens on your Instagram and sends your replies. | Your Cloudflare account |
| **Your database** | Every conversation, contact, automation and number | Your Cloudflare account |
| **The console** | The website where you build automations, read your inbox and see your numbers. It's part of your FewChat, at your own address. | Your browser |

Nothing runs on your computer once setup is done. You can close the laptop: your automations keep answering.

## What happens when someone comments

Say your automation is "when someone comments `GUIDE` on this reel, DM them the guide".

1. **They comment "guide".** Instagram notices your Meta app is listening and sends your FewChat a short notification within a second. (That notification is called a *webhook*.)
2. **FewChat checks it's really Instagram.** Every notification is signed with your app's secret. Anything unsigned is thrown away.
3. **FewChat looks for a matching automation.** The keyword has to appear as a whole word. Capital letters don't matter: `guide`, `Guide` and `GUIDE!!` all match; `guides` does not.
4. **It sends your DM** through Instagram's official API, and your public reply under the comment if you wrote one.
5. **They tap your button.** Instagram tells FewChat, and the next message in your flow goes out.
6. **Everything is saved.** The conversation shows up in your Inbox and the numbers on Home and on the automation go up.

Each person gets an automation once. If they comment the same keyword again, nothing is sent twice.

## What happens when someone DMs you

The same thing, without the comment. The message arrives in your Inbox right away. If you have an automation for a keyword in DMs, a story reply or a first-ever message, it runs. Otherwise the message waits for you to answer from the Inbox or from the Instagram app.

## The 24-hour rule

Instagram's most important rule for any DM tool: **an automated message can only be sent within 24 hours of that person's last message, comment or button tap.** After that the door closes until they write again. FewChat never sends outside it, and each conversation in the Inbox shows how long is left.

You, by hand, can always reply from the Instagram app. The rule is only for automation.

## Your passwords and keys

Setup makes them on your computer and puts them in two places:

- **`.env`** in this folder: your own copy.
- **Your Worker's secrets** on Cloudflare: stored encrypted. They can be used by your FewChat but never read back out, not even by you.

`MY-SETUP.md` also has your console password, so you can find it. All of these files are ignored by git, which means they're never uploaded if you share your code.

## How updates work

`npm run update` downloads the newest FewChat, applies any database changes it brings (each change is applied once and ticked off), and puts the new version live. Your settings live in `fewchat.config.json` and `.env`, which updates never touch.

## What it costs to run

- **Cloudflare's free plan** covers a quiet account. Its main limit is how much the database can be read in a day; a busy inbox runs through it, and then everything pauses until midnight UTC. Workers Paid ($5 a month) lifts that limit. Move to it once people are messaging you every day.
- **The AI replies**, if you turn them on, are billed by Anthropic for what they write: roughly a few cents per conversation.
- **Instagram and Meta** charge nothing.

## Glossary

- **API**: the official door a program uses to talk to a service. FewChat only uses Instagram's official one.
- **Automation**: one "when this happens, send that" that you built in the console. Also called a flow.
- **Cloudflare**: the company whose computers run your FewChat.
- **Console**: FewChat's website, at your own address ending in `/admin`.
- **D1**: Cloudflare's name for the database.
- **Deploy**: put a version of FewChat live. Setup and update do it for you.
- **Keyword**: the word that starts an automation.
- **Meta app**: your registration with Meta that lets FewChat act for your Instagram account.
- **Node.js**: the free program that runs FewChat's setup on your computer.
- **Private reply**: Instagram's name for the DM a tool may send to someone who just commented. One per comment.
- **Queue**: a waiting line for outgoing messages, so they go out in order and under Instagram's hourly limit.
- **Secret**: a password or key stored encrypted in your Worker.
- **Terminal**: the app where you type commands (Terminal on a Mac, PowerShell on Windows).
- **Token**: Instagram's 60-day pass that lets FewChat act for your account. Log in with Instagram, or paste a long-lived token under Settings. FewChat renews it by itself and never shows it back.
- **Trigger**: what starts an automation: a comment, a story reply, a DM keyword.
- **Webhook**: the notification Instagram sends your FewChat the moment something happens.
- **Worker**: Cloudflare's name for a small always-on program. Your FewChat is one.
- **wrangler**: Cloudflare's command-line tool. Setup drives it for you.
