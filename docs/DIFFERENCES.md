# TruckTalk v2: what's different from the current TruckTalk

v2 is a rebuild in its own folder and repository. The current app (`truck-talk-webapp`, live at trucktalk.courses) was
not changed. v2 keeps the TruckTalk course content, adds the 50 video lessons, removes SpeakUp, and fixes every problem
found in the 15 Nov 2026 review by changing how the app is built rather than patching each spot.

## At a glance

| | Current TruckTalk | v2 |
|---|---|---|
| Courses | TruckTalk and SpeakUp behind a course picker | TruckTalk only |
| Who can start | New students are sent to SpeakUp; TruckTalk opens only when staff allow it or after all 60 SpeakUp lessons | Anyone: free lessons at once, then a 3-day trial (once per person) or a plan |
| People who watched a video | "Bizga DM yozing: TRUCK", and nothing answered | A landing page where they type the lesson number, a free page for each of the 50 lessons (`/v/12`), a Telegram bot that answers `TRUCK` or a lesson number, and ready descriptions for every video |
| Sign-in | Google, email and password, phone number without SMS | Google, email link, Telegram (the bot proves who it is). No phone-number login |
| Selling | Whop payments on an unmerged branch | Pricing page, Whop checkout, refunds and disputes take access away, manual payments with admin grants, pretend checkout in demo mode |
| Lessons and answers | Every lesson and answer key downloadable without signing in | Paid lessons only from the server to people who may open them; answers never reach the browser before the student answers |
| Progress on a new phone | Never loaded back; the cloud copy gets overwritten with zero | Merged from every device, safely, on the server |
| Security boundary | 24 KB of database rules, one per path | The browser never touches the database; the server checks everything and the rules deny all |
| Cost limits | Counted in each server instance's memory | Counted in the database, so they hold everywhere |
| Voice teacher | Open to trials; 40 calls a day for everyone; minutes taken from what the browser says (payments branch) | Paid plans only; minutes reserved up front and settled from ElevenLabs' own record of the call |
| Natural voice | Junk URL parameters make it regenerate (and bill) the same audio | Only one exact URL per course phrase; everything else refused and never cached |
| Admin | Dashboards load the whole user list live | Server-side search and filters, payments (incl. unmatched), Telegram leads, audit log of every change, marketing links |
| Weak signal | Waits for the network with no time limit | Falls back to the saved copy after 3.5 seconds |
| Security headers | No Content-Security-Policy | Strict CSP, no inline scripts (checked automatically) |
| Look | TruckTalk brand and a mile-marker progress map | The TruckTalk logo with a navy and amber look and road-sign details, fonts served by the app itself, light and dark themes, a highway with 12 exits on the home screen and a course map that opens week by week |
| Practice | Inside each lesson: flip cards, fill in the blank, word matching, a role-play spoken into the mic | The same inside each lesson (flip cards, match the pairs, fill in the blank, a spoken role-play where you pick your part and can hide your lines), plus a Practice tab: spaced review, hands-free listening for the road, five practice games (incl. trucking numbers and spelling by ear) and conversation practice with an AI officer, dispatcher, broker and others |
| Tests | 7 test files, no CI | 63 automated tests, a 19-step browser walkthrough at phone size, CI on every push |
| Trying it | Needs Firebase and keys | `npm run dev` runs everything with nothing set up |

## Every finding from the review, and what v2 does

