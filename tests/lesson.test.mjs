/* Practice inside a course day: finding a word in its example sentence, "fill in the blank" questions, and who the
 * student plays in the dialogue role-play. Checked on small cases and on every day of the shipped course. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { wordForms, findWord, blankRound, speakers, defaultSpeaker } from "../public/js/shared/lesson.js";
import { normalize } from "../public/js/shared/text.js";

/** A repeatable random generator, so a failing case can be replayed. */
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const isAcronym = (w) => /^[A-Z0-9]$/.test(w) || /^[A-Z0-9]{2,}\b/.test(w) || /^[A-Z][-\d]/.test(w);
const capital = (w) => /^\p{Lu}/u.test(w);
const course = JSON.parse(fs.readFileSync("content/course.json", "utf8"));
const allDays = [...course.orientation, ...course.days];

test("the forms of a word worth looking for, the short one first", () => {
  assert.deepEqual(wordForms("Reefer / Dry van"), ["Reefer", "Dry van"]);
  assert.deepEqual(wordForms("To load"), ["load", "To load"]);
  assert.deepEqual(wordForms("Trailer (pritsep)"), ["Trailer"]);
  assert.deepEqual(wordForms("The bill of lading"), ["bill of lading", "The bill of lading"]);
  assert.deepEqual(wordForms("A"), ["A"], "a letter of the alphabet is not an article");
  assert.deepEqual(wordForms("Stop!"), ["Stop"]);
  assert.deepEqual(wordForms(""), []);
  assert.deepEqual(wordForms(undefined), []);
});

test("finds a word in its sentence: whole words, any case, common endings", () => {
  const s = "We loaded the trailer at the dock.";
  assert.deepEqual(findWord(s, "To load"), { start: 3, end: 7, ending: "ed", form: "load" });
  assert.equal(s.slice(3, 7), "load");
  assert.equal(findWord("Two trailers are waiting.", "Trailer").ending, "s");
  assert.equal(findWord("He is fueling up.", "Fuel").ending, "ing");
  assert.equal(findWord("BILL OF LADING please", "Bill of lading").start, 0);
  assert.equal(findWord("Check the bill  of lading.", "Bill of lading").form, "Bill of lading", "extra spaces are fine");
  assert.equal(findWord("I need to download the app.", "To load"), null, "not inside another word");
  assert.equal(findWord("The truck's brakes", "Truck").ending, "'s", "a possessive is still the word");
  assert.equal(findWord("Two drivers' logs", "Driver").ending, "s");
  assert.equal(findWord("I'm late.", "I"), null, "not part of a contraction");
  assert.equal(findWord("", "Truck"), null);
  assert.equal(findWord("A reefer and a dry van", "Reefer / Dry van").form, "Reefer");
  const sign = "This road has a 'No Trucks' sign.", hit = findWord(sign, "No trucks");
  assert.equal(sign.slice(hit.start, hit.end), "No Trucks", "inside quotes");
  const wake = "Ask for a wake-up call.", w = findWord(wake, "Wake up call");
  assert.equal(wake.slice(w.start, w.end), "wake-up call", "a space in the word matches a hyphen");
  assert.equal(findWord("Sign the bill of lading.", "The bill of lading").start, 9, "the gap leaves out the article");
});

test("fill in the blank: the sentence comes back whole, one right answer, no repeated options", () => {
  const words = [
    { id: "a", en: "Trailer", ex: "The trailer is empty.", tr: "Pritsep boʻsh." },
    { id: "b", en: "To load", ex: "We load at 6 AM.", tr: "Biz soat 6 da yuklaymiz." },
    { id: "c", en: "Dispatcher", ex: "Call the dispatcher now.", tr: "Dispetcherga hozir qoʻngʻiroq qiling." },
    { id: "d", en: "DOT", ex: "The DOT officer checks logs.", tr: "DOT xodimi jurnallarni tekshiradi." },
    { id: "e", en: "Fuel", ex: "Fuel is expensive today.", tr: "Bugun yoqilgʻi qimmat." },
  ];
  for (let seed = 1; seed <= 25; seed++) {
    const qs = blankRound(words, 6, seeded(seed));
    assert.equal(qs.length, 5);
    assert.equal(new Set(qs.map((q) => q.id)).size, 5, "each word asked once");
    for (const q of qs) {
      const w = words.find((x) => x.id === q.id);
      assert.equal((q.before + q.answer + q.after).toLowerCase(), w.ex.toLowerCase());
      assert.equal(q.opts[q.a], q.answer);
      assert.ok(q.opts.length >= 3 && q.opts.length <= 4);
      assert.equal(new Set(q.opts.map((o) => o.toLowerCase())).size, q.opts.length);
      assert.equal(q.tr, w.tr);
    }
  }
  const fuel = blankRound(words, 6, seeded(3)).find((q) => q.id === "e");
  assert.equal(fuel.answer, "Fuel", "capital at the start of the sentence");
  assert.ok(fuel.opts.filter((o) => !isAcronym(o)).every(capital), "every option capitalised the same way");
  const load = blankRound(words, 6, seeded(3)).find((q) => q.id === "b");
  assert.equal(load.answer, "load");
  assert.ok(load.opts.includes("DOT") || load.opts.every((o) => /^[a-z]/.test(o)), "acronyms keep their capitals");
  const dot = blankRound(words, 6, seeded(3)).find((q) => q.id === "d");
  assert.equal(dot.answer, "DOT");
});

