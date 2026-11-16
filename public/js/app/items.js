/* Phrases for the practice games and the listening player, taken only from what the student can already open: the
 * free video lessons, the words (and example sentences) of the course days they may open, and their review cards.
 * A set is named "mine" (review cards), "video:<n>" or "day:<n>". Every item: { id, en, tr, trLang, kind }. */
import { t, trLang, pick, lang } from "./i18n.js";
import { cachedGet } from "./api.js";
import { esc } from "./ui.js";
import { currentUser } from "./auth.js";
import { state } from "./store.js";
import { videos, catalog } from "./main.js";
import { videoItems } from "../shared/videos.js";

const LAST = "tt2:set";

export async function sources() {
  const uid = currentUser() ? currentUser().uid : "anon";
  const [vids, cat, words] = await Promise.all([
    videos(), catalog(),
    cachedGet("content?kind=words", "words", { uid }).catch(() => ({ words: {} })),
  ]);
  return { vids, cat, words: words.words || {} };
}

/** The items of one set. */
export function itemsOf(set, { vids, words }) {
  const L = trLang();
  const [kind, n] = String(set || "").split(":");
  const fromWord = (day, w, i, out) => {
    out.push({ id: `w:${day}:${i}`, en: w.en, tr: w[L] || w.uz, trLang: w[L] ? L : "uz", kind: "word" });
    if (w.ex && w.ex.en) out.push({ id: `w:${day}:${i}`, en: w.ex.en, tr: w.ex[L] || w.ex.uz, trLang: w.ex[L] ? L : "uz", kind: "sentence" });
  };
  const fromVideo = (v, out, only) => videoItems(v).forEach((it, i) => {
    if (only && !only.has(i)) return;
    out.push({ id: `v:${v.n}:${i}`, en: it.en, tr: it.uz, trLang: "uz", kind: it.kind === "line" || /\s\S+\s/.test(it.en) ? "sentence" : "word" });
  });
  const out = [];
  if (kind === "video") { const v = vids.find((x) => x.n === Number(n)); if (v) fromVideo(v, out); }
  else if (kind === "day") { (words[n] || []).forEach((w, i) => fromWord(n, w, i, out)); }
  else if (kind === "mine") {
    const byVideo = new Map();
    for (const id of Object.keys(state.progress.srs)) {
      const [k, a, b] = id.split(":");
      if (k === "w") { const w = words[a] && words[a][Number(b)]; if (w) fromWord(a, w, Number(b), out); }
      else if (k === "v") { if (!byVideo.has(a)) byVideo.set(a, new Set()); byVideo.get(a).add(Number(b)); }
    }
    for (const [a, only] of byVideo) { const v = vids.find((x) => x.n === Number(a)); if (v) fromVideo(v, out, only); }
  }
  return out.filter((x) => x.en && x.tr);
}

/** The set to start with: the one used last, else review cards when there are enough, else where the student is. */
export function defaultSet(src) {
  let last = null;
  try { last = localStorage.getItem(LAST); } catch { /* ignore */ }
  if (last && itemsOf(last, src).length >= 4) return last;
  if (itemsOf("mine", src).length >= 8) return "mine";
  const p = state.progress;
  const seen = src.vids.filter((v) => p.videos[v.n] && p.videos[v.n].seen).map((v) => v.n);
  if (seen.length) return "video:" + seen[seen.length - 1];
  const day = src.cat.days.find((d) => !(p.days[d.n] && p.days[d.n].done) && src.words[d.n]);
  return day && Object.keys(p.days).length ? "day:" + day.n : "video:1";
}
export function rememberSet(set) { try { localStorage.setItem(LAST, set); } catch { /* ignore */ } }

/** A <select> with every set the student can use. */
export function setPicker(current, src, id = "setpick") {
  const mine = itemsOf("mine", src).length;
  const opt = (v, label) => `<option value="${v}" ${v === current ? "selected" : ""}>${esc(label)}</option>`;
  const days = [...src.cat.orientation.days, ...src.cat.days].filter((d) => src.words[d.n]);
  return `<label class="setpick"><span class="tiny muted">${esc(t("practice.from"))}</span>
    <select class="input" id="${id}">
      ${mine ? opt("mine", t("practice.mine", { n: mine })) : ""}
      <optgroup label="${esc(t("nav.videos"))}">${src.vids.map((v) => opt("video:" + v.n, `${t("lesson", { n: v.n })}: ${v.title.uz} · ${v.title.en}`)).join("")}</optgroup>
      <optgroup label="${esc(t("nav.course"))}">${days.map((d) => opt("day:" + d.n, `${d.n >= 1 ? t("day", { n: d.n }) : t("orientation")}: ${pick(d.title, lang())}`)).join("")}</optgroup>
    </select></label>`;
}
