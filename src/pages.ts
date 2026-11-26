// Public pages Meta requires before the app can go Live (privacy policy, terms, data deletion instructions).
import { BUSINESS, CONTACT_EMAIL, IG_HANDLE, SITE } from "./brand";
import { APP_NAME, FAVICON } from "./theme";

const PRIVACY = `<h1>Privacy Policy</h1>
<p>Last updated October 28, 2026.</p>
<p>${APP_NAME} is operated by ${BUSINESS} (${SITE}) to manage Instagram direct messages and comments for the Instagram account @${IG_HANDLE}. It is not offered to other businesses or users.</p>
<h2>What we collect</h2>
<p>When you send a direct message to @${IG_HANDLE}, or comment on one of its posts, reels or live videos, we receive the message or comment text, your Instagram-scoped user ID, and your public username and name through the official Instagram API.</p>
<h2>How we use it</h2>
<p>Only to read and reply to your messages, and to send you the resource you asked for when your comment includes a keyword the account advertised (for example "Comment AI and I'll send you the guide"). Replies may be drafted by an AI model (Anthropic's Claude), and a person may review them before sending. We do not sell your data, use it for advertising, or share it with anyone else.</p>
<h2>Retention</h2>
<p>Conversation history is kept for as long as it is needed to continue the conversation, and is deleted on request.</p>
<h2>Contact</h2>
<p>${CONTACT_EMAIL}</p>`;

const DELETION = `<h1>Data Deletion</h1>
<p>To delete everything this app has stored about you (your messages, username and ID), email ${CONTACT_EMAIL} from any address, or send the DM "delete my data" to @${IG_HANDLE}, and include your Instagram username. We delete it within 7 days and confirm by reply.</p>`;

const TERMS = `<h1>Terms of Service</h1>
<p>Last updated October 28, 2026.</p>
<p>${APP_NAME} is an internal tool operated by ${BUSINESS} (${SITE}) for the Instagram account @${IG_HANDLE}. It is not offered to other businesses or users, and there is nothing to sign up for.</p>
<p>If you message or comment on @${IG_HANDLE}, you may receive replies written or drafted with the help of AI and reviewed by a person. Replies are informational and are not professional, financial or legal advice. You can stop at any time by not replying, or ask a person to take over by saying so.</p>
<p>Your data is handled as described in our <a href="/privacy">Privacy Policy</a>. To have it deleted, see <a href="/data-deletion">Data Deletion</a>.</p>
<p>Questions: ${CONTACT_EMAIL}</p>`;

const PAGES: Record<string, [string, string]> = {
  "/privacy": ["Privacy Policy", PRIVACY],
  "/terms": ["Terms of Service", TERMS],
  "/data-deletion": ["Data Deletion", DELETION],
};

export function legalPage(path: string): Response {
  const [title, body] = PAGES[path] ?? PAGES["/privacy"];
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · ${APP_NAME}</title>${FAVICON}
<style>body{margin:0;background:#fff;color:#1b1b1b;font:16px/1.6 system-ui,sans-serif}main{max-width:680px;margin:0 auto;padding:24px 16px}</style>
</head><body><main>${body}</main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
