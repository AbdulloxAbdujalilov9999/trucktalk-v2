/* Phrasebook: search every phrase you can open (course days you have access to + all video lessons), with audio. */
import { t, trLang } from "../i18n.js";
import { esc, onAct, spinner, sayBtn } from "../ui.js";
import { cachedGet } from "../api.js";
import { videos } from "../main.js";
import { videoItems } from "../../shared/videos.js";
import { currentUser } from "../auth.js";
import { state } from "../store.js";

export default async function words(root) {
  root.innerHTML = spinner();
  const L = trLang();
  const [vids, w] = await Promise.all([videos(), cachedGet("content?kind=words", "words", { uid: currentUser() ? currentUser().uid : "anon" }).catch(() => ({ words: {} }))]);
  const all = [];
  for (const [n, list] of Object.entries(w.words || {})) for (const x of list) all.push({ en: x.en, tr: x[L] || x.uz, src: (Number(n) <= 0 ? "O" : "") + (Number(n) <= 0 ? "" : t("day", { n })), href: "/app/day/" + n });
  for (const v of vids) for (const it of videoItems(v)) all.push({ en: it.en, tr: it.uz, src: t("lesson", { n: v.n }), href: "/v/" + v.n });
  const hay = all.map((x) => (x.en + " " + x.tr).toLowerCase());
  let q = "";
  const list = () => {
    const found = q ? all.filter((_, i) => hay[i].includes(q.toLowerCase())) : all.slice(0, 60);
    if (!found.length) return `<div class="empty">${esc(t("words.none"))}</div>`;
    return found.slice(0, 200).map((x) => `<div class="word">${sayBtn(x.en)}<div class="grow"><div class="en">${esc(x.en)}</div><div class="tr">${esc(x.tr)}</div></div><a class="tiny muted nowrap" href="${x.href}" data-link>${esc(x.src)}</a></div>`).join("");
  };
  root.innerHTML = `
    <div class="pagehead"><h1>${esc(t("words.title"))}</h1></div>
    <p class="muted">${esc(t("words.sub"))}</p>
    <input class="input" id="wq" type="search" placeholder="${esc(t("words.search"))}" aria-label="${esc(t("words.search"))}" autocomplete="off">
    <p class="tiny muted" style="margin-top:8px">${all.length} · ${state.me.access.full ? "" : esc(t("free"))}</p>
    <div class="card" id="wlist">${list()}</div>`;
  const inp = root.querySelector("#wq");
  inp.addEventListener("input", () => { q = inp.value.trim(); root.querySelector("#wlist").innerHTML = list(); });
  return onAct(root, {});
}
