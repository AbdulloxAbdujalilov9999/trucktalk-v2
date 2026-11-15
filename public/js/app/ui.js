/* Small DOM helpers, icons, toasts and modals. */
import { esc } from "../shared/text.js";
import { t } from "./i18n.js";

export { esc };

const P = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  book: '<path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 20a4 4 0 0 1-4-4"/>',
  play: '<polygon points="7 4 20 12 7 20 7 4" fill="currentColor" stroke="none"/>',
  video: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 10l4-2v8l-4-2"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-2 5-2 8 0 4 3 7 7 7z"/>',
  star: '<polygon points="12 3 15 9 21 10 17 15 18 21 12 18 6 21 7 15 3 10 9 9 12 3"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  send: '<path d="M4 12l16-8-6 16-3-7z"/>',
  phone: '<path d="M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2"/>',
  truck: '<path d="M2 6h11v9H2zM13 9h4l4 4v2h-8z"/><circle cx="6" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  sign: '<path d="M12 2l10 10-10 10L2 12z"/>',
  gift: '<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1s4 1 6 1c2 0 6 2 6-1s-4-3-6 1"/>',
  shield: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  telegram: '<path d="M21 4L3 11l6 2 2 6 3-4 5 4z"/><path d="M9 13l9-7"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14l-1.5 8 5-3 5 3-1.5-8"/>',
};
export function icon(name, cls = "ico") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegated clicks: <button data-act="name" data-x="..."> -> handlers.name(el, event). */
export function onAct(root, handlers) {
  const fn = (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || !root.contains(el)) return;
    const h = handlers[el.dataset.act];
    if (h) { e.preventDefault(); h(el, e); }
  };
  root.addEventListener("click", fn);
  return () => root.removeEventListener("click", fn);
}

let toastTimer = null;
export function toast(msg, kind = "") {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.className = "toast " + kind;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

/** Opens a modal with HTML content. Returns { el, close }. Closes on backdrop click and Escape. */
export function modal(html, { onClose } = {}) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const prev = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener("keydown", key); if (onClose) onClose(); if (prev && prev.focus) prev.focus(); };
  const key = (e) => { if (e.key === "Escape") close(); };
  back.addEventListener("click", (e) => { if (e.target === back || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", key);
  document.body.appendChild(back);
  const first = back.querySelector("button, a, input, textarea, select");
  if (first) first.focus();
  return { el: back.querySelector(".modal"), close };
}

export const spinner = () => `<div class="spinner" role="progressbar" aria-label="${esc(t("loading"))}"></div>`;

export function errorBox(msg, retryAct = "retry") {
  return `<div class="card empty"><p>${esc(msg)}</p><button class="btn" data-act="${retryAct}">${esc(t("retry"))}</button></div>`;
}

export function bar(pct, cls = "") { return `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></div>`; }

export function sayBtn(text, opts = {}) {
  const a = [`data-act="say"`, `data-t="${esc(text)}"`];
  if (opts.lang) a.push(`data-lang="${opts.lang}"`);
  if (opts.gender) a.push(`data-g="${opts.gender}"`);
  return `<button class="btn icon sm say" ${a.join(" ")} aria-label="Play">${icon("volume")}</button>`;
}
