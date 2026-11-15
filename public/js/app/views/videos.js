/* The 50 video lessons: jump by number (what viewers see in the video), search, browse by bundle. All free. */
import { t } from "../i18n.js";
import { esc, icon, onAct } from "../ui.js";
import { state } from "../store.js";
import { videos, go } from "../main.js";
import { videoItems } from "../../shared/videos.js";

export default async function list(root) {
  const vids = await videos();
  const p = state.progress;
  const bundles = [...new Map(vids.map((v) => [v.bundle, v.bundleTitle])).entries()];
  let q = "";
  const hay = new Map(vids.map((v) => [v.n, [v.title.uz, v.title.en, ...videoItems(v).map((x) => x.en + " " + x.uz)].join(" ").toLowerCase()]));

  function rows(list) {
    return list.map((v) => {
      const seen = p.videos[v.n] && p.videos[v.n].seen;
      const best = p.videos[v.n] && p.videos[v.n].best;
      return `<a class="item ${seen ? "done" : ""}" href="/v/${v.n}" data-link>
        <span class="n">${seen ? icon("check", "ico") : v.n}</span>
        <span class="grow"><span class="t">${esc(v.title.uz)}</span><br><span class="s">${v.n}. ${esc(v.title.en)} · ${esc(v.format === "cards" ? t("videos.cards") : t("videos.dialogue"))}${best != null ? ` · ${best}%` : ""}</span></span>
        ${icon("chevron", "ico")}
      </a>`;
    }).join("");
  }
  function body() {
    if (q) {
      const found = vids.filter((v) => hay.get(v.n).includes(q.toLowerCase()) || String(v.n) === q);
      return `<div class="card list">${found.length ? rows(found) : `<div class="empty">${esc(t("words.none"))}</div>`}</div>`;
    }
    return bundles.map(([b, title]) => `
      <section style="margin-bottom:18px">
        <h3>${esc(t("videos.bundle", { n: b }))} <span class="muted small">· ${esc(title)}</span></h3>
        <div class="card list" style="padding:4px 12px">${rows(vids.filter((v) => v.bundle === b))}</div>
      </section>`).join("");
  }
  root.innerHTML = `
    <div class="pagehead"><h1>${esc(t("videos.title"))}</h1></div>
    <p class="muted">${esc(t("videos.sub"))}</p>
    <div class="card accent stack" style="margin-bottom:14px">
      <label for="vnum"><b>${esc(t("videos.jump"))}</b></label>
      <form class="row" id="jump"><input class="input" id="vnum" type="number" inputmode="numeric" min="1" max="50" placeholder="12" style="max-width:120px"><button class="btn dark">${esc(t("videos.open"))}</button></form>
    </div>
    <div class="row" style="margin-bottom:14px"><input class="input" id="vsearch" type="search" placeholder="${esc(t("videos.search"))}" aria-label="${esc(t("videos.search"))}"></div>
    <div id="vlist">${body()}</div>`;
  root.querySelector("#jump").addEventListener("submit", (e) => {
    e.preventDefault();
    const n = Number(root.querySelector("#vnum").value);
    if (n >= 1 && n <= 50) go("/v/" + n);
  });
  const s = root.querySelector("#vsearch");
  s.addEventListener("input", () => { q = s.value.trim(); root.querySelector("#vlist").innerHTML = body(); });
  return onAct(root, {});
}
