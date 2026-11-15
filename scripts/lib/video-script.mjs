/* Parses one TruckTalk video script (sources/video-scripts/NN.txt) into an app lesson.
 *
 * Two formats exist:
 *   Conversation      INTRO, DIALOGUE (numbered lines with an English speaker, then "UZ:" and maybe "(spoken as: ...)"),
 *                     RECAP (phrases said twice, each followed by a narrator note), OUTRO + END CARD
 *   Word / sign cards INTRO, CARDS (a term or sign, its Uzbek, maybe "(spoken as: ...)", then narrator notes), OUTRO
 * Narrator lines inside RECAP/CARDS belong to the item just before them. */

const SECTION = /^---\s*(.+?)\s*---\s*$/;
const NUMBERED = /^(\d{2})\s{2,}(Narrator \(UZ\)|Voice EN [12])(?:\s*\(x2\))?:\s*(.*)$/;

/** Uzbek Latin letters written with a plain apostrophe (o' g') get the proper oʻ gʻ, and other apostrophes the tutuq belgisi ʼ. */
export function uzQuotes(s) {
  return String(s)
    // o\u02BB / g\u02BB inside a word (o\u02BBzbek, yo\u02BBl, qog\u02BBoz); a quote after an English word ('go', 'parking') is left alone
    .replace(/([oOgG])['\u2018\u2019`](?=[A-Za-z])/g, "$1\u02BB")
    // the few Uzbek words that end in g\u02BB
    .replace(/\b([TtSsYyBb]og)['\u2018\u2019`](?![A-Za-z])/g, "$1\u02BB")
    // tutuq belgisi between letters (ma\u02BClumot, fe\u02BCl)
    .replace(/([A-Za-z])['\u2019]([A-Za-z])/g, "$1\u02BC$2");
}

export function parseVideoScript(text, n) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const out = {
    n, title: { uz: "", en: "" }, bundle: 0, bundleTitle: "", style: "", format: "",
    intro: "", lines: [], recap: [], cards: [], outro: "", next: "",
  };
  let section = "", last = null, pending = null;

  const flushPending = () => { pending = null; };
  const header = (re) => { const l = lines.find((x) => re.test(x)); return l ? l.replace(re, "").trim() : ""; };
  out.title.uz = uzQuotes(header(/^Title \(UZ\):\s*/));
  out.title.en = header(/^Title \(EN\):\s*/);
  const b = lines.map((l) => /^Bundle (\d+) - (.+)$/.exec(l.trim())).find(Boolean);
  if (b) { out.bundle = Number(b[1]); out.bundleTitle = uzQuotes(b[2].trim()); }
  out.style = header(/^Style:\s*/);
  const f = header(/^Format:\s*/);
  out.format = /conversation/i.test(f) ? "conversation" : "cards";
  const end = header(/^End card:\s*/);
  const m = /Keyingi dars:\s*(.+)$/.exec(end);
  out.next = m ? m[1].trim() : "";

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const sec = SECTION.exec(line.trim());
    if (sec) { section = sec[1].toUpperCase(); last = null; flushPending(); continue; }
    const num = NUMBERED.exec(line.trim());
    if (num) {
      const who = num[2], said = num[3].trim();
      if (who.startsWith("Narrator")) {
        if (section.startsWith("INTRO")) out.intro = join(out.intro, said);
        else if (section.startsWith("OUTRO")) out.outro = join(out.outro, said);
        else if (last && (section.startsWith("RECAP") || section.startsWith("CARDS"))) last.note = join(last.note, said);
        else if (section.startsWith("DIALOGUE")) out.lines.push({ who: "narrator", uz: said });
        else out.intro = join(out.intro, said);
        continue;
      }
      const speaker = who.endsWith("1") ? "en1" : "en2";
      const item = { who: speaker, en: said, uz: "" };
      if (section.startsWith("DIALOGUE")) out.lines.push(item);
      else if (section.startsWith("RECAP")) { delete item.who; out.recap.push(item); }
      else if (section.startsWith("CARDS")) { delete item.who; out.cards.push(item); }
      else continue;
      last = item; pending = item;
      continue;
    }
    const t = line.trim();
    if (pending && /^UZ:\s*/.test(t)) { pending.uz = t.replace(/^UZ:\s*/, "").trim(); continue; }
    if (pending && /^\(spoken as:\s*(.+)\)$/.test(t)) { pending.say = /^\(spoken as:\s*(.+)\)$/.exec(t)[1].trim(); continue; }
  }
  // The published videos end with "Bizga DM yozing: TRUCK", which led nowhere. The app shows its own next step instead.
  out.outro = dropDmCta(out.outro);
  return out;
}

export function dropDmCta(s) {
  return String(s).replace(/\s*(?:[^.?!]*\?\s*)?Bizga DM yozing:?\s*TRUCK\.?/gi, "").trim();
}

function join(a, b) { return a ? a + " " + b : b; }

/** Problems worth failing the build for (missing translations, empty lessons). */
export function checkVideo(v) {
  const errs = [];
  if (!v.title.uz || !v.title.en) errs.push("title");
  if (!v.bundle) errs.push("bundle");
  if (!v.intro) errs.push("intro");
  const items = [...v.lines.filter((l) => l.who !== "narrator"), ...v.recap, ...v.cards];
  if (items.length < 4) errs.push("too few items (" + items.length + ")");
  items.forEach((it, i) => { if (!it.en || !it.uz) errs.push("item " + i + " missing en/uz: " + JSON.stringify(it)); });
  if (v.format === "conversation" && !v.lines.length) errs.push("conversation without dialogue");
  if (v.format === "cards" && !v.cards.length) errs.push("cards lesson without cards");
  return errs;
}
