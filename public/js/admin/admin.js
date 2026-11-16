/* Admin panel. Teachers can look (students, progress, results, leads); only admins change things (plans, payments, roles,
 * blocks, trials). The server checks the role on every call; this page only hides what you can't use. */
import { initAuth, ready, onUser, currentUser, signOut } from "../app/auth.js";
import { api, config } from "../app/api.js";
import { esc, icon, toast, modal, onAct, spinner } from "../app/ui.js";
import { applyTheme } from "../app/theme.js";

applyTheme();
const main = document.getElementById("main");
let me = null, cfg = null, cleanup = null;
const isAdmin = () => me && me.access && me.access.role === "admin";

// ---------------------------------------------------------------- small helpers
const fmt = (ms) => (ms ? new Date(ms).toLocaleString("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");
const day = (ms) => (ms ? new Date(ms).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" }) : "–");
const money = (amount, cur) => (typeof amount === "number" ? (cur && cur !== "USD" ? amount + " " + cur : "$" + amount) : "–");
const tierBadge = (t) => `<span class="badge ${t === "pro" || t === "self" ? "ok" : t === "trial" ? "info" : t === "blocked" ? "bad" : t === "staff" ? "warn" : ""}">${esc(t || "–")}</span>`;
const statusBadge = (s) => `<span class="badge ${s === "paid" ? "ok" : s === "refunded" || s === "revoked" || s === "disputed" ? "bad" : ""}">${esc(s || "–")}</span>`;
const link = (href, text) => `<a href="${esc(href)}" data-nav>${esc(text)}</a>`;
const userLink = (uid, label) => link("/admin/user/" + encodeURIComponent(uid), label || uid);
async function copy(text) { try { await navigator.clipboard.writeText(text); toast("Copied", "ok"); } catch { toast(text); } }
const ERRORS = {
  "admin-only": "Only admins can do that.",
  network: "Can't reach the server.",
  unverified: "Staff roles need an account that signed in with Google, an email link or Telegram.",
  "own-role": "You can't change your own role.",
  "own-block": "You can't block yourself.",
};
function errText(e) { return (e && ERRORS[e.code]) || "Failed: " + ((e && e.code) || "error"); }

function go(path, replace = false) { if (replace) history.replaceState({}, "", path); else history.pushState({}, "", path); route(); }

// ---------------------------------------------------------------- views
async function viewStats() {
  const s = await api("admin?view=stats");
  const rev = Object.entries(s.revenue30d || {}).map(([c, v]) => money(Math.round(v * 100) / 100, c)).join(" + ") || "$0";
  const src = Object.entries(s.leadsBySource || {}).sort((a, b) => b[1] - a[1]);
  const u = s.usageToday || {};
  main.innerHTML = `
    <div class="pagehead"><h1>Overview</h1></div>
    <div class="stats" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
      <div class="stat"><b>${s.users}</b><span>accounts</span></div>
      <div class="stat"><b>${s.newUsers7d}</b><span>new in 7 days</span></div>
      <div class="stat"><b>${s.paidActive}</b><span>paying now</span></div>
      <div class="stat"><b>${s.trialsActive}</b><span>on a trial now</span></div>
      <div class="stat"><b>${s.payments30d}</b><span>payments, 30 days</span></div>
      <div class="stat"><b>${esc(rev)}</b><span>revenue, 30 days</span></div>
      <div class="stat"><b>${s.leads7d}</b><span>Telegram leads, 7 days</span></div>
    </div>
    <h2 style="margin-top:22px">Today's AI spend counters (UTC day)</h2>
    <div class="stats" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
      <div class="stat"><b>${u.aiCalls || 0}</b><span>AI teacher answers (${u.aiPeople || 0} people)</span></div>
      <div class="stat"><b>${u.voiceMinutes || 0}</b><span>voice teacher minutes reserved</span></div>
      <div class="stat"><b>${(u.ttsChars || 0).toLocaleString()}</b><span>natural voice characters</span></div>
    </div>
    <h2 style="margin-top:22px">Where Telegram leads came from (7 days)</h2>
    ${src.length ? `<div class="card scroll-x"><table class="table"><thead><tr><th>Source</th><th>Leads</th></tr></thead><tbody>
      ${src.map(([k, n]) => `<tr><td>${esc(k)}</td><td>${n}</td></tr>`).join("")}</tbody></table>
      <p class="tiny muted" style="margin:8px 0 0">v12 = came from video lesson 12's link · start = opened the bot directly · landing / footer = from the website.</p></div>`
      : `<div class="card empty">No leads yet.</div>`}`;
}

async function viewUsers(query) {
  const q = query.get("q") || "", filter = query.get("filter") || "";
  main.innerHTML = `
    <div class="pagehead"><h1>Students</h1></div>
    <form class="row wrap-row" id="searchForm" style="margin-bottom:12px">
      <input class="input grow" id="q" type="search" placeholder="Name, email, @telegram, phone digits or account ID" value="${esc(q)}" style="min-width:220px">
      <button class="btn dark">${icon("search", "ico")} Search</button>
    </form>
    <div class="seg" style="margin-bottom:12px">${[["", "Newest"], ["paid", "Paying"], ["trial", "On trial"], ["staff", "Staff"], ["blocked", "Blocked"]].map(([v, l]) =>
      `<button data-act="filter" data-v="${v}" class="${filter === v ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="list">${spinner()}</div>`;
  main.querySelector("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = main.querySelector("#q").value.trim();
    go("/admin/users" + (v ? "?q=" + encodeURIComponent(v) : filter ? "?filter=" + filter : ""));
  });
  const off = onAct(main, { filter: (el) => go("/admin/users" + (el.dataset.v ? "?filter=" + el.dataset.v : "")) });
  const r = await api("admin?view=users&q=" + encodeURIComponent(q) + "&filter=" + encodeURIComponent(filter));
  const list = main.querySelector("#list");
  if (!list) return off;
  list.innerHTML = r.users.length ? `<div class="card scroll-x" style="padding:4px 8px"><table class="table">
    <thead><tr><th>Student</th><th>Plan</th><th>Paid until / trial</th><th>Joined</th><th>Source</th></tr></thead><tbody>
    ${r.users.map((x) => `<tr class="clickable" data-act="open" data-uid="${esc(x.uid)}">
      <td><b>${esc(x.name || "—")}</b><div class="tiny muted">${esc([x.email, x.telegram ? "tg:" + x.telegram : null, x.phone].filter(Boolean).join(" · ") || x.uid)}</div></td>
      <td>${tierBadge(x.tier)}${x.role !== "student" ? ` <span class="badge warn">${esc(x.role)}</span>` : ""}</td>
      <td class="small">${x.paidUntil ? day(x.paidUntil) : x.trialEndsAt ? "trial → " + day(x.trialEndsAt) : "–"}</td>
      <td class="small">${day(x.createdAt)}</td>
      <td class="small">${esc(x.source || "–")}</td></tr>`).join("")}
    </tbody></table></div><p class="tiny muted">${r.users.length} shown</p>` : `<div class="card empty">Nobody found.</div>`;
  const off2 = onAct(list, { open: (el) => go("/admin/user/" + encodeURIComponent(el.dataset.uid)) });
  return () => { off(); off2(); };
}

async function viewUser(uid) {
  const d = await api("admin?view=user&uid=" + encodeURIComponent(uid));
  const u = d.user, a = d.access, admin = isAdmin();
  const results = Object.entries(d.results || {}).sort((x, y) => (y[1].at || 0) - (x[1].at || 0));
  main.innerHTML = `
    <a class="back" href="/admin/users" data-nav>${icon("left", "ico")} Students</a>
    <div class="pagehead"><h1>${esc(u.name || u.email || u.uid)}</h1>${tierBadge(a.tier)}${u.blocked ? '<span class="badge bad">blocked</span>' : ""}</div>
    <div class="grid grid-2">
      <section class="card">
        <h3>Account</h3>
        <dl class="kv">
          <dt>Account ID</dt><dd><code>${esc(u.uid)}</code> <button class="linkbtn small" data-act="copy" data-v="${esc(u.uid)}">copy</button></dd>
          <dt>Email</dt><dd>${esc(u.email || "–")}</dd>
          <dt>Telegram</dt><dd>${u.telegram ? esc(u.telegram) : "–"}</dd>
          <dt>Phone</dt><dd>${esc(u.phone || "–")}</dd>
          <dt>Signed in with</dt><dd>${esc(u.provider || "–")}</dd>
          <dt>Language</dt><dd>${esc(u.lang || "–")}</dd>
          <dt>Joined</dt><dd>${fmt(u.createdAt)}</dd>
          <dt>Last seen</dt><dd>${fmt(u.lastSeenAt)}</dd>
          <dt>Came from</dt><dd>${esc(u.source || "–")}</dd>
        </dl>
      </section>
      <section class="card">
        <h3>Access</h3>
        <dl class="kv">
          <dt>Role</dt><dd>${esc(a.role)}</dd>
          <dt>Plan</dt><dd>${tierBadge(a.tier)}</dd>
          <dt>Paid until</dt><dd>${fmt(a.paidUntil)}</dd>
          <dt>Trial</dt><dd>${u.trial ? "started " + fmt(u.trial.startedAt) + ", ends " + fmt(u.trial.endsAt) : "not used"}</dd>
          <dt>AI answers / day</dt><dd>${a.limits.ai}</dd>
          <dt>Voice minutes / 30 days</dt><dd>${a.limits.voiceMin}</dd>
        </dl>
        ${d.progress ? `<h3 style="margin-top:14px">Progress</h3><dl class="kv"><dt>Course days done</dt><dd>${d.progress.daysDone}</dd><dt>XP</dt><dd>${d.progress.xp}</dd><dt>Streak</dt><dd>${d.progress.streak} days</dd><dt>Video lessons opened</dt><dd>${d.progress.videos}</dd><dt>Words in review</dt><dd>${d.progress.review}</dd></dl>` : `<p class="muted small">No progress saved yet.</p>`}
      </section>
    </div>

    ${admin ? `<section class="card stack" style="margin-top:12px">
      <h3 style="margin:0">Give a plan (cash, bank transfer, gift, compensation)</h3>
      <form class="row wrap-row" id="grantForm">
        <select class="input" name="tier" style="width:auto"><option value="self">Self-study</option><option value="pro">Pro</option></select>
        <select class="input" name="days" style="width:auto">${[3, 7, 30, 90, 180, 365].map((n) => `<option value="${n}" ${n === 30 ? "selected" : ""}>${n} days</option>`).join("")}</select>
        <input class="input" name="amount" type="number" min="0" step="0.01" placeholder="Amount received (optional)" style="width:200px">
        <select class="input" name="currency" style="width:auto"><option>USD</option><option>UZS</option><option>RUB</option></select>
        <input class="input grow" name="note" maxlength="200" placeholder="Note (e.g. paid by Click, receipt #…)" style="min-width:180px">
        <button class="btn primary">Give plan</button>
      </form>
      <p class="tiny muted" style="margin:0">Days are added on top of any plan they already have. It shows in their payments below and can be revoked.</p>
    </section>
    <section class="card stack" style="margin-top:12px">
      <h3 style="margin:0">Manage</h3>
      <div class="row wrap-row">
        <label class="small">Role
          <select class="input" id="roleSel" style="width:auto;display:inline-block;margin-left:6px">${["student", "teacher", "admin"].map((r) => `<option ${a.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></label>
        <button class="btn sm" data-act="role">Save role</button>
        <button class="btn sm ${u.blocked ? "ok" : "bad"}" data-act="block" data-v="${u.blocked ? "0" : "1"}">${u.blocked ? "Unblock" : "Block"}</button>
        ${u.trial ? `<button class="btn sm" data-act="resettrial">Allow another trial</button>` : ""}
      </div>
      <label class="field"><span>Private note (only staff see it)</span><textarea class="input" id="note" maxlength="1000">${esc(u.note || "")}</textarea></label>
      <button class="btn sm" style="align-self:flex-start" data-act="note">Save note</button>
    </section>` : ""}

    <section style="margin-top:16px">
      <h2>Payments</h2>
      ${d.payments.length ? `<div class="card scroll-x" style="padding:4px 8px"><table class="table">
        <thead><tr><th>When</th><th>What</th><th>Amount</th><th>Via</th><th>Status</th><th></th></tr></thead><tbody>
        ${d.payments.map((p) => `<tr>
          <td class="small">${fmt(p.at)}</td>
          <td class="small">${esc(p.plan || (p.tier ? p.tier + " · " + p.days + " days" : "–"))}${p.note ? `<div class="tiny muted">${esc(p.note)}</div>` : ""}</td>
          <td>${money(p.amount, p.currency)}</td>
          <td class="small">${esc(p.provider || "–")}${p.by ? `<div class="tiny muted">by ${esc(p.by)}</div>` : ""}</td>
          <td>${statusBadge(p.status)}${p.reason ? `<div class="tiny muted">${esc(p.reason)}</div>` : ""}</td>
          <td>${admin && p.status === "paid" ? `<button class="btn sm ghost" data-act="revoke" data-v="${esc(p.id)}">Revoke</button>` : ""}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="card empty">No payments.</div>`}
    </section>

    <section style="margin-top:16px">
      <h2>Quiz results</h2>
      ${results.length ? `<div class="card scroll-x" style="padding:4px 8px"><table class="table"><thead><tr><th>Quiz</th><th>Best</th><th>Last</th></tr></thead><tbody>
        ${results.slice(0, 80).map(([k, r]) => `<tr><td>${esc(k)}</td><td>${r.best != null ? r.best : r.score}/${r.total}</td><td class="small">${fmt(r.at)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card empty">No quizzes yet.</div>`}
    </section>

    <section style="margin-top:16px">
      <h2>Voice teacher calls</h2>
      ${d.voice.length ? `<div class="card scroll-x" style="padding:4px 8px"><table class="table"><thead><tr><th>Started</th><th>Charged</th><th>Status</th></tr></thead><tbody>
        ${d.voice.map((v) => `<tr><td class="small">${fmt(v.startedAt)}</td><td>${Math.round((v.charged || 0) / 60 * 10) / 10} min</td><td class="small">${esc(v.status || "–")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card empty">No calls.</div>`}
    </section>`;

  const post = async (body, okMsg) => {
    try { await api("admin", { method: "POST", body: { uid, ...body } }); toast(okMsg, "ok"); route(); }
    catch (e) { toast(errText(e), "bad"); }
  };
  const gf = main.querySelector("#grantForm");
  if (gf) gf.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(gf);
    post({ action: "grant", tier: f.get("tier"), days: Number(f.get("days")), amount: f.get("amount"), currency: f.get("currency"), note: f.get("note") }, "Plan given");
  });
  return onAct(main, {
    copy: (el) => copy(el.dataset.v),
    role: () => post({ action: "role", role: main.querySelector("#roleSel").value }, "Role saved"),
    block: (el) => post({ action: "block", blocked: el.dataset.v === "1" }, el.dataset.v === "1" ? "Blocked" : "Unblocked"),
    resettrial: () => post({ action: "reset-trial" }, "They can start a trial again"),
    note: () => post({ action: "note", note: main.querySelector("#note").value }, "Note saved"),
    revoke: (el) => {
      const m = modal(`<h2>Revoke this payment?</h2><p class="muted">Their access is recalculated at once. Use this for refunds you made by hand or mistakes. (Refunds made in Whop revoke automatically.)</p>
        <label class="field"><span>Reason</span><input class="input" id="why" maxlength="200" placeholder="e.g. refunded by bank transfer"></label>
        <div class="row" style="margin-top:12px"><button class="btn bad" data-act="yes">Revoke</button><button class="btn" data-close>Cancel</button></div>`);
      onAct(m.el, { yes: async () => {
        const reason = m.el.querySelector("#why").value;
        m.close();
        try { await api("admin", { method: "POST", body: { action: "revoke", paymentId: el.dataset.v, reason } }); toast("Revoked", "ok"); route(); }
        catch (e) { toast(errText(e), "bad"); }
      } });
    },
  });
}

async function viewPayments() {
  if (!isAdmin()) { main.innerHTML = `<div class="card empty">Only admins can see payments.</div>`; return; }
  const [p, un] = await Promise.all([api("admin?view=payments"), api("admin?view=unmatched")]);
  main.innerHTML = `
    <div class="pagehead"><h1>Payments</h1></div>
    ${un.unmatched.length ? `<section class="card stack" style="margin-bottom:16px;border-color:var(--amber)">
      <h3 style="margin:0">${icon("bolt", "ico")} Payments without a matching account (${un.unmatched.length})</h3>
      <p class="small muted" style="margin:0">Whop said someone paid, but the checkout didn't say which TruckTalk account it was for (e.g. they paid from a link outside the app). It attaches by itself if the membership event names the account. Otherwise find the student and use “Give plan” on their page, with the Whop payment ID in the note.</p>
      <div class="scroll-x"><table class="table"><thead><tr><th>When</th><th>Whop payment</th><th>Plan</th><th>Amount</th><th>Whop buyer</th></tr></thead><tbody>
      ${un.unmatched.map((x) => `<tr><td class="small">${fmt(x.at)}</td><td class="small"><code>${esc(x.id)}</code></td><td>${esc(x.plan || "–")}</td><td>${money(x.amount, x.currency)}</td><td class="small">${esc([x.email, x.username ? "@" + x.username : null].filter(Boolean).join(" · ") || "–")}</td></tr>`).join("")}
      </tbody></table></div></section>` : ""}
    ${p.payments.length ? `<div class="card scroll-x" style="padding:4px 8px"><table class="table">
      <thead><tr><th>When</th><th>Student</th><th>What</th><th>Amount</th><th>Via</th><th>Status</th></tr></thead><tbody>
      ${p.payments.map((x) => `<tr><td class="small">${fmt(x.at)}</td><td class="small">${userLink(x.uid)}</td><td class="small">${esc(x.plan || (x.tier ? x.tier + " · " + x.days + "d" : "–"))}</td><td>${money(x.amount, x.currency)}</td><td class="small">${esc(x.provider || "–")}</td><td>${statusBadge(x.status)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card empty">No payments yet.</div>`}`;
}

async function viewLeads() {
  const r = await api("admin?view=leads");
  main.innerHTML = `
    <div class="pagehead"><h1>Telegram leads</h1></div>
    <p class="muted small">Everyone who wrote to the bot (TRUCK, a lesson link, /start). “First source” is the link that brought them: v12 means video lesson 12.</p>
    ${r.leads.length ? `<div class="card scroll-x" style="padding:4px 8px"><table class="table">
      <thead><tr><th>Name</th><th>Telegram</th><th>Phone</th><th>First source</th><th>Messages</th><th>First</th><th>Last</th></tr></thead><tbody>
      ${r.leads.map((l) => `<tr><td>${esc(l.name || "–")}</td>
        <td class="small">${l.username ? `<a href="https://t.me/${esc(l.username)}" target="_blank" rel="noopener">@${esc(l.username)}</a>` : `<code>${esc(l.id)}</code>`}</td>
        <td class="small">${esc(l.phone || "–")}</td><td class="small">${esc(l.firstSource || "–")}${l.sources ? `<div class="tiny muted">${esc(Object.keys(l.sources).join(", "))}</div>` : ""}</td>
        <td>${l.count || 1}</td><td class="small">${day(l.firstAt)}</td><td class="small">${fmt(l.lastAt)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card empty">No leads yet.</div>`}`;
}

async function viewAudit() {
  if (!isAdmin()) { main.innerHTML = `<div class="card empty">Only admins can see the audit log.</div>`; return; }
  const r = await api("admin?view=audit");
  main.innerHTML = `
    <div class="pagehead"><h1>Audit log</h1></div>
    <p class="muted small">Every change made in this panel, with who made it.</p>
    ${r.audit.length ? `<div class="card scroll-x" style="padding:4px 8px"><table class="table">
      <thead><tr><th>When</th><th>Who</th><th>What</th><th>Student</th><th>Details</th></tr></thead><tbody>
      ${r.audit.map((x) => `<tr><td class="small">${fmt(x.at)}</td><td class="small">${userLink(x.by)}</td><td>${esc(x.action)}</td><td class="small">${x.target ? userLink(x.target) : "–"}</td><td class="tiny"><code>${esc(JSON.stringify(x.details || {}))}</code></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card empty">Nothing yet.</div>`}`;
}

async function viewMarketing() {
  const vids = await fetch("/data/videos.json").then((r) => r.json());
  const base = (cfg.appUrl && !/localhost/.test(cfg.appUrl) ? cfg.appUrl : location.origin).replace(/\/$/, "");
  let ch = "";
  const paint = () => {
    const appLink = (n) => `${base}/v/${n}${ch ? `?src=${ch}-v${n}` : ""}`;
    const tgLink = (n) => (cfg.telegramBot ? `https://t.me/${cfg.telegramBot}?start=v${n}` : "");
    const caption = (v) => `📚 ${v.n}-dars: ${v.title.uz} (${v.title.en}).\n\nToʻliq dars — har bir gap ovozi va tarjimasi bilan, test ham bor (bepul):\n👉 ${appLink(v.n)}` +
      (tgLink(v.n) ? `\n\nYoki Telegram botimizga yozing: ${tgLink(v.n)}` : "") + `\n\n#trakchi #truckdriver #inglizTili #CDL #Amerika`;
    main.innerHTML = `
      <div class="pagehead"><h1>Marketing links</h1></div>
      <p class="muted small">Put these in each video's description and pinned comment. The lesson link opens that exact lesson (no sign-up needed) and remembers that the student came from that video. ${cfg.telegramBot ? "The Telegram link opens the bot with that lesson." : "Set TELEGRAM_BOT_USERNAME to get Telegram links too."}</p>
      <div class="row wrap-row" style="margin-bottom:12px"><span class="small muted">Where will you post?</span>
        <div class="seg">${[["", "Any"], ["yt", "YouTube"], ["ig", "Instagram"], ["tt", "TikTok"], ["fb", "Facebook"]].map(([v, l]) => `<button data-act="ch" data-v="${v}" class="${ch === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="card stack" style="margin-bottom:12px"><b>Website (all lessons, type a lesson number)</b><div class="row wrap-row"><code>${esc(base + "/" + (ch ? "?src=" + ch : ""))}</code><button class="btn sm" data-act="copy" data-v="${esc(base + "/" + (ch ? "?src=" + ch : ""))}">Copy</button></div></div>
      <div class="grid grid-2">${vids.map((v) => `
        <div class="card stack">
          <div><b>${v.n}. ${esc(v.title.uz)}</b> <span class="muted small">· ${esc(v.title.en)}</span></div>
          <div class="row wrap-row small"><code style="overflow-wrap:anywhere">${esc(appLink(v.n))}</code><button class="linkbtn" data-act="copy" data-v="${esc(appLink(v.n))}">copy</button></div>
          ${tgLink(v.n) ? `<div class="row wrap-row small"><code>${esc(tgLink(v.n))}</code><button class="linkbtn" data-act="copy" data-v="${esc(tgLink(v.n))}">copy</button></div>` : ""}
          <button class="btn sm ghost" style="align-self:flex-start" data-act="copy" data-v="${esc(caption(v))}">Copy caption</button>
        </div>`).join("")}</div>`;
  };
  paint();
  return onAct(main, { ch: (el) => { ch = el.dataset.v; paint(); }, copy: (el) => copy(el.dataset.v) });
}

// ---------------------------------------------------------------- router + access
const ROUTES = [
  [/^\/admin\/?$/, "stats", viewStats],
  [/^\/admin\/users\/?$/, "users", viewUsers],
  [/^\/admin\/user\/([^/]+)\/?$/, "users", viewUser],
  [/^\/admin\/payments\/?$/, "payments", viewPayments],
  [/^\/admin\/leads\/?$/, "leads", viewLeads],
  [/^\/admin\/audit\/?$/, "audit", viewAudit],
  [/^\/admin\/marketing\/?$/, "marketing", viewMarketing],
];

let seq = 0;
async function route() {
  const my = ++seq;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  if (!me || !me.access || !me.access.staff) return gate();
  let found = ROUTES[0], params = [];
  for (const r of ROUTES) { const m = r[0].exec(location.pathname); if (m) { found = r; params = m.slice(1).map(decodeURIComponent); break; } }
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.view === found[1]));
  main.innerHTML = spinner();
  try {
    const c = await found[2](params[0] !== undefined ? params[0] : new URLSearchParams(location.search), new URLSearchParams(location.search));
    if (my === seq && typeof c === "function") cleanup = c;
  } catch (e) {
    if (my !== seq) return;
    main.innerHTML = `<div class="card empty"><p>${esc(errText(e))}</p><button class="btn" id="retry">Try again</button></div>`;
    main.querySelector("#retry").addEventListener("click", route);
  }
  window.scrollTo(0, 0);
}

function gate() {
  const signedIn = !!currentUser();
  document.getElementById("who").textContent = "";
  main.innerHTML = `<div class="card stack center" style="max-width:460px;margin:40px auto">
    <h1>${icon("shield")} TruckTalk admin</h1>
    <p class="muted">${signedIn ? "This account isn't an admin or teacher. Sign in with the admin account (its email must be in ADMIN_EMAILS), or ask an admin to give you the teacher role." : "Sign in with your admin or teacher account."}</p>
    ${signedIn ? `<button class="btn" id="out">Sign out</button>` : ""}
    <a class="btn primary" href="/app/signin?next=/admin">Sign in</a>
  </div>`;
  const out = main.querySelector("#out");
  if (out) out.addEventListener("click", async () => { await signOut(); location.reload(); });
}

async function loadMe() {
  try { me = await api("me"); } catch { me = null; }
  const u = me && me.user;
  document.getElementById("who").textContent = u ? (u.name || u.email || u.uid) + " · " + me.access.role : "";
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-nav]");
  if (a && a.origin === location.origin && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); go(a.pathname + a.search); }
});
addEventListener("popstate", route);

(async () => {
  cfg = await config();
  initAuth();
  await ready;
  await loadMe();
  route();
  let last = currentUser() ? currentUser().uid : null;
  onUser(async (u) => { const uid = u ? u.uid : null; if (uid === last) return; last = uid; await loadMe(); route(); });
})();
