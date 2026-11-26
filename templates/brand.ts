// Who this AtlasChat runs for: the one file that names the account and the business. Everything else reads it.
// `npm run setup` builds src/brand.ts from this template and your answers in fewchat.config.json; a value you haven't
// given yet stays a REPLACE marker, and `npm run deploy` refuses while one is left.
// Defaults here are Rayen's. Contact email, the workers.dev subdomain, and any Skool slug stay blank until setup.

// Your Worker's public address: tracked links, button links and alert taps point here.
export const ORIGIN = "https://atlas-chat.REPLACE-SUBDOMAIN.workers.dev";
export const IG_HANDLE = "REPLACE_IG_HANDLE"; // the Instagram account, no @
export const BUSINESS = "REPLACE_BUSINESS_NAME"; // who operates the app, on the privacy policy and terms (your company, or your name)
export const SITE = "REPLACE_WEBSITE"; // e.g. example.com
export const CONTACT_EMAIL = "REPLACE_CONTACT_EMAIL"; // privacy + data deletion requests
export const COMMUNITY = "REPLACE_COMMUNITY_NAME"; // what the optional AI sells, as the console names it
// Only if you sell a Skool community: its URL slug(s), e.g. skool.com/my-group → "my-group". The first is live (join +
// roster reads); add old slugs after it if you ever renamed the group. Empty when you don't use Skool.
export const SKOOL_GROUPS: string[] = ["REPLACE-SKOOL-SLUG"];

// "skool.com/<slug>" for any of the slugs, plus our own tracked /l/ links.
export const LINK_RE = new RegExp(SKOOL_GROUPS.length ? `skool\\.com\\/(${SKOOL_GROUPS.join("|")})|\\/l\\/` : "\\/l\\/", "i");
// SQL: does m.text (or text) carry a Skool link for one of the slugs? Never, with no slugs.
export const skoolLinkSql = (col: string) => SKOOL_GROUPS.map((g) => `instr(${col}, 'skool.com/${g}') > 0`).join(" OR ") || "0";