test("fill in the blank: names keep their capital, and so does every option beside one", () => {
  const words = [
    { id: "i", en: "Interstate", ex: "We are driving on Interstate 40." },
    { id: "r", en: "On-ramp", ex: "Use the on-ramp to enter the highway." },
    { id: "f", en: "Fire extinguisher", ex: "Check the fire extinguisher's date." },
    { id: "n", en: "Median", ex: "Don't stop on the median." },
    { id: "s", en: "Long time no see", ex: "Hey! Long time no see!" },
  ];
  for (let seed = 1; seed <= 20; seed++) {
    const qs = blankRound(words, 6, seeded(seed));
    const by = (id) => qs.find((q) => q.id === id);
    assert.equal(by("i").answer, "Interstate");
    assert.ok(by("i").opts.every(capital), "beside a name every option has a capital");
    assert.equal(by("r").answer, "on-ramp");
    assert.ok(by("r").opts.includes("Interstate") || by("r").opts.every((o) => !capital(o)), "a name stays a name");
    assert.equal(by("f").answer, "fire extinguisher");
    assert.equal(by("f").after, "'s date.");
    assert.equal(by("s").answer, "Long time no see", "a sentence can start after '!'");
    assert.ok(by("s").opts.every(capital));
  }
});

test("fill in the blank needs enough words to make real choices", () => {
  assert.deepEqual(blankRound([], 6), []);
  assert.deepEqual(blankRound(undefined, 6), []);
  const two = [{ id: "a", en: "Trailer", ex: "The trailer is empty." }, { id: "b", en: "Fuel", ex: "Fuel is expensive." }];
  assert.deepEqual(blankRound(two, 6), [], "two words cannot give three options");
  const notInSentence = [
    { id: "a", en: "Trailer", ex: "It is empty." }, { id: "b", en: "Fuel", ex: "It is expensive." },
    { id: "c", en: "Brake", ex: "The brake is new." },
  ];
  assert.deepEqual(blankRound(notInSentence, 6), [], "only one word appears in its own sentence");
  const dupes = [
    { id: "a", en: "Trailer", ex: "The trailer is empty." }, { id: "b", en: "trailer", ex: "Hook the trailer." },
    { id: "c", en: "Fuel", ex: "Fuel is expensive." }, { id: "d", en: "Brake", ex: "Check the brake." },
  ];
  const qs = blankRound(dupes, 6, seeded(9));
  assert.equal(qs.length, 3, "a word listed twice counts once");
  assert.equal(blankRound(dupes, 2, seeded(9)).length, 2, "no more than asked for");
});

test("every day of the course gets word practice that makes sense", () => {
  let asked = 0;
  for (const d of allDays) {
    if (!d.words || !d.words.length) continue;
    const words = d.words.map((w) => ({ id: w.id, en: w.en, ex: w.ex && w.ex.en, tr: w.ex && w.ex.uz }));
    const qs = blankRound(words, 99, seeded(d.n + 100));
    // Day -1 teaches whole sentences instead of words, so it only gets the matching game.
    if (d.n !== -1) assert.ok(qs.length >= 2, `day ${d.n}: only ${qs.length} blank questions`);
    for (const q of qs) {
      const w = d.words.find((x) => x.id === q.id);
      assert.equal(q.before + q.answer + q.after, normalize(w.ex.en), `day ${d.n}: ${w.en}`);
      assert.equal(new Set(q.opts.map((o) => o.toLowerCase())).size, q.opts.length, `day ${d.n}: repeated option`);
      if (!isAcronym(q.answer)) {
        const alike = q.opts.filter((o) => capital(o) === capital(q.answer)).length;
        assert.ok(alike >= 2, `day ${d.n}: the capital letter gives the answer away in ${q.opts.join(", ")}`);
      }
      asked++;
    }
  }
  assert.ok(asked > 900, `only ${asked} questions in the whole course`);
});

test("the role-play: who speaks, and which part the student plays", () => {
  const d = (...who) => who.map((w) => ({ who: w, en: "..." }));
  assert.deepEqual(speakers(d("Dispatcher", "Driver", "Dispatcher", "Driver")), ["Dispatcher", "Driver"]);
  assert.deepEqual(speakers(d(" Officer ", "", "Driver")), ["Officer", "Driver"]);
  assert.deepEqual(speakers(undefined), []);
  assert.equal(defaultSpeaker(d("Dispatcher", "Driver")), "Driver");
  assert.equal(defaultSpeaker(d("Driver", "Dispatcher")), "Driver");
  assert.equal(defaultSpeaker(d("Driver A", "Driver B")), "Driver A");
  assert.equal(defaultSpeaker(d("Trainer", "Trainee")), "Trainee", "otherwise the second speaker");
  assert.equal(defaultSpeaker(d("Solo")), "Solo");
  assert.equal(defaultSpeaker([]), "");
  for (const day of allDays) {
    if (!day.dialogue || !day.dialogue.length) continue;
    const all = speakers(day.dialogue);
    assert.ok(all.length >= 2, `day ${day.n}: a role-play needs two people`);
    assert.ok(all.includes(defaultSpeaker(day.dialogue)), `day ${day.n}`);
  }
});
