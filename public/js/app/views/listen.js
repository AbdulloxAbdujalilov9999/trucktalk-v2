/* Listen in the truck: a hands-free player for the road. For every phrase: the English, its meaning (the Uzbek
 * teacher's voice, or the phone's Russian voice), a pause to say it out loud, then the English again, a little slower.
 * Keeps the screen on while it plays, and answers the play/pause/next buttons of headphones and car audio (Media
 * Session) where the phone allows it. Its options stay on this device. */
import { t } from "../i18n.js";
import { esc, icon, onAct, spinner } from "../ui.js";
import { addXp } from "../store.js";
import { go } from "../main.js";
import { play, stop, pause, newRun, canSpeak } from "../audio.js";
import { sources, itemsOf, defaultSet, rememberSet, setPicker } from "../items.js";
import { shuffle } from "../../shared/drills.js";
import { pageHead } from "./common.js";

const PREFS = "tt2:listen";
const SET_RE = /^(mine|video:\d{1,2}|day:-?\d{1,2})$/;
const XP_MAX = 15;   // listening counts, but a long drive shouldn't fill the daily goal on its own

function loadPrefs() {
  const d = { tr: true, loop: true, shuffle: false, gap: "normal" };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PREFS) || "{}") }; } catch { return d; }
}

export default async function listen(root, _params, { query }) {
  root.innerHTML = spinner();
  const here = location.pathname + location.search;
  const src = await sources();
  if (location.pathname + location.search !== here) return;   // the student moved on while it loaded
  let set = query.get("set");
  if (!set || !SET_RE.test(set) || !itemsOf(set, src).length) set = defaultSet(src);
  rememberSet(set);
  const items = itemsOf(set, src);
  const prefs = loadPrefs();
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* ignore */ } };
  const voices = { uz: await canSpeak("uz"), ru: items.some((x) => x.trLang === "ru") ? await canSpeak("ru") : false };

  let order = items.map((_, k) => k), idx = 0, playing = false, step = "", xp = 0, heard = 0, lock = null;
  if (prefs.shuffle) shuffle(order);

  const gapFor = (en) => Math.min(7000, 1500 + en.split(/\s+/).length * 450) * (prefs.gap === "long" ? 1.6 : 1);
  const trLabel = (it) => (it.trLang === "ru" ? "RU" : "UZ");

  // ---------------------------------------------------------------- screen on, headphone buttons
  async function wake() {
    if (lock || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } catch { lock = null; }
  }
  function sleep() { try { if (lock) lock.release(); } catch { /* ignore */ } lock = null; }
  const onVis = () => { if (playing && document.visibilityState === "visible") wake(); };
  document.addEventListener("visibilitychange", onVis);

  const ms = "mediaSession" in navigator ? navigator.mediaSession : null;
  function media(it) {
    if (!ms) return;
    try {
      if (it && typeof MediaMetadata !== "undefined") ms.metadata = new MediaMetadata({ title: it.en, artist: it.tr, album: "TruckTalk", artwork: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] });
      ms.playbackState = playing ? "playing" : "paused";
    } catch { /* ignore */ }
  }
  const handlers = { play: () => start(idx), pause: () => halt(), nexttrack: () => jump(1), previoustrack: () => jump(-1) };
  if (ms) for (const [k, fn] of Object.entries(handlers)) { try { ms.setActionHandler(k, fn); } catch { /* not supported */ } }

  // ---------------------------------------------------------------- the player
  async function start(from) {
    if (!items.length) return;
    const alive = newRun();
    playing = true; wake(); paintPlayer();
    for (idx = from; ; idx++) {
      if (idx >= order.length) {
        if (!prefs.loop) break;
        idx = 0;
        if (prefs.shuffle) shuffle(order);
      }
      const it = items[order[idx]];
      media(it);
      const say = async (s, text, opts) => { step = s; paintPlayer(); const r = await play(text, opts); return alive() && r !== "stopped"; };
      if (!(await say("en", it.en))) return end(alive);
      if (!(await pause(700))) return end(alive);
      if (prefs.tr && voices[it.trLang]) {
        if (!(await say("tr", it.tr, { lang: it.trLang }))) return end(alive);
        if (!(await pause(500))) return end(alive);
      }
      step = "you"; paintPlayer();
      if (!(await pause(gapFor(it.en)))) return end(alive);
      if (!(await say("again", it.en, { rate: 0.85 }))) return end(alive);
      heard++;
      if (heard % 2 === 0 && xp < XP_MAX) { xp++; addXp(1); }
      if (!(await pause(1400))) return end(alive);
    }
    end(alive, true);
  }
  // a run that ended by itself (the list is over) or was interrupted by someone else's play/stop
  function end(alive, finished = false) {
    if (!alive() && !finished) return;
    if (idx >= order.length) idx = 0;
    playing = false; step = ""; sleep(); media(null); paintPlayer();
  }
  function halt() { stop(); playing = false; step = ""; sleep(); media(null); paintPlayer(); }
  function jump(d) {
    const was = playing;
    stop();
    idx = (idx + d + order.length) % order.length;
    step = "";
    if (was) start(idx); else paintPlayer();
  }

  // ---------------------------------------------------------------- screen
  function player() {
    if (!items.length) return `<div class="card empty">${icon("search")}<p>${esc(t("game.small"))}</p></div>`;
    const it = items[order[idx]];
    const dot = (s, label) => `<span class="${step === s ? "on" : ""}">${esc(label)}</span>`;
    return `<div class="card player stack center">
      <div class="muted small">${idx + 1} / ${order.length}</div>
      <div class="player-en">${esc(it.en)}</div>
      <div class="player-tr">${prefs.tr ? esc(it.tr) : "&nbsp;"}</div>
      <div class="player-steps" aria-hidden="true">${dot("en", "EN")}${prefs.tr && voices[it.trLang] ? dot("tr", trLabel(it)) : ""}${dot("you", t("listen.you"))}${dot("again", "EN")}</div>
      <div class="sr-only" aria-live="polite">${step === "you" ? esc(t("listen.you")) : ""}</div>
      <div class="row" style="justify-content:center;gap:18px">
        <button class="btn icon" data-act="prev" aria-label="${esc(t("prev"))}">${icon("skipPrev", "ico")}</button>
        <button class="bigplay" data-act="toggle" aria-label="${esc(playing ? t("listen.pause") : t("listen.play"))}">${icon(playing ? "pause" : "play")}</button>
        <button class="btn icon" data-act="next" aria-label="${esc(t("next"))}">${icon("skipNext", "ico")}</button>
      </div>
    </div>`;
  }
  function paintPlayer() { const el = root.querySelector("#player"); if (el) el.innerHTML = player(); }
  function paint() {
    const missing = items.some((x) => !voices[x.trLang]);
    root.innerHTML = `
      ${pageHead({ back: "/app/practice", backLabel: t("nav.practice"), eyebrow: t("practice.title"), title: t("listen.title"), sub: esc(t("listen.sub")),
        body: `<div class="head-extra">${setPicker(set, src)}</div>` })}
      <div class="note safety" role="note">${icon("alert", "ico")}<span>${esc(t("listen.safety"))}</span></div>
      <div id="player">${player()}</div>
      <div class="card stack" style="margin-top:14px">
        <label class="switch-row"><input type="checkbox" data-pref="tr" ${prefs.tr ? "checked" : ""}><span>${esc(t("listen.optTr"))}</span></label>
        <label class="switch-row"><input type="checkbox" data-pref="loop" ${prefs.loop ? "checked" : ""}><span>${esc(t("listen.optLoop"))}</span></label>
        <label class="switch-row"><input type="checkbox" data-pref="shuffle" ${prefs.shuffle ? "checked" : ""}><span>${esc(t("listen.optShuffle"))}</span></label>
        <div class="row wrap-row"><span class="grow">${esc(t("listen.optGap"))}</span>
          <div class="seg">
            <button data-act="gap" data-v="normal" class="${prefs.gap === "normal" ? "on" : ""}">${esc(t("listen.gapNormal"))}</button>
            <button data-act="gap" data-v="long" class="${prefs.gap === "long" ? "on" : ""}">${esc(t("listen.gapLong"))}</button>
          </div>
        </div>
        ${missing && prefs.tr ? `<p class="tiny muted" style="margin:0">${esc(t("listen.noTrVoice"))}</p>` : ""}
        <p class="tiny muted" style="margin:0">${esc(t("listen.how"))}</p>
      </div>`;
  }

  paint();
  const off = onAct(root, {
    toggle: () => (playing ? halt() : start(idx)),
    next: () => jump(1),
    prev: () => jump(-1),
    gap: (el) => { prefs.gap = el.dataset.v; savePrefs(); paint(); },
  });
  const onChange = (e) => {
    if (e.target.id === "setpick") { go(`/app/listen?set=${encodeURIComponent(e.target.value)}`, { replace: true }); return; }
    const k = e.target.dataset && e.target.dataset.pref;
    if (!k) return;
    prefs[k] = e.target.checked; savePrefs();
    if (k === "shuffle") { const cur = order[idx]; order = items.map((_, j) => j); if (prefs.shuffle) shuffle(order); idx = Math.max(0, order.indexOf(cur)); }
    paint();
  };
  root.addEventListener("change", onChange);
  return () => {
    off(); root.removeEventListener("change", onChange);
    document.removeEventListener("visibilitychange", onVis);
    stop(); sleep();
    if (ms) { for (const k of Object.keys(handlers)) { try { ms.setActionHandler(k, null); } catch { /* ignore */ } } try { ms.metadata = null; ms.playbackState = "none"; } catch { /* ignore */ } }
  };
}