| # | Problem in the current app | In v2 |
|---|---|---|
| C1 | Progress is never loaded from the cloud, so a new phone overwrites it with zero; shared phones mix students | The device and the server merge (first completion wins, best score wins, nothing is ever lost), inside a database transaction. Local copies are kept per account. Tested, including a second "phone" in the browser walkthrough |
| C2 | Phone sign-in password is made from the number; phone accounts can become teacher or manager | No phone-number login. Telegram sign-in uses one-time links the bot sends to that Telegram account. Staff roles only go to accounts with a verified sign-in, nobody can change their own role, and every change is in the audit log |
| H1 | Unlimited free trials (fake numbers) can use up the voice teacher and the AI | One trial per account and per verified identity (email, Telegram, phone, stored as hashes). Trials have no voice minutes. Per-person and platform-wide daily budgets live in the database |
| H2 | `/api/tts` regenerates audio for any extra URL parameter | Only the canonical URL of an allowlisted course phrase is answered; anything else is a 400 that is never cached; a daily character budget on top |
| H3 | Students can write anything into progress, names and events | Students write nothing directly. The server keeps only known keys and sane values (no future timestamps, scores within range, names limited) |
| P1 | Voice minutes come from what the browser reports | Reserved before the call, settled from ElevenLabs' conversation record (must be our agent, near the reservation, settles one session). Closing the tab or lying costs the full reservation |
| P2 | Refunds, chargebacks and cancellations are ignored | Refunds, disputes and admin revokes change the payment's status and access is recomputed from the ledger |
| P3 | Any Whop payment counts as a TruckTalk plan | Only the four TruckTalk plan ids from the environment give access; anything else waits under "Unmatched" in the admin |
| P4 | The duplicate-payment check isn't atomic | Payments and webhook ids are recorded with an atomic create-once, so a retried webhook can't add days twice |
| — | Plan access stays after it expires | Nothing is granted forever; access is computed from the ledger each time |
| M1 | All lesson content is public, locks only in the app | Paid lessons and all answer keys stay on the server; the public catalog has titles and counts only |
| M2 | Owner sign-up trusts an unverified email | `ADMIN_EMAILS` only counts verified sign-ins |
| M3 | The retired admin repo can roll back production rules | Not applicable: v2 uses its own Firebase project, and its rules are one deny-all file plus indexes |
| M4 | No Content-Security-Policy | Strict CSP; `npm run check` fails on any inline script or handler |
| M5 | Service worker waits for the network with no timeout | 3.5-second timeout, then the saved copy |
| M6 | Live-quiz answers can be changed after the reveal | Not part of v2 (live classes stay in the separate teachers site) |
| M7 | Two voice agent configs disagree (300 vs 1800 seconds) | One config; a test fails if the server's call limit and the agent's maximum differ |
| L1 | Admin re-renders the whole user list on every change | The admin asks the server for one page, search result or filter at a time |
| L2 | The tutor retries on any HTTP 400 | No blind retries; a failed call gives the student's allowance back |
| L3 | Staff can fake who did a reset | The server writes the audit log with the caller's own account |
| L4 | The Android app bundles an old copy of the site | v2 installs as a web app from the browser and always runs the current version |
| L5 | Stale branches | Fresh repository |
| Tests | No database-rules tests, no CI | Rules are deny-all (nothing to test per path); 63 tests cover access, payments, webhooks, grading, sync, practice, lesson games and the HTTP server; CI runs them plus the browser walkthrough |

## New in v2

**A new look, and lessons that teach more** (second round, 16 Nov 2026):

- **Home**: a greeting, a progress ring, the next lesson with one big Continue button, the streak, today's XP against
  the daily goal and the words waiting for review, then the highway: a road with the truck where the student is and
  12 exit signs, one per week, that turn green as the weeks are done.
- **Course map**: the same road and the next lesson on top, then orientation and the 12 weeks; a week opens to its
  five days, finished days show their quiz score, and the current week is open.
- **Inside each lesson**: a header with the week, the time it takes and progress through the five steps. Words come
  as flip cards (word on the front; meaning, example and its translation on the back) or a list, with "listen to
  all". Under them, **match the pairs** and **fill in the blank**: the day's own example sentences with the word left
  out, four choices, and the whole sentence read aloud after the answer (it works for 984 of the 1,020 words, keeps
  names and acronyms capitalised, and never lets a capital letter give the answer away).
- **Role-play** under every dialogue: pick your part (the driver by default), optionally hide your lines, then the
  other person speaks in a natural voice and you answer into the mic; each line is scored word by word, and at the end
  you can swap parts. Phones without speech recognition get an "I said it" button instead.
- **Finishing a day** gets a celebration with the XP earned, the streak and how many words went into review.
- **Brand and type**: the truck logo and "Truck Talk: English for the road" in the top bar, Oswald for headings and
  Inter for text (both served by the app, so they work offline and in Uzbek and Russian), a proper dark theme.

**Practice for drivers** (the Practice tab; added 16 Nov 2026):

- **Listen in the truck.** A hands-free player for the road: the English phrase, its meaning (the Uzbek teacher's
  natural voice, or the phone's Russian voice), a pause to say it out loud, then the English again a little slower.
  Any video lesson, course day or the student's own review words; shuffle, loop, longer pauses. Keeps the screen on
  and answers headphone and steering-wheel buttons where the phone allows it. A safety note says to set it up before
  driving.
- **Numbers and spelling by ear.** The voice reads what dispatchers, brokers and officers actually say (load and PO
  numbers, phone numbers, appointment times, weights, bridge heights, rates per mile, mile markers, reefer
  temperatures, addresses, the radio alphabet) and the student types it. The check forgives how it's typed ("2:30 pm",
  "14:30", "13 6", "80k") but not a wrong number, then shows the sentence and how it was said.
