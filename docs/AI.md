# AI replies (beta)

AtlasChat can answer DMs for you with Claude, in your own voice, from a script and facts you write. It is optional and still a work in progress. Everything else in AtlasChat works without it, and it stays off until you finish the steps below.

**What it's built for:** selling one thing in the DMs, such as a paid community or a course. It gets to know the person, asks a few questions, and sends your link when they're a fit. It doesn't book calls and it never offers discounts.

**What it costs:** Anthropic bills you for what the AI writes, roughly a few cents per conversation. The AI page in your console shows the running total.

## Turn it on

### 1. Get an Anthropic API key

Create an account at console.anthropic.com, add a payment method, and create a key under **API keys**. Open `.env` in this folder and paste it after `ANTHROPIC_API_KEY=`. Don't paste it anywhere else.

### 2. Write the script

Two files hold everything the AI knows. Both start as templates with blanks that look like `<<FILL: what goes here>>`.

- **`src/prompt.ts`**: who you are, what you sell, who buys it, and how you talk.
- **`src/knowledge.ts`**: the facts people ask about before buying. Price, what's inside, what they need, and the honest "no" answers.

Fill in every blank. The AI can't be switched on while one is left.

**The easy way:** open Claude Code in this folder and say **"help me write the AI script"**. It asks you about your offer one question at a time and fills in both files.

**The part that matters most is your voice.** Don't describe how you talk. Paste 10 to 20 messages you really typed to people in your DMs, and let the script be built from those: your length, your lowercase, your emoji habits, the words you use.

### 3. Put it live

```bash
npm run setup
```

It stores your key and puts the new script live. `npm run check` then says "AI replies (beta) are ready to switch on".

### 4. Try it on one conversation first

Leave the main switch off. From another Instagram account, DM yourself. Open that conversation in the Inbox and click **AI off · turn on here**. Send another message from the other account and watch the reply.

Read ten or so replies before you trust it. Anything that doesn't sound like you: fix `src/prompt.ts`. Any fact it got wrong or didn't know: add it to `src/knowledge.ts`. Then `npm run setup` again.

### 5. Switch it on for everyone

Open **AI** in the console and turn **AI replies** on. From then on it answers every DM within seconds, inside Instagram's 24-hour window.

## Good to know

- **Replying by hand pauses the AI** in that conversation, so you never talk over each other. It picks up again after a few hours (you set how many on the AI page).
- **Friends & family** on the AI page: people the AI must never answer.
- **When it doesn't know, it hands the conversation to you** and says it's checking. Those show under Handoffs on the AI page. When you answer one by hand, it learns the answer for next time.
- **It reads voice notes and photos** people send, not just text.
- **Telling people it's an AI:** some places require it (California's bot law covers sales bots). Set `DISCLOSE` to `true` in `src/autonomy.ts` and the first AI reply in each conversation says so.
- **Turning it off:** the same switch. Automations keep running and you reply from the Inbox.

## If you sell a Skool community

Two extras switch on when you add `SKOOL_AUTH_TOKEN` to `.env` (your Skool `auth_token` cookie: skool.com → your browser's developer tools → Application → Cookies) and run `npm run setup`:

- **Members are never pitched.** The AI knows who already joined and who left.
- **Joins are confirmed.** When someone from your DMs joins, the console marks it.

Also turn on **link tracking** in Settings, so clicks on your link are counted per person.
