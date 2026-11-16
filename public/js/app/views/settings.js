/* Settings, as in the main TruckTalk app: one row per setting (language, translations, appearance, speech speed, voice,
 * daily goal, installing the app, your name), then the account: who is signed in, the plan and what it includes,
 * progress backup, Telegram, the admin dashboard for staff, and signing out. */
import { t, lang, setLang, fmtDate } from "../i18n.js";
import { esc, icon, onAct, toast } from "../ui.js";
import { api, config } from "../api.js";
import { state, setting, setSetting, goal, update, syncNow, subscribe } from "../store.js";
import { signOut, isDemo } from "../auth.js";
import { go, render, planLabel, startTrial, canInstall, promptInstall, isStandalone } from "../main.js";
import { trialLine } from "./common.js";
import { theme, setTheme } from "../theme.js";
import { play } from "../audio.js";

const GOALS = [10, 30, 50, 100];
const RATES = [0.75, 1, 1.25];
const SAMPLE = "Good morning! Ready for the road?";

const seg = (act, items, current, label) =>
  `<div class="seg" role="group" aria-label="${esc(label)}">${items.map(([v, l]) => {
    const on = String(v) === String(current);
    return `<button data-act="${act}" data-v="${esc(String(v))}" class="${on ? "on" : ""}" aria-pressed="${on}">${esc(l)}</button>`;
  }).join("")}</div>`;
/** One setting: a title and a line about it on the left, the control on the right (under it on a phone). */
const row = (title, sub, control, id = "") =>
  `<div class="setting-row btnrow"${id ? ` id="${id}"` : ""}><div><h3>${esc(title)}</h3>${sub ? `<p class="panel-sub">${sub}</p>` : ""}</div>${control}</div>`;

