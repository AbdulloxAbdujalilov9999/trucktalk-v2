/* Profile: who you are and what your plan includes, settings (language, voice, speed, daily goal, theme), stats and badges,
 * connecting Telegram, installing the app, sync status, and signing out. */
import { t, lang, setLang, fmtDate } from "../i18n.js";
import { esc, icon, onAct, toast } from "../ui.js";
import { api, config } from "../api.js";
import { state, setting, setSetting, goal, update, syncNow, subscribe } from "../store.js";
import { signOut, isDemo } from "../auth.js";
import { go, render, planLabel, startTrial, catalog, canInstall, promptInstall, isStandalone } from "../main.js";
import { totalXp, streak, bestStreak } from "../../shared/progress.js";
import { trialLine, certificateStatus } from "./common.js";
import { theme, setTheme } from "../theme.js";
import { play } from "../audio.js";

const GOALS = [10, 30, 50, 100];
const RATES = [0.75, 1, 1.25];
const SAMPLE = "Good morning! Ready for the road?";

function badgeList(p, cat) {
  const done = (n) => !!(p.days[n] && p.days[n].done);
  const courseDone = cat.days.filter((d) => done(d.n)).length;
  const week1 = cat.days.filter((d) => d.week === 1);
  const seen = Object.values(p.videos).filter((v) => v && v.seen).length;
  return [
    { k: "badge.firstDay", on: courseDone >= 1, ic: "star" },
    { k: "badge.week", on: week1.length > 0 && week1.every((d) => done(d.n)), ic: "check" },
    { k: "badge.streak7", on: bestStreak(p) >= 7, ic: "flame" },
    { k: "badge.videos10", on: seen >= 10, ic: "video" },
    { k: "badge.half", on: courseDone >= Math.ceil(cat.days.length / 2), ic: "bolt" },
    { k: "badge.all", on: courseDone >= cat.days.length, ic: "shield" },
  ];
}

const seg = (act, items, current) =>
  `<div class="seg" role="group">${items.map(([v, label]) => `<button data-act="${act}" data-v="${esc(String(v))}" class="${String(v) === String(current) ? "on" : ""}" aria-pressed="${String(v) === String(current)}">${esc(label)}</button>`).join("")}</div>`;