- **Conversation practice.** 11 situations from a driver's week: a police stop, a DOT inspection, checking in at a
  shipper, arriving late at a receiver, calling dispatch, negotiating with a broker, a breakdown call, the repair shop,
  the DOT physical, a truck stop, a job interview. Claude plays the other person in simple spoken English and, after
  every line, says whether it was right, gives the smallest fix and why (in Uzbek or Russian), and suggests what to say
  next. Speak or type. A conversation counts as one AI use; the server keeps its line count (8 at most), so it can't
  be stretched into free AI calls. Corrections are listed at the end to practise.
- **Four quick games** from what the student can already open: listen and choose, match the pairs, build the
  sentence, and say it (the phone's speech recognition shows which words came through). A phrase the student gets
  wrong goes into their review deck, so it comes back at the right time.
- The tab bar has **Practice** in place of Review (review is inside Practice and on the home screen), and the home
  screen has a "Practice for the road" row.

**Everything else new:**

- **A front door for video viewers.** The landing page explains the course in Uzbek, Russian or English, lists all 50
  video lessons, and has a box: type the number from the video, land in that lesson. Each lesson page plays every line
  with a natural voice and the translation, has a self-test and "add to my review". Links remember which video brought
  each student (`?src=yt-v12`), so the admin shows which videos bring students.
- **The 50 video lessons** are built from the scripts, with two facts corrected (lesson 33: a medical card is good for
  *up to* two years; lesson 37: the sleeper split can be 8 + 2 or 7 + 3) and the "DM TRUCK" ending dropped.
- **Selling through the app**: pricing with Free, Self and Pro for 1 or 3 months, checkout, a "thank you" that waits
  for the payment to arrive, a trial button, manual payment instructions, and FAQ.
- **Telegram bot**: lesson by number, `TRUCK` welcome, prices, sign-in links, connecting Telegram to an existing account,
  and leads by source.
- **AI teacher** checks a sentence or answers a question in Uzbek or Russian, with clear daily limits per plan.
- **Profile**: plan and limits, six stats, badges, voice and speed, daily goal, light or dark theme, install button,
  Telegram connect, sync status.
- **Certificate** after the final road test (as before), now printable to PDF and shareable.
- **Admin**: overview with revenue and today's AI and voice use, students with search and filters, a student page
  (progress, quiz results, payments, voice calls, grant or revoke a plan, role, block, reset trial, notes), payments
  incl. unmatched ones with the buyer's email, Telegram leads, audit log, and marketing links and captions for every video.
- **Uzbek spelling**: apostrophes in lesson text are the proper oʻ, gʻ and ʼ everywhere, and dates read "2026-yil
  15-noyabr".
- **Demo mode, tests and CI**, and a setup guide with every environment variable (`docs/SETUP.md`).

## Not carried over (yet)

Say which of these you want and they can be added to v2:

- **SpeakUp**, by request.
- **The teachers' area**: the lesson guidebook with answer keys and the Kahoot-style live classes (`/teachers/`). The
  separate `trucktalk-teachers` classroom site is untouched and keeps working; the Pro plan's live classes are meant to
  run there. In v2, teachers can look at every student's progress and quiz results in the admin.
- **Lesson presentations narrated in Uzbek** (the slide mode where the teacher's voice explains each lesson).
- **Manager role, approval queue and calendar.** v2 has student, teacher and admin, and no approval step: free lessons
  are open, paid ones need a plan.
- **The Android app.** v2 installs from the browser as an app (home-screen icon, works offline).
- **Homework**: the current app's word sessions between lessons. In v2 the review deck and the Practice tab do that job.
- **A separate progress page.** v2 shows progress on the home screen, the course map and the profile.

## If you decide to switch to v2

- Use a new Firebase project (the setup guide assumes it), so the current app and its data stay as they are.
- Students' accounts and progress are not moved automatically. Google and email accounts can be matched by email and
  their progress imported; phone-number accounts would sign in with Telegram or Google and be matched by phone.
- The SpeakUp-1 site calls the current TruckTalk's `/api/tutor`, `/api/agent` and `/api/tts`. v2 doesn't serve those,
  so keep the current deployment running for SpeakUp-1 until it has its own.
- Old videos still say "DM TRUCK" on screen. The Telegram bot now answers `TRUCK`, so pointing that call to action at
  the bot works for the old videos; new videos can end with the lesson number and the site (`npm run marketing` writes
  the suggested ending).

## Comparing them yourself

- v2: `npm install`, then `npm run dev`, then open http://localhost:3000 and use the demo sign-in buttons (student, teacher,
  admin). Or look at the phone screenshots from the browser walkthrough in `e2e/screenshots/`.
- Current app: trucktalk.courses.
