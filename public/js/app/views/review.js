/* Spaced review (Leitner boxes): words from finished "Words" steps and phrases added from video lessons. */
import { t, trLang, fmtWhen } from "../i18n.js";
import { esc, icon, onAct, spinner, sayBtn, bar } from "../ui.js";
import { cachedGet } from "../api.js";
import { state, update, addXp } from "../store.js";
import { videos } from "../main.js";
import { review as reviewCard, dueCards } from "../../shared/progress.js";
import { videoItems } from "../../shared/videos.js";
import { play, stop } from "../audio.js";
import { currentUser } from "../auth.js";

const SESSION = 20;

export default async function reviewView(root) {
  root.innerHTML = spinner();
  const L = trLang();
  const [vids, words] = await Promise.all([videos(), cachedGet("content?kind=words", "words", { uid: currentUser() ? currentUser().uid : "anon" }).catch(() => ({ words: {} }))]);
  const lookup = (id) => {
    const [k, a, b] = id.split(":");
    if (k === "w") { const list = words.words[a]; const w = list && list[Number(b)]; return w ? { en: w.en, tr: w[L] || w.uz, ex: w.ex.en, extr: w.ex[L] || w.ex.uz } : null; }
    const v = vids.find((x) => x.n === Number(a)); const it = v && videoItems(v)[Number(b)];
    return it ? { en: it.en, tr: it.uz, ex: it.note || "", extr: "", lesson: v.n } : null;
  };
  let queue = [], i = 0, shown = false, count = 0, practice = false;

  function start(anyway = false) {
    practice = anyway;
    const now = Date.now();
    const ids = anyway
      ? Object.keys(state.progress.srs).sort(() => Math.random() - 0.5)
      : dueCards(state.progress, now);
    queue = ids.filter((id) => lookup(id)).slice(0, SESSION);
    i = 0; shown = false; count = 0;
    paint();
  }

  function paint() {
    const total = Object.keys(state.progress.srs).length;
    if (!total) {
      root.innerHTML = `<div class="pagehead"><h1>${esc(t("review.title"))}</h1></div><div class="card empty">${icon("repeat")}<p>${esc(t("review.empty"))}</p><a class="btn primary" href="/app/course" data-link>${esc(t("nav.course"))}</a></div>`;
      return;
    }
    if (i >= queue.length) {
      const next = Object.values(state.progress.srs).map((c) => c.due).filter((d) => d > Date.now()).sort((a, b) => a - b)[0];
      root.innerHTML = `<div class="pagehead"><h1>${esc(t("review.title"))}</h1></div>
        <div class="card center stack" style="padding:28px 16px">
          <div style="font-size:2.6rem">✅</div>
          <h2>${esc(t("review.allDone"))}</h2>
          ${count ? `<p class="muted">+${count * 2} XP</p>` : ""}
          ${next ? `<p class="muted">${esc(t("review.nextAt", { when: fmtWhen(next) }))}</p>` : ""}
          <button class="btn" data-act="anyway">${esc(t("review.practice"))}</button>
        </div>`;
      return;
    }
    const c = lookup(queue[i]);
    root.innerHTML = `
      <div class="pagehead"><h1>${esc(t("review.title"))}</h1><span class="grow"></span><span class="muted small">${esc(t("review.left", { n: queue.length - i }))}</span></div>
      ${bar((i / queue.length) * 100)}
      <div class="card flash" style="margin-top:14px" data-act="show">
        <div class="big">${esc(c.en)}</div>
        ${shown ? `<div style="font-size:1.25rem">${esc(c.tr)}</div>${c.ex ? `<div class="muted small">${esc(c.ex)}</div>` : ""}${c.extr ? `<div class="muted small">${esc(c.extr)}</div>` : ""}` : ""}
      </div>
      <div class="row" style="margin-top:12px;justify-content:center">${sayBtn(c.en)}</div>
      <div class="row" style="margin-top:14px">
        ${shown ? `<button class="btn bad grow" data-act="grade" data-k="0">${icon("x", "ico")} ${esc(t("review.again"))}</button>
                   <button class="btn ok grow" data-act="grade" data-k="1">${icon("check", "ico")} ${esc(t("review.know"))}</button>`
                : `<button class="btn primary block" data-act="show">${esc(t("review.show"))}</button>`}
      </div>
      <p class="center tiny muted" style="margin-top:14px">${esc(t("review.sub"))}</p>`;
    if (!shown) play(c.en);
  }

  start(false);
  const off = onAct(root, {
    show: () => { if (!shown) { shown = true; paint(); } },
    grade: (el) => {
      const id = queue[i], knew = el.dataset.k === "1";
      if (!practice) update((p) => { p.srs[id] = reviewCard(p.srs[id], knew); });
      else if (!knew) update((p) => { p.srs[id] = reviewCard(p.srs[id], false); });
      addXp(2); count++;
      if (!knew && !practice) queue.push(id);   // see it again at the end of this session
      i++; shown = false; paint();
    },
    anyway: () => start(true),
  });
  return () => { off(); stop(); };
}
