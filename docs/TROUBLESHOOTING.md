# Troubleshooting

**Start here, every time:**

```bash
npm run check
```

It looks at your live AtlasChat and lists what works and what doesn't, with the fix next to each problem. Most of this page is the longer version of what it tells you.

Running `npm run setup` again is always safe. It never deletes anything and continues from wherever it stopped.

## During setup

| What you see | What to do |
| --- | --- |
| `npm: command not found` or `node: command not found` | Node.js isn't installed. Get it from nodejs.org (the "LTS" button), close and reopen your terminal, try again. |
| "AtlasChat needs Node 22 or newer" | Install the current version from nodejs.org over the old one. |
| The browser tab for Cloudflare never opened | Run `npm run setup` again. If it still doesn't open, copy the link the terminal prints into your browser. |
| "Cloudflare wants your email address verified" | Click the link in the email Cloudflare sent when you signed up, then run setup again. |
| "doesn't have a workers.dev address yet" | Every Cloudflare account picks one name, once. Open dash.cloudflare.com → Workers & Pages, choose a subdomain, then run setup again. |
| "already has a Worker called atlas-chat" | Something with that name is already on your Cloudflare account. Setup stops instead of replacing it and prints the two ways forward. |
| Something about your plan, or queues | Queues, D1, cron, Workers AI and SQLite Durable Objects are all on the free plan. Read the error. Do not switch to Workers Paid ($5 a month) unless it says the account must, and you have decided to pay. The caps are in docs/HOW-IT-WORKS.md. |
| Anything else | The full details are in `.wrangler/setup.log`. It can contain your Cloudflare account id and email, so read it before sharing it. |

## The Meta app

These are the steps in `MY-SETUP.md`. The step number is where to look.

| Problem | Usual cause |
| --- | --- |
| Meta says the callback URL or verify token couldn't be validated | A stray space, or the wrong value pasted. Copy both again from step 5. Run `npm run check`: if "Answers Instagram's webhook check" has a ✓, your side is fine. |
| An error about the redirect URI when you log in with Instagram | Step 6: the OAuth redirect URI has to match exactly, ending in `/auth/callback`. |
| An error about your developer role, or not being a tester | Step 8: add your Instagram account as an Instagram tester, **and** accept the invite inside Instagram. Both halves are needed. |
| The **Business login settings** button does nothing | Open (unfold) that section of the page first, then click it. |
| Meta won't let you switch to Live | It lists what's missing, usually the privacy policy URL, the app icon or the category from step 7. |
| Meta talks about App Review | You can skip it. For an Instagram account you own, standard access is enough. |

## Messages aren't arriving

`npm run check` says "Nothing has ever arrived from Instagram", or your Inbox stays empty.

1. **Is the Meta app Live?** Step 9. In Development mode, Instagram only delivers messages from accounts that have a role on your app.
2. **Was the webhook saved, with the fields switched on?** Step 5. The fields are separate switches under the callback URL.
3. **Is Instagram connected?** Logging in with Instagram the first time is what tells Instagram to send this account's messages to your AtlasChat. If in doubt, open `<your address>/auth/start` and approve again, or paste a new long-lived token under Settings. It's harmless.
4. **Test from a different account.** A message you send to yourself doesn't count.

## An automation isn't firing

- **Is it LIVE?** A draft does nothing until you click Publish. OFF means it was switched off.
- **Is the keyword a whole word in the comment?** `GUIDE` matches "guide please" but not "guides". Add the plural as a second keyword, separated by a comma.
- **Is it on the right post?** An automation for one post ignores comments on every other post.
- **Did this person already get it?** Each person gets an automation once. To test over and over, use the editor's **Test** button: it gives a 3-digit code to DM from another account.
- **Did the same keyword match another automation?** One for a specific post wins over one for every post.
- **Does Home show "Delivery problems"?** It lists the reason Instagram gave.

## A DM wasn't delivered

- **"The requested user cannot be found"**: that account was deleted or blocked you. Nothing to fix.
- **Sent too late**: more than 24 hours since their last message. Instagram's rule, and AtlasChat doesn't try.
- **"not the thread owner"**: another DM tool on the same Instagram account owns that conversation. Don't run the same keyword in two tools.
- **Buttons don't show**: buttons and quick replies only appear in the Instagram phone app, not on desktop.
- **Lots waiting to send**: Instagram allows about 750 comment DMs an hour. AtlasChat queues the rest and sends them as the hour rolls on.

## The console

- **Forgot the password?** It's in `MY-SETUP.md`, and in `.env` as `ADMIN_PASSWORD`. To change it: edit that line in `.env`, then run `npm run setup`.
- **No "Log in with Instagram" button?** Phones only get the password form, because the Instagram app takes over its approval screen. Use the password, or a computer.
- **A "busy" page that reloads itself**: something failed for a moment. If it stays, see "Everything stopped" below.
- **"Log in with Instagram" refuses you**: it only lets in the Instagram account this AtlasChat was set up for. Wrong username in setup? Fix `instagram_handle` in `fewchat.config.json` and run `npm run setup`.

## Everything stopped at once

On Cloudflare's free plan the database can only be read 5 million rows a day. A busy inbox uses that up, and then the console, your automations and incoming messages all pause until midnight UTC. Nothing is lost: missed comments and messages are picked up afterwards. Workers Paid ($5 a month) removes that ceiling. Stay on the free plan until you decide the cap is the problem.

## Watching it live

```bash
npx wrangler tail
```

Shows what your AtlasChat is doing right now, as it happens. Send yourself a test DM and watch it arrive. Press Ctrl+C to stop.

## Starting over, or removing AtlasChat

To redo your answers: delete `fewchat.config.json` and run `npm run setup`.

To remove AtlasChat from Cloudflare completely (this deletes your conversations and automations for good), run these in order. Replace `atlas-chat` if you chose another name:

```bash
npx wrangler queues consumer remove atlas-chat-send atlas-chat
```

```bash
npx wrangler delete --name atlas-chat
```

```bash
npx wrangler queues delete atlas-chat-send
```

```bash
npx wrangler d1 delete atlas-chat
```

Then delete your app on developers.facebook.com, and remove it in Instagram under Settings → Website permissions → Apps and websites.

## Asking for help

Open an issue on GitHub with what `npm run check` prints and what you expected to happen. **Never post your `.env` or `MY-SETUP.md`**: they hold your passwords.