export default async function profile(root) {
  const [cat, cfg] = await Promise.all([catalog(), config()]);
  let editing = false;

  function syncLine() {
    const a = state.me.access;
    if (!a.signedIn) return `<span class="muted">${esc(t("profile.anon"))}</span>`;
    if (state.sync === "saving" || state.sync === "pending") return `<span class="muted">${esc(t("profile.syncing"))}</span>`;
    if (state.sync === "failed" || state.sync === "offline") return `<span class="badge warn">${esc(t("profile.syncFail"))}</span> <button class="linkbtn" data-act="syncnow">${esc(t("profile.syncNow"))}</button>`;
    return `<span class="badge ok">${icon("check", "ico")} ${esc(t("profile.sync"))}</span>`;
  }

  function planCard() {
    const a = state.me.access, v = state.me.voice;
    let status = "";
    if (a.blocked) status = `<span class="badge bad">${esc(t("plan.blocked"))}</span>`;
    else if (a.staff) status = `<p class="muted" style="margin:0">${esc(t("pricing.staff"))}</p>`;
    else if (a.paidUntil && a.paidUntil > Date.now()) status = `<p style="margin:0">${esc(t("paid.until", { plan: planLabel(a), date: fmtDate(a.paidUntil) }))}</p>`;
    else if (a.tier === "trial") status = `<p style="margin:0">${esc(trialLine(a))}</p>`;
    else status = `<p class="muted small" style="margin:0">${esc(t("lock.body"))}</p>`;
    const limits = a.signedIn ? `
      <dl class="kv" style="margin:4px 0 0">
        <dt>${esc(t("profile.aiDaily"))}</dt><dd>${esc(t("teacher.daily", { n: a.limits.ai }))}</dd>
        ${a.limits.voiceMin > 0 ? `<dt>${esc(t("profile.voiceMin"))}</dt><dd>${esc(t("teacher.voiceLeft", { n: v && v.minutesLeft != null ? v.minutesLeft : a.limits.voiceMin }))}</dd>` : ""}
      </dl>` : "";
    return `<section class="card stack">
      <div class="row between"><h2 style="margin:0">${esc(t("profile.plan"))}</h2><span class="chip-plan ${esc(a.tier)}" style="color:var(--text);background:var(--surface-2)">${esc(planLabel(a) || t("plan.free"))}</span></div>
      ${status}
      ${limits}
      <div class="row wrap-row">
        ${a.canStartTrial ? `<button class="btn primary" data-act="trial">${icon("gift", "ico")} ${esc(t("trial.start"))}</button>` : ""}
        ${!a.staff && a.signedIn ? `<a class="btn ${a.canStartTrial ? "ghost" : "primary"}" href="/app/pricing" data-link>${esc(t("lock.seePlans"))}</a>` : ""}
      </div>
    </section>`;
  }

  function paint() {
    const a = state.me.access, u = state.me.user, p = state.progress;
    const name = (u && u.name) || "";
    const ident = u ? [u.email, u.telegram ? "Telegram" + (u.telegram.username ? " @" + u.telegram.username : "") : null, u.phone].filter(Boolean).join(" · ") : "";
    const badges = badgeList(p, cat);
    const seen = Object.values(p.videos).filter((x) => x && x.seen).length;
    const courseDone = cat.days.filter((d) => p.days[d.n] && p.days[d.n].done).length;
    const finalDone = certificateStatus(cat, p).ready;
    const cards = Object.keys(p.srs).length;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone();
    root.innerHTML = `
      <div class="pagehead"><h1>${esc(t("profile.title"))}</h1></div>
      <div class="stack-lg">
        <section class="card row" style="align-items:center">
          <div style="width:54px;height:54px;border-radius:16px;background:var(--navy);color:#fff;display:grid;place-items:center;font-weight:900;font-size:1.3rem;flex:none">${esc((name || "?").trim().charAt(0).toUpperCase() || "?")}</div>
          <div class="grow" style="min-width:0">
            ${a.signedIn ? (editing
              ? `<form class="row" id="nameForm"><input class="input" id="nameIn" maxlength="60" value="${esc(name)}" aria-label="${esc(t("profile.name"))}" autocomplete="name"><button class="btn primary sm">${esc(t("save"))}</button></form>`
              : `<div class="row" style="gap:6px"><b style="font-size:1.15rem">${esc(name || t("profile.name"))}</b><button class="linkbtn small" data-act="edit">${esc(t("profile.name"))} ✎</button></div>`)
              : `<b>${esc(t("home.hiAnon"))}</b>`}
            ${ident ? `<div class="small muted" style="overflow-wrap:anywhere">${esc(ident)}</div>` : ""}
            ${u && u.createdAt ? `<div class="tiny faint">${esc(t("profile.since", { date: fmtDate(u.createdAt) }))}</div>` : ""}
          </div>
        </section>
        ${!a.signedIn ? `<div class="card accent row wrap-row"><b class="grow">${esc(t("home.saveProgress"))}</b><a class="btn dark" href="/app/signin" data-link>${esc(t("signin"))}</a></div>` : ""}
        ${a.signedIn ? planCard() : ""}
        ${a.signedIn && finalDone ? `<a class="card accent row link" href="/app/certificate" data-link>${icon("award", "ico")}<b class="grow">${esc(t("cert.open"))}</b>${icon("chevron", "ico")}</a>` : ""}

        <section>
          <h2>${esc(t("profile.stats"))}</h2>
          <div class="stats six">
            <div class="stat"><b>${streak(p)}</b><span>${esc(t("home.streak"))}</span></div>
            <div class="stat"><b>${bestStreak(p)}</b><span>${esc(t("profile.bestStreak"))}</span></div>
            <div class="stat"><b>${totalXp(p)}</b><span>${esc(t("profile.xp"))}</span></div>
            <div class="stat"><b>${courseDone}<small class="muted" style="font-size:.8rem"> / ${cat.days.length}</small></b><span>${esc(t("home.daysDone"))}</span></div>
            <div class="stat"><b>${seen}<small class="muted" style="font-size:.8rem"> / 50</small></b><span>${esc(t("profile.videosSeen"))}</span></div>
            <div class="stat"><b>${cards}</b><span>${esc(t("profile.cards"))}</span></div>
          </div>
        </section>

        <section>
          <h2>${esc(t("profile.badges"))}</h2>
          <div class="grid grid-3">${badges.map((b) => `
            <div class="card tight row" style="${b.on ? "" : "opacity:.45;filter:grayscale(1)"}">
              <span style="width:38px;height:38px;border-radius:12px;display:grid;place-items:center;flex:none;background:${b.on ? "var(--accent-soft)" : "var(--surface-2)"};color:${b.on ? "#8a5a00" : "var(--faint)"}">${icon(b.ic, "ico")}</span>
              <b class="small">${esc(t(b.k))}</b>
            </div>`).join("")}</div>
        </section>

        <section class="card stack">
          <h2 style="margin:0">${esc(t("profile.settings"))}</h2>
          <div class="field"><span>${esc(t("profile.lang"))}</span>${seg("lang", [["uz", "Oʻzbekcha"], ["ru", "Русский"], ["en", "English"]], lang())}</div>
          <div class="field"><span>${esc(t("profile.voice"))}</span>
            <div class="row wrap-row">${seg("voice", [["female", t("profile.female")], ["male", t("profile.male")]], setting("voice", "female"))}
              <button class="btn sm ghost" data-act="test">${icon("volume", "ico")} ${esc(t("profile.test"))}</button></div></div>
          <div class="field"><span>${esc(t("profile.rate"))}</span>${seg("rate", RATES.map((r) => [r, r + "×"]), Number(setting("rate", 1)) || 1)}</div>
          <div class="field"><span>${esc(t("profile.goal"))}</span>${seg("goal", GOALS.map((g) => [g, g + " XP"]), goal())}</div>
          <div class="field"><span>${esc(t("profile.theme"))}</span>${seg("theme", [["auto", t("profile.themeAuto")], ["light", t("profile.themeLight")], ["dark", t("profile.themeDark")]], theme())}</div>
        </section>

        ${a.signedIn && cfg.telegramBot ? `<section class="card stack">
          <div class="row">${icon("telegram")}<h3 style="margin:0" class="grow">Telegram</h3>
            ${u && u.telegram ? `<span class="badge ok">${icon("check", "ico")} ${esc(t("profile.tgConnected"))}</span>` : ""}</div>
          ${u && u.telegram ? "" : `<p class="small muted" style="margin:0">${esc(t("profile.tgHint"))}</p><button class="btn" style="align-self:flex-start" data-act="tg">${esc(t("profile.connectTg"))}</button>`}
        </section>` : ""}

        ${isStandalone() ? `<div class="card flat row">${icon("check", "ico")}<span class="small">${esc(t("profile.installed"))}</span></div>`
          : canInstall() ? `<button class="btn block" data-act="install">${icon("download", "ico")} ${esc(t("profile.install"))}</button>`
          : ios ? `<div class="card flat stack"><b class="small">${esc(t("profile.install"))}</b><span class="small muted">${esc(t("profile.installIos"))}</span></div>` : ""}

        <section class="card stack">
          <h2 style="margin:0">${esc(t("profile.account"))}</h2>
          <div class="small" id="syncLine">${syncLine()}</div>
          ${a.signedIn && state.syncedAt ? `<div class="tiny faint" id="syncAt"></div>` : ""}
          ${u ? `<div class="row wrap-row small"><span class="muted">${esc(t("profile.id"))}:</span><code style="overflow-wrap:anywhere">${esc(u.uid)}</code><button class="linkbtn" data-act="copy">${esc(t("profile.copy"))}</button></div>` : ""}
          ${isDemo() ? `<div class="note small">${esc(t("profile.demo"))}</div>` : ""}
          <div class="row wrap-row">
            ${a.staff ? `<a class="btn" href="/admin">${icon("shield", "ico")} ${esc(t("nav.admin"))}</a>` : ""}
            ${a.signedIn ? `<button class="btn ghost" data-act="signout">${esc(t("signout"))}</button>` : `<a class="btn primary" href="/app/signin" data-link>${esc(t("signin"))}</a>`}
          </div>
        </section>
      </div>`;
    const f = root.querySelector("#nameForm");
    if (f) {
      const inp = root.querySelector("#nameIn");
      inp.focus(); inp.select();
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        try { state.me = await api("me", { method: "POST", body: { action: "update", name: inp.value } }); toast(t("profile.saved"), "ok"); }
        catch (err) { toast(err.code === "network" ? t("error.network") : t("error.generic"), "bad"); }
        editing = false; paint();
      });
    }
  }

  paint();
  const unsub = subscribe(() => {
    const el = root.querySelector("#syncLine");
    if (el) el.innerHTML = syncLine();
  });
  const off = onAct(root, {
    edit: () => { editing = true; paint(); },
    lang: (el) => {
      setLang(el.dataset.v);
      if (state.me.access.signedIn) api("me", { method: "POST", body: { action: "update", lang: el.dataset.v } }).catch(() => {});
      render();
    },
    voice: (el) => { setSetting("voice", el.dataset.v); play(SAMPLE, { gender: el.dataset.v }); paint(); },
    test: () => play(SAMPLE),
    rate: (el) => { setSetting("rate", Number(el.dataset.v)); play(SAMPLE); paint(); },
    goal: (el) => { const v = Number(el.dataset.v); update((p) => { p.goal = { v, u: Date.now() }; }); paint(); },
    theme: (el) => { setTheme(el.dataset.v); paint(); },
    trial: startTrial,
    tg: async () => {
      // open the window first (a popup opened after an await is blocked on phones), then point it at the bot
      const w = window.open("about:blank", "_blank");
      try {
        const r = await api("me", { method: "POST", body: { action: "telegram-link" } });
        if (w) w.location.href = r.url; else location.href = r.url;
        toast(t("profile.tgOpened"));
      } catch (e) {
        if (w) w.close();
        toast(e.code === "network" ? t("error.network") : t("error.generic"), "bad");
      }
    },
    install: async () => { await promptInstall(); paint(); },
    copy: async () => {
      const id = state.me.user && state.me.user.uid;
      try { await navigator.clipboard.writeText(id); toast(t("profile.copied"), "ok"); } catch { toast(id); }
    },
    syncnow: () => syncNow(),
    signout: async () => { await signOut(); go("/app"); },
  });
  // "saved 5 minutes ago"-style line, refreshed while the screen is open
  const tick = setInterval(() => {
    const el = root.querySelector("#syncAt");
    if (el && state.syncedAt) el.textContent = new Date(state.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, 1000);
  // a Telegram account linked in another tab shows up when you come back
  const onFocus = async () => {
    if (!state.me.access.signedIn || (state.me.user && state.me.user.telegram)) return;
    try { const me = await api("me"); if (me.user && me.user.telegram) { state.me = me; paint(); } } catch { /* ignore */ }
  };
  addEventListener("focus", onFocus);
  return () => { off(); unsub(); clearInterval(tick); removeEventListener("focus", onFocus); };
}
