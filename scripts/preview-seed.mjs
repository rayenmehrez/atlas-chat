// Sample data for the local preview (scripts/preview.sh): about 45 days of DMs from made-up people, six automations,
// tags, read receipts, button taps and link opens. Prints SQL. Deterministic apart from the clock.
let x = 42; const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const now = Date.now(), DAY = 864e5, HOUR = 36e5, MIN = 6e4;
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const out = [];
const firsts = ["Maya","Leo","Nina","Omar","Priya","Theo","Ines","Kofi","Sana","Luca","Aiko","Dex","Remy","Wes","Zoe","Noor","Eli","Tess","Hugo","Mira"];
const lasts = ["Park","Okafor","Silva","Novak","Haddad","Lindqvist","Moreau","Tanaka","Reyes","Boateng","Kaur","Fischer"];
const autos = [
  [1, "comment", "AGENT", "AI receptionist build", 0.34],
  [2, "comment", "EDIT", "Claude video editor", 0.26],
  [3, "comment", "GUIDE", "Creator starter guide", 0.18],
  [4, "story", "*", "Story reply: send the template", 0.14],
  [5, "dm", "PRICING", "Pricing question", 0.08],
];
for (const [id, source, kw, name] of autos)
  out.push(`INSERT INTO triggers (id, source, keyword, name, dm, enabled, created_at, published_at, updated_at) VALUES (${id}, ${q(source)}, ${q(kw)}, ${q(name)}, 'here you go', ${id === 5 ? 0 : 1}, ${now - 50 * DAY}, ${now - 50 * DAY}, ${now - id * DAY});`);
out.push(`INSERT INTO triggers (id, source, keyword, name, dm, enabled, created_at) VALUES (6, 'comment', 'HOOKS', 'Viral hook library (draft)', 'x', 0, ${now - 2 * DAY});`);
const tags = ["ai receptionist build", "video editor", "starter guide", "member", "hot", "agency"];
let mid = 0, sendId = 0, lead = 100;
for (let d = 44; d >= 0; d--) {
  const dow = new Date(now - d * DAY).getUTCDay();
  const base = 6 + (44 - d) * 0.45 + (dow === 0 || dow === 6 ? -3 : 2) + (d === 12 || d === 5 ? 22 : 0); // growth, weekdays, two viral days
  const n = Math.max(1, Math.round(base * (0.7 + rnd() * 0.6)));
  for (let i = 0; i < n; i++) {
    const id = String(++lead), at = now - d * DAY - Math.floor(rnd() * 20 * HOUR) - HOUR;
    if (at > now - 5 * MIN) continue;
    const first = pick(firsts), last = pick(lasts), named = rnd() < 0.75;
    const user = (first + (rnd() < 0.5 ? "." : "_") + last).toLowerCase() + (rnd() < 0.4 ? Math.floor(rnd() * 90) : "");
    out.push(`INSERT INTO leads (subscriber_id, username, first_name, created_at, last_inbound_at) VALUES (${q(id)}, ${q(user)}, ${named ? q(first + " " + last) : "NULL"}, ${at}, ${at});`);
    const r = rnd(); let acc = 0; const auto = autos.find((a) => (acc += a[4]) > r) ?? null;
    const msg = (role, text, t) => out.push(`INSERT INTO messages (subscriber_id, role, text, created_at, mid) VALUES (${q(id)}, ${q(role)}, ${q(text)}, ${t}, 'm${++mid}');`);
    if (auto && rnd() < 0.85) {
      const [tid, source, kw] = auto;
      if (source === "comment") out.push(`INSERT INTO comments (comment_id, subscriber_id, username, media_id, text, trigger_id, status, created_at) VALUES ('c${mid}', ${q(id)}, ${q(user)}, 'reel${tid}', ${q(kw + " please")}, ${tid}, ${rnd() < 0.03 ? "'failed'" : "'sent'"}, ${at});`);
      else msg("lead", source === "story" ? "[replying to your story] need this" : "pricing?", at);
      out.push(`INSERT INTO flow_starts (trigger_id, subscriber_id, status, created_at) VALUES (${tid}, ${q(id)}, 'sent', ${at + 2000});`);
      const seen = rnd() < 0.62, tapped = seen && rnd() < 0.7, linked = tapped && rnd() < 0.55, replied = rnd() < (tapped ? 0.45 : 0.12);
      out.push(`INSERT INTO flow_sends (id, trigger_id, subscriber_id, status, node_id, part, urls, seen_at, created_at) VALUES (${++sendId}, ${tid}, ${q(id)}, 'sent', 'm0', 0, NULL, ${seen ? at + 3 * MIN : "NULL"}, ${at + 2000});`);
      msg("bot", "yooo here's the thing you asked for 👇\n[buttons: Send the link]", at + 2000);
      if (tapped) {
        out.push(`INSERT INTO flow_taps (send_id, port, created_at) VALUES (${sendId}, 'nx', ${at + 4 * MIN});`);
        msg("lead", "[tapped] Send the link", at + 4 * MIN);
        out.push(`INSERT INTO flow_sends (id, trigger_id, subscriber_id, status, node_id, part, urls, seen_at, created_at) VALUES (${++sendId}, ${tid}, ${q(id)}, 'sent', 'm1', 0, '{"go":"https://example.com/guide"}', ${at + 5 * MIN}, ${at + 4 * MIN + 2000});`);
        msg("bot", "here it is\n[buttons: Open the guide (https://example.com/guide)]", at + 4 * MIN + 2000);
        if (linked) out.push(`INSERT INTO flow_taps (send_id, port, created_at) VALUES (${sendId}, 'go', ${at + 6 * MIN});`);
      }
      if (replied) { msg("lead", pick(["this is sick ty", "wait how do i set it up", "appreciate it!!", "do you have one for editors"]), at + 20 * MIN); if (rnd() < 0.6) msg("bot", "anytime, lmk how it goes", at + 40 * MIN); }
      if (rnd() < 0.8) out.push(`INSERT INTO lead_tags (subscriber_id, tag, created_at) VALUES (${q(id)}, ${q(tags[tid - 1] ?? "hot")}, ${at});`);
    } else {
      msg("lead", pick(["hey saw your reel", "how do i start", "love the content", "can you help with my channel"]), at);
      if (rnd() < 0.5) { msg("bot", "yo! what are you working on?", at + 30 * MIN); if (rnd() < 0.5) msg("lead", "trying to grow my page", at + 50 * MIN); }
    }
    if (rnd() < 0.08) out.push(`INSERT OR IGNORE INTO lead_tags (subscriber_id, tag, created_at) VALUES (${q(id)}, ${q(pick(["member", "hot", "agency"]))}, ${at});`);
  }
}
out.push(`INSERT INTO settings (key, value) VALUES ('ig_profile', ${q(JSON.stringify({ username: "rayen.mhz", name: "Rayen Mehrez", pic: null, at: now + 365 * DAY }))});`);
console.log(out.join("\n"));
