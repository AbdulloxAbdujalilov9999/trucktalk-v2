/* Certificate of completion: opens once the final road test (the last course day) is done. Printable (or "Save as PDF")
 * and shareable. Uses the account's name, so it needs sign-in; the name can be changed on the profile screen. */
import { t, lang, fmtDate } from "../i18n.js";
import { esc, icon, onAct, toast } from "../ui.js";
import { state } from "../store.js";
import { catalog } from "../main.js";
import { totalXp } from "../../shared/progress.js";
import { certificateStatus } from "./common.js";

/** A short, stable number to quote: completion date + the end of the account id. */
export function certNumber(uid, doneAt) {
  const d = new Date(doneAt);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `TT-${ymd}-${String(uid || "").replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase()}`;
}

export default async function certificate(root) {
  const a = state.me.access, user = state.me.user;
  const cat = await catalog();
  const p = state.progress;
  const st = certificateStatus(cat, p), final = st.final, daysDone = st.done;
  const doneAt = p.days[final.n] && p.days[final.n].done;

  if (!a.signedIn || !user) {
    root.innerHTML = `<div class="card stack center"><div style="font-size:2.4rem">🎓</div><h2>${esc(t("cert.title"))}</h2>
      <p class="muted">${esc(t("cert.signin"))}</p><a class="btn primary" href="/app/signin?next=/app/certificate" data-link>${esc(t("signin"))}</a></div>`;
    return;
  }
  if (!st.ready) {
    root.innerHTML = `<div class="card stack center"><div style="font-size:2.4rem">🎓</div><h2>${esc(t("cert.title"))}</h2>
      <p class="muted">${esc(t("cert.locked", { n: final.n, need: st.need, total: st.total }))}</p>
      <div class="bar" style="width:100%" aria-hidden="true"><i style="width:${Math.round((daysDone / cat.days.length) * 100)}%"></i></div>
      <p class="small muted">${esc(t("cert.progress", { done: daysDone, total: cat.days.length }))}</p>
      <a class="btn primary" href="/app/day/${st.next.n}" data-link>${esc(t("cert.continue", { n: st.next.n }))}</a></div>`;
    return;
  }

  const name = (user.name || "").trim();
  const num = certNumber(user.uid, doneAt);
  root.innerHTML = `
    <div class="pagehead no-print"><h1>${esc(t("cert.title"))}</h1></div>
    ${name ? "" : `<div class="card accent no-print stack" style="margin-bottom:12px"><p style="margin:0">${esc(t("cert.needName"))}</p><a class="btn sm" href="/app/profile" data-link>${esc(t("nav.profile"))}</a></div>`}
    <article class="cert" aria-label="${esc(t("cert.title"))}">
      <div class="cert-in">
        <div class="cert-brand">${icon("truck", "ico")} TruckTalk</div>
        <div class="cert-kicker">Certificate of completion</div>
        <div class="cert-name">${esc(name || "—")}</div>
        <p class="cert-body">has completed the 60-day TruckTalk course,<br><b>English for truck drivers in the USA</b>,<br>including the final road test.</p>
        ${lang() !== "en" ? `<p class="cert-uz">${esc(t("cert.body"))}</p>` : ""}
        <div class="cert-meta">
          <div><span>Date</span><b>${esc(new Date(doneAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }))}</b></div>
          <div><span>Lessons</span><b>${daysDone} / ${cat.days.length}</b></div>
          <div><span>XP</span><b>${totalXp(p)}</b></div>
          <div><span>No.</span><b>${esc(num)}</b></div>
        </div>
      </div>
    </article>
    <div class="row wrap-row no-print" style="margin-top:14px;justify-content:center">
      <button class="btn primary" data-act="print">${icon("download", "ico")} ${esc(t("cert.print"))}</button>
      ${navigator.share ? `<button class="btn" data-act="share">${icon("share", "ico")} ${esc(t("cert.share"))}</button>` : ""}
    </div>
    <p class="tiny muted center no-print" style="margin-top:10px">${esc(t("cert.date", { date: fmtDate(doneAt) }))}</p>`;

  return onAct(root, {
    print: () => window.print(),
    share: async () => {
      try { await navigator.share({ title: "TruckTalk", text: t("cert.shareText"), url: location.origin + "/?src=cert" }); }
      catch (e) { if (e && e.name !== "AbortError") toast(t("error.generic"), "bad"); }
    },
  });
}
