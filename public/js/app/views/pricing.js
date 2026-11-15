/* Plans and checkout. The browser only opens a checkout; the plan opens when the payment provider tells our server
 * (webhook). Coming back with ?paid=1 just waits for that to happen. Demo mode has a pretend checkout (?demo_checkout=). */
import { t, fmtDate } from "../i18n.js";
import { esc, icon, onAct, toast, modal } from "../ui.js";
import { api, config } from "../api.js";
import { state, refreshMe } from "../store.js";
import { go, planLabel, startTrial } from "../main.js";
import { PLANS, FEATURES, planById } from "../../shared/plans.js";
import { trialLine } from "./common.js";

const BEFORE_KEY = "tt2:paid-before";

export default async function pricing(root, _p, { query }) {
  const cfg = await config();
  let period = "3months", confirming = false, opening = null;

  const monthly = (tier) => PLANS.find((p) => p.tier === tier && p.per === "month");
  const forPeriod = (tier) => PLANS.find((p) => p.tier === tier && p.per === period);
  const savePct = (tier) => {
    const m = monthly(tier), q = PLANS.find((p) => p.tier === tier && p.per === "3months");
    return m && q ? Math.round((1 - q.usd / (m.usd * 3)) * 100) : 0;
  };

  function statusCard() {
    const a = state.me.access;
    if (confirming) return `<div class="card accent row">${'<div class="spinner" style="margin:0;width:22px;height:22px;border-width:3px"></div>'}<b>${esc(t("pricing.confirming"))}</b></div>`;
    if (a.staff) return `<div class="card flat">${esc(t("pricing.staff"))}</div>`;
    if (a.paidUntil && a.paidUntil > Date.now()) return `<div class="card accent stack"><b>${esc(t("paid.until", { plan: planLabel(a), date: fmtDate(a.paidUntil) }))}</b><span class="small muted">${esc(t("pricing.stack"))}</span></div>`;
    if (a.tier === "trial") return `<div class="card accent"><b>${esc(trialLine(a))}</b></div>`;
    if (a.canStartTrial) return `<div class="card accent stack"><div class="row">${icon("gift")}<b class="grow">${esc(t("trial.cta"))}</b></div><p class="small muted" style="margin:0">${esc(t("trial.sub"))}</p><button class="btn primary" style="align-self:flex-start" data-act="trial">${esc(t("trial.start"))}</button></div>`;
    return "";
  }

  function buyButton(plan) {
    const a = state.me.access;
    if (a.staff) return "";
    if (!cfg.features.checkout) return `<button class="btn block" disabled>${esc(t("pricing.buy"))}</button>`;
    if (!a.signedIn) return `<a class="btn primary block" href="/app/signin?next=${encodeURIComponent("/app/pricing")}" data-link>${esc(t("pricing.signinToBuy"))}</a>`;
    const busy = opening === plan.id;
    return `<button class="btn ${plan.popular || plan.tier === "pro" ? "primary" : "dark"} block" data-act="buy" data-plan="${esc(plan.id)}" ${opening ? "disabled" : ""}>${busy ? esc(t("pricing.opening")) : `${icon("card", "ico")} ${esc(t("pricing.buy"))} · $${plan.usd}`}</button>`;
  }

  function planCard(tier) {
    const plan = forPeriod(tier), a = state.me.access;
    const current = a.tier === tier && a.paidUntil > Date.now();
    const perMonth = plan.per === "3months" ? Math.round(plan.usd / 3) : null;
    const best = plan.popular;
    return `<div class="card plan ${best ? "best" : ""}">
      ${best ? `<span class="ribbon">${esc(t("pricing.best"))}</span>` : ""}
      <div class="row between"><h3 style="margin:0">${esc(t("plan." + tier))}</h3>${current ? `<span class="badge ok">${esc(t("pricing.current"))}</span>` : ""}</div>
      <div class="price">$${plan.usd} <small>/ ${esc(plan.per === "month" ? t("pricing.month") : t("pricing.3months"))}</small></div>
      ${perMonth ? `<div class="small"><b>${esc(t("pricing.perMonth", { n: perMonth }))}</b> · <span class="badge ok">${esc(t("pricing.save", { n: savePct(tier) }))}</span></div>` : `<div class="small muted">&nbsp;</div>`}
      <ul>${FEATURES[tier].map((k) => `<li>${icon("check", "ico")}<span>${esc(t(k))}</span></li>`).join("")}</ul>
      <div style="margin-top:auto">${buyButton(plan)}</div>
    </div>`;
  }

  function freeCard() {
    const a = state.me.access;
    const current = a.tier === "free" || a.tier === "anon";
    return `<div class="card plan">
      <div class="row between"><h3 style="margin:0">${esc(t("plan.free"))}</h3>${current ? `<span class="badge">${esc(t("pricing.current"))}</span>` : ""}</div>
      <div class="price">$0</div>
      <div class="small muted">&nbsp;</div>
      <ul>${["pricing.freeF1", "pricing.freeF2", "pricing.freeF3"].map((k) => `<li>${icon("check", "ico")}<span>${esc(t(k))}</span></li>`).join("")}</ul>
      <div style="margin-top:auto"><a class="btn ghost block" href="/app/course" data-link>${esc(t("nav.course"))}</a></div>
    </div>`;
  }

  function manualBox() {
    if (!cfg.features.manualPayment && !cfg.support) return "";
    const u = state.me.user;
    return `<section class="card stack">
      <h3 style="margin:0">${esc(t("pricing.manual"))}</h3>
      ${cfg.manualPayment ? `<p class="small" style="margin:0;white-space:pre-line">${esc(cfg.manualPayment)}</p>` : ""}
      ${u ? `<p class="small muted" style="margin:0">${esc(t("pricing.manualSub"))}</p><div class="row wrap-row"><code style="font-size:1rem;overflow-wrap:anywhere">${esc(u.uid)}</code><button class="linkbtn" data-act="copy">${esc(t("profile.copy"))}</button></div>` : ""}
      ${cfg.support ? `<a class="btn" style="align-self:flex-start" href="https://t.me/${esc(String(cfg.support).replace(/^@/, ""))}" target="_blank" rel="noopener">${icon("telegram", "ico")} ${esc(t("pricing.support"))}</a>` : ""}
    </section>`;
  }

  function paint() {
    root.innerHTML = `
      <div class="pagehead"><h1>${esc(t("pricing.title"))}</h1></div>
      <p class="muted">${esc(t("pricing.sub"))}</p>
      <div class="stack-lg">
        ${statusCard()}
        ${cfg.demo ? `<div class="note small">${esc(t("pricing.demo"))}</div>` : ""}
        ${!cfg.features.checkout ? `<div class="note small">${esc(t("pricing.unavailable"))}</div>` : ""}
        <div class="center">${`<div class="seg" role="group">
          <button data-act="period" data-v="month" class="${period === "month" ? "on" : ""}" aria-pressed="${period === "month"}">1 ${esc(t("pricing.month"))}</button>
          <button data-act="period" data-v="3months" class="${period === "3months" ? "on" : ""}" aria-pressed="${period === "3months"}">${esc(t("pricing.3months"))} · −${savePct("self")}%</button>
        </div>`}</div>
        <div class="plans">${freeCard()}${planCard("self")}${planCard("pro")}</div>
        ${manualBox()}
        <section class="faq">
          <h2>${esc(t("pricing.faq"))}</h2>
          ${[1, 2, 3].map((i) => `<details><summary>${esc(t("pricing.q" + i))}</summary><p class="muted" style="margin:8px 0 0">${esc(t("pricing.a" + i))}</p></details>`).join("")}
        </section>
      </div>`;
  }

  // ---------------------------------------------------------------- coming back from checkout: wait for the webhook
  async function waitForPayment() {
    let before = 0;
    try { before = Number(sessionStorage.getItem(BEFORE_KEY) || 0); } catch { /* ignore */ }
    confirming = true; paint();
    const until = Date.now() + 90 * 1000;
    while (Date.now() < until && root.isConnected) {
      await refreshMe();
      const pu = state.me.access.paidUntil || 0;
      if (pu > before && pu > Date.now()) {
        confirming = false;
        try { sessionStorage.removeItem(BEFORE_KEY); } catch { /* ignore */ }
        go("/app/pricing", { replace: true });
        toast(t("pricing.thanks"), "ok");
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!root.isConnected) return;
    confirming = false; paint();
    toast(t("pricing.slow"));
  }

  // ---------------------------------------------------------------- demo checkout
  function demoCheckout(planId) {
    const plan = planById(planId);
    if (!plan || !cfg.demo) { go("/app/pricing", { replace: true }); return; }
    const m = modal(`
      <h2>${icon("card")} ${esc(t("plan." + plan.tier))} · ${esc(plan.per === "month" ? "1 " + t("pricing.month") : t("pricing.3months"))}</h2>
      <p class="muted">${esc(t("pricing.demo"))}</p>
      <div class="stack">
        <button class="btn primary block" data-act="demopay">${esc(t("pricing.demoPay", { n: plan.usd }))}</button>
        <button class="btn block" data-close>${esc(t("close"))}</button>
      </div>`, { onClose: () => { if (location.search.includes("demo_checkout")) history.replaceState({}, "", "/app/pricing"); } });
    onAct(m.el, {
      demopay: async () => {
        try {
          await api("dev", { method: "POST", body: { action: "pay", plan: plan.id } });
          m.close();
          await refreshMe();
          toast(t("pricing.thanks"), "ok");
          paint();
        } catch { toast(t("error.generic"), "bad"); }
      },
    });
  }

  paint();
  const off = onAct(root, {
    period: (el) => { period = el.dataset.v; paint(); },
    trial: startTrial,
    copy: async () => { const id = state.me.user && state.me.user.uid; try { await navigator.clipboard.writeText(id); toast(t("profile.copied"), "ok"); } catch { toast(id); } },
    buy: async (el) => {
      const id = el.dataset.plan;
      opening = id; paint();
      try {
        const r = await api("pay", { method: "POST", body: { plan: id } });
        if (r.demo) { opening = null; go(r.url); return; }
        try { sessionStorage.setItem(BEFORE_KEY, String(state.me.access.paidUntil || 0)); } catch { /* ignore */ }
        location.href = r.url;
      } catch (e) {
        opening = null; paint();
        toast(e.code === "not-configured" ? t("pricing.unavailable") : e.code === "slow-down" ? t("error.slow") : e.code === "network" ? t("error.network") : t("error.generic"), "bad");
      }
    },
  });
  if (query.get("paid") === "1") waitForPayment();
  else if (query.get("demo_checkout")) demoCheckout(query.get("demo_checkout"));
  // leaving for checkout and pressing Back restores this page from the browser cache with a busy button
  const onShow = (e) => { if (e.persisted) { opening = null; paint(); } };
  addEventListener("pageshow", onShow);
  return () => { off(); removeEventListener("pageshow", onShow); };
}