export default async function settings(root) {
  const cfg = await config();
  let editing = false;

  function syncLine() {
    const a = state.me.access;
    if (!a.signedIn) return esc(t("profile.anon"));
    if (state.sync === "saving" || state.sync === "pending") return esc(t("profile.syncing"));
    if (state.sync === "failed" || state.sync === "offline") return `<span class="badge warn">${esc(t("profile.syncFail"))}</span> <button class="linkbtn" data-act="syncnow">${esc(t("profile.syncNow"))}</button>`;
    return `<span class="badge ok">${icon("check")} ${esc(t("profile.sync"))}</span>`;
  }

  function planStatus(a) {
    if (a.blocked) return `<span class="badge bad">${esc(t("plan.blocked"))}</span>`;
    if (a.staff) return esc(t("pricing.staff"));
    if (a.paidUntil && a.paidUntil > Date.now()) return esc(t("paid.until", { plan: planLabel(a), date: fmtDate(a.paidUntil) }));
    if (a.tier === "trial") return esc(trialLine(a));
    return esc(t("lock.body"));
  }

  function nameControl(name) {
    if (editing) {
      return `<form class="row name-form" id="nameForm"><input class="input" id="nameIn" maxlength="60" value="${esc(name)}" aria-label="${esc(t("set.name"))}" autocomplete="name"><button class="btn primary sm">${esc(t("save"))}</button></form>`;
    }
    return `<button class="btn ghost sm" data-act="edit">${esc(name || t("set.setName"))}</button>`;
  }

  function paint() {
    const a = state.me.access, u = state.me.user, v = state.me.voice;
    const name = (u && u.name) || "";
    const ident = u ? [u.email, u.telegram ? "Telegram" + (u.telegram.username ? " @" + u.telegram.username : "") : null, u.phone].filter(Boolean).join(" · ") : "";
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone();
    const install = isStandalone() ? row(t("set.install"), esc(t("profile.installed")), `<span class="badge ok">${icon("check")} ${esc(t("done"))}</span>`)
      : canInstall() ? row(t("set.install"), esc(t("set.installSub")), `<button class="btn primary sm" data-act="install">${icon("download")} ${esc(t("set.install"))}</button>`)
      : ios ? row(t("set.install"), esc(t("profile.installIos")), "") : "";
    const limits = a.signedIn ? [
      `${esc(t("profile.aiDaily"))}: ${esc(t("teacher.daily", { n: a.limits.ai }))}`,
      a.limits.voiceMin > 0 ? `${esc(t("profile.voiceMin"))}: ${esc(t("teacher.voiceLeft", { n: v && v.minutesLeft != null ? v.minutesLeft : a.limits.voiceMin }))}` : "",
    ].filter(Boolean).join("<br>") : "";

    root.innerHTML = `
      <section class="panel">
        <div class="panel-head"><h2>${esc(t("set.title"))}</h2></div>
        ${row(t("set.lang"), esc(t("set.langSub")), seg("lang", [["uz", "Oʻzbekcha"], ["ru", "Русский"], ["en", "English"]], lang(), t("set.lang")))}
        ${row(t("set.showTr"), esc(t("set.showTrSub")), `<label class="switch"><input type="checkbox" id="showTr" ${setting("showUz", true) !== false ? "checked" : ""} aria-label="${esc(t("set.showTr"))}"><span class="slider"></span></label>`)}
        ${row(t("set.theme"), esc(t("set.themeSub")), seg("theme", [["auto", t("profile.themeAuto")], ["light", t("profile.themeLight")], ["dark", t("profile.themeDark")]], theme(), t("set.theme")))}
        ${row(t("set.rate"), esc(t("set.rateSub")), seg("rate", RATES.map((r) => [r, r + "×"]), Number(setting("rate", 1)) || 1, t("set.rate")))}
        ${row(t("profile.voice"), esc(t("set.voiceSub")), `<div class="row wrap-row">${seg("voice", [["female", t("set.female")], ["male", t("set.male")]], setting("voice", "female"), t("profile.voice"))}<button class="btn ghost sm" data-act="test">${icon("volume")} ${esc(t("profile.test"))}</button></div>`)}
        ${row(t("profile.goal"), esc(t("set.goalSub")), seg("goal", GOALS.map((g) => [g, g + " XP"]), goal(), t("profile.goal")))}
        ${install}
        ${a.signedIn ? row(t("set.name"), esc(t("set.nameSub")), nameControl(name), "nameRow") : ""}
      </section>

      <section class="panel">
        <div class="panel-head"><h2>${esc(t("profile.account"))}</h2></div>
        ${a.signedIn ? `
          <div class="setting-row btnrow">
            <div class="row" style="gap:14px">
              <span class="avatar" aria-hidden="true">${esc((name || "?").trim().charAt(0).toUpperCase() || "?")}</span>
              <div style="min-width:0">
                <h3>${esc(name || t("set.noName"))}${a.staff ? ` <span class="badge info">${esc(t("nav.admin"))}</span>` : ""}</h3>
                ${ident ? `<p class="panel-sub" style="overflow-wrap:anywhere">${esc(t("set.signedInAs", { who: ident }))}</p>` : ""}
                ${u && u.createdAt ? `<p class="panel-sub">${esc(t("profile.since", { date: fmtDate(u.createdAt) }))}</p>` : ""}
              </div>
            </div>
            <button class="btn ghost sm" data-act="signout">${esc(t("signout"))}</button>
          </div>
          <div class="setting-row btnrow">
            <div><h3>${esc(t("profile.plan"))}: ${esc(planLabel(a) || t("plan.free"))}</h3><p class="panel-sub">${planStatus(a)}</p>${limits ? `<p class="panel-sub" style="margin-top:6px">${limits}</p>` : ""}</div>
            <div class="row wrap-row">
              ${a.canStartTrial ? `<button class="btn primary sm" data-act="trial">${icon("gift")} ${esc(t("trial.start"))}</button>` : ""}
              ${!a.staff ? `<a class="btn ${a.canStartTrial ? "ghost" : "primary"} sm" href="/app/pricing" data-link>${esc(t("lock.seePlans"))}</a>` : ""}
            </div>
          </div>
          ${row(t("set.backup"), `<span id="syncLine">${syncLine()}</span>`, "")}
          ${cfg.telegramBot ? row("Telegram", esc(u && u.telegram ? t("profile.tgConnected") : t("profile.tgHint")),
            u && u.telegram ? `<span class="badge ok">${icon("check")} ${esc(t("done"))}</span>` : `<button class="btn ghost sm" data-act="tg">${icon("telegram")} ${esc(t("profile.connectTg"))}</button>`) : ""}
          ${a.staff ? row(t("set.admin"), esc(t("set.adminSub")), `<a class="btn ghost sm" href="/admin">${icon("shield")} ${esc(t("set.adminGo"))}</a>`) : ""}
          ${u ? row(t("profile.id"), `<code style="overflow-wrap:anywhere">${esc(u.uid)}</code>`, `<button class="btn ghost sm" data-act="copy">${esc(t("profile.copy"))}</button>`) : ""}`
        : row(t("set.saveTitle"), esc(t("profile.anon")) + " " + esc(t("home.saveProgressSub")), `<a class="btn primary sm" href="/app/signin?next=/app/settings" data-link>${esc(t("signin"))}</a>`)}
        ${isDemo() ? `<div class="note small" style="margin-top:8px">${esc(t("profile.demo"))}</div>` : ""}
      </section>`;

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
  const unsub = subscribe(() => { const el = root.querySelector("#syncLine"); if (el) el.innerHTML = syncLine(); });
  const onChange = (e) => {
    if (e.target.id === "showTr") { setSetting("showUz", !!e.target.checked); toast(t("profile.saved"), "ok"); }
  };
  root.addEventListener("change", onChange);
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
  // a Telegram account linked in another tab shows up when you come back
  const onFocus = async () => {
    if (!state.me.access.signedIn || (state.me.user && state.me.user.telegram)) return;
    try { const me = await api("me"); if (me.user && me.user.telegram) { state.me = me; paint(); } } catch { /* ignore */ }
  };
  addEventListener("focus", onFocus);
  return () => { off(); unsub(); root.removeEventListener("change", onChange); removeEventListener("focus", onFocus); };
}
