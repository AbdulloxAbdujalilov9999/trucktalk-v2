/* Light / dark / follow the phone. Kept on this device only (it is a display preference, not progress). */
const KEY = "tt2:theme";

export function theme() {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "auto"; } catch { return "auto"; }
}

export function applyTheme(v = theme()) {
  const html = document.documentElement;
  if (v === "light" || v === "dark") html.dataset.theme = v; else delete html.dataset.theme;
}

export function setTheme(v) {
  try { if (v === "light" || v === "dark") localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* ignore */ }
  applyTheme(v);
}
