/* The 50 video lessons: jump by number (what viewers see in the video), search, browse by bundle. All free. */
import { t } from "../i18n.js";
import { esc, icon, onAct } from "../ui.js";
import { state } from "../store.js";
import { videos, go } from "../main.js";
import { videoItems } from "../../shared/videos.js";
import { pageHead } from "./common.js";

export default async function list(root) {
  const vids = await videos();
  const p = state.progress;
  const bundles = [...new Map(vids.map((v) => [v.bundle, v.bundleTitle])).entries()];
  let q = "";
  const isSeen = (v) => !!(p.videos[v.n] && p.videos[v.n].seen);
  const hay = new Map(vids.map((v) => [v.n, [v.title.uz, v.title.en, ...videoItems(v).map((x) => x.en + " " + x.uz)].join(" ").toLowerCase()]));

  function rows(list) {
    return list.map((v) => {
      const seen = p.videos[v.n] && p.videos[v.n].seen;
      const best = p.videos[v.n] && p.videos[v.n].best;
      return `<a class="item ${seen ? "done" : ""}" href="/v/${v.n}" data-link>
        <span class="n">${seen ? icon("check") : v.n}</span>
        <span class="grow"><span class="t" style="display:block">${esc(v.title.uz)}</span><span class="s">${v.n}. ${esc(v.title.en)} · ${esc(v.format === "cards" ? t("videos.cards") : t("videos.dialogue"))}${best != null ? ` · ${best}%` : ""}</span></span>
        ${icon("chevron")}
      </a>`;
    }).join("");
  }
  function body() {
    if (q) {
      const found = vids.filter((v) => hay.get(v.n).includes(q.toLowerCase()) || String(v.n) === q);
      return `<section class="panel"><div class="list">${found.length ? rows(found) : `<div class="empty">${esc(t("words.none"))}</div>`}</div></section>`;
    }
    return bundles.map(([b, title]) => {
      const list = vids.filter((v) => v.bundle === b), seen = list.filter(isSeen).length;
      return `<section class="panel">
        <div class="panel-head panel-head-row"><div><p class="eyebrow">${esc(t("videos.bundle", { n: b }))}</p><h2>${esc(title)}</h2></div><span class="week-count">${seen}/${list.length}</span></div>
        <div class="list">${rows(list)}</div>
      </section>`;
    }).join("");
  }
  const seenN = vids.filter(isSeen).length;
  root.innerHTML = `
    ${pageHead({ back: "/app/course", backLabel: t("nav.lessons"), eyebrow: t("nav.lessons"), title: t("videos.title"), sub: esc(t("videos.sub")),
      body: `<div class="head-extra"><p class="panel-sub" style="margin-bottom:8px">${esc(t("profile.videosSeen"))}: ${seenN}/${vids.length}</p>
        <div class="progressbar"><div class="progressbar-fill" style="width:${vids.length ? Math.round((seenN / vids.length) * 100) : 0}%"></div></div></div>` })}
    <section class="panel">
      <form id="jump" class="setting-row btnrow" style="border-top:0;padding-top:0">
        <div><h3><label for="vnum">${esc(t("videos.jump"))}</label></h3></div>
        <div class="row"><input class="input" id="vnum" type="number" inputmode="numeric" min="1" max="${vids.length}" placeholder="12" style="width:96px"><button class="btn primary sm">${esc(t("videos.open"))}</button></div>
      </form>
      <input class="input" id="vsearch" type="search" placeholder="${esc(t("videos.search"))}" aria-label="${esc(t("videos.search"))}">
    </section>
    <div id="vlist" class="view-stack">${body()}</div>`;
  root.querySelector("#jump").addEventListener("submit", (e) => {
    e.preventDefault();
    const n = Number(root.querySelector("#vnum").value);
    if (n >= 1 && n <= 50) go("/v/" + n);
  });
  const s = root.querySelector("#vsearch");
  s.addEventListener("input", () => { q = s.value.trim(); root.querySelector("#vlist").innerHTML = body(); });
  return onAct(root, {});
}
