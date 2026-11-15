# How TruckTalk v2 works

## The shape of it

```
 phone / laptop browser                              Vercel (or server.mjs on Render / locally)
 ───────────────────────                             ─────────────────────────────────────────────
 public/index.html   landing (static, prebuilt)      api/*.js   11 small functions, all through lib/http.js
 public/app.html     the app (ES modules, no build)    │
 public/admin.html   admin (same modules)              ├─ lib/session.js   ID token → identity → profile → access
 sw.js               offline shell                     ├─ lib/content.js   lessons + grading (content/*.json)
                                                        ├─ lib/payments/    ledger + Whop
 Firebase Auth (Google, email link, custom token) ───► ├─ lib/limits.js    daily budgets in the database
   gives an ID token, sent as "Authorization: Bearer"   ├─ lib/tutor.js     Claude (AI teacher)
                                                        ├─ lib/voice.js     ElevenLabs agent (voice teacher)
                                                        ├─ lib/tts.js       natural voice for course phrases
                                                        └─ lib/db.js ──► Firebase Realtime Database (REST, service account)
                                                                         rules: deny everything to browsers
 Telegram ──► /api/webhooks?src=telegram   Whop ──► /api/webhooks?src=whop
```

The browser never reads or writes the database. Everything goes through the server, which checks who is asking and
what they may do. That one decision removes most of the old app's problems: there are no database rules to get wrong
for each path, students can't write fake progress or roles, and limits and payments can't be bypassed from the browser.

## Who is asking (lib/session.js, lib/firebase.js, lib/users.js)

1. The browser signs in with Firebase Auth: Google, an email link, or a custom token minted by our server after the
   Telegram bot proved who the person is. There is no phone-number login.
2. Every API call carries the Firebase ID token. The server verifies it with Google's public keys (RS256, `aud`, `iss`,
   expiry, auth time), without the Admin SDK.
3. The profile (`users/<uid>`) is created by the server on first sign-in. `accessOf(profile)` decides the tier:
   `blocked` > `staff` (teacher or admin) > `self`/`pro` (paid and not expired) > `trial` (active) > `free`.
4. Admins: emails in `ADMIN_EMAILS` (verified sign-ins only), or accounts an admin promoted. Staff roles can only go to
   accounts whose sign-in proved who they are, nobody can change their own role, and every change goes to `audit/`.

## What each tier may open (public/js/shared/plans.js, shared by browser and server)

| | Free (signed out or in) | Trial (3 days, once) | Self | Pro | Staff |
|---|---|---|---|---|---|
| Orientation, days 1–3, first grammar units, all 50 videos | ✓ | ✓ | ✓ | ✓ | ✓ |
| Days 4–60, all grammar, full phrasebook | | ✓ | ✓ | ✓ | ✓ |
| AI teacher checks per day | 3 (signed in) | 15 | 40 | 100 | 200 |
| Voice teacher minutes per 30 days | | | 30 | 300 | 600 |

A trial needs a verified identity and is recorded against a hash of that identity (`trialKeys/`): email, Telegram id
and phone, so a new account with the same email or Telegram doesn't get a second one.

## Content (sources → scripts/build-content.mjs)

```
sources/v1/*.js            the 60-day curriculum, grammar book, Uzbek and Russian translations (from the current app)
sources/video-scripts/*.txt the 50 video scripts
        │  npm run build:content   (fails on a missing translation, a numbering gap, or a broken script)
        ▼
content/course.json, grammar.json            full lessons incl. answer keys and teacher notes   SERVER ONLY
content/phrases-en.json, phrases-uz.json     what the voice endpoint may speak                  SERVER ONLY
public/data/catalog.json                     titles, counts, free flags (no answers)             public
public/data/videos.json                      the 50 video lessons (all free)                     public
public/index.html                            the landing page's lesson list, prices and Uzbek text
```

`npm run check` fails if any generated file is stale. Corrections to facts in the published videos live in
`CORRECTIONS` in the build script (lessons 33 and 37), and the old "DM TRUCK" ending is dropped.

`GET /api/content` sends a lesson only to someone who may open it, without quiz answers. `POST /api/quiz` grades on the
server and returns the right answers only for questions that were answered. A paid lesson's quiz can't be graded by
someone who can't open it, so answers can't be fished out. Results are kept in `results/<uid>` for teachers.

## Progress (public/js/shared/progress.js, api/progress.js)

- Saved on the device at once (`localStorage` key per account, `tt2:p:<uid>`), and to the server 2.5 s later.
- `merge(a, b)` is commutative, idempotent and associative: first completion time wins, best quiz score wins, the
  latest review of each card wins, XP is the maximum per device per day summed over devices, settings by latest change.
  So any order of syncs from any number of devices ends in the same place and nothing is lost.
- The server merges inside a database transaction and `sanitize()`s everything (known keys only, sane numbers, no
  timestamps from the future or before 2024), then returns the merged copy, which the device merges back in. That is
  how a new phone gets everything back.
- Signing in folds the progress made while signed out into the account.

## Payments (lib/payments/ledger.js, lib/payments/whop.js)

- `payments/<uid>/<paymentId>` is the ledger: provider, plan, tier, days, time, status (`paid`, `refunded`,
  `disputed`, `revoked`). `paidUntil` and the paid tier are **recomputed from the ledger** after every change: paid
  periods stack one after another, and a refunded or revoked payment simply stops counting.
- Recording a payment is atomic and idempotent (`createOnce`), and every webhook id is processed once
  (`whop/events/`), so a retried webhook can't add days twice.
- Checkout: `POST /api/pay` creates a Whop checkout for that account; the account id travels in the checkout's
  metadata. Access opens only when the signed webhook arrives, never because the browser came back from checkout.
- The plan comes from Whop's plan id (allowlisted in env), not from metadata a buyer could edit. Payments that can't be
  matched to an account or plan wait in `whop/unmatched/` and attach when the membership names the account; admins see
  them with the buyer's email.
- Manual grants from the admin are ledger entries too (`provider: "manual"`), with who granted them.

## Limits that hold (lib/limits.js)

`usage/<day>/<name>` counters, changed in database transactions: per person (`ai/<uid>`) and for everyone
(`ai/_all`, `tts/chars`, `voice/_seconds`). A failed upstream call gives its unit back. Because they live in the
database, they hold across all server instances (the old app counted in each instance's memory). Anonymous endpoints
also have a best-effort in-memory limiter.

## Voice teacher (lib/voice.js)

`voice-start` checks the plan's minutes over the last 30 days, reserves up to 10 minutes (charged at once) and returns a
short-lived signed link to the private agent. `voice-end` reports the conversation id; the real length is read from
ElevenLabs (the conversation must belong to our agent, start near the reservation, and settle only one session), and
the unused part goes back. A session that never settles costs the full reservation. `MAX_CALL_S` equals the agent's
`max_duration_seconds` (a test keeps them equal).

## Natural voice (lib/tts.js, api/tts.js)

Public, but only for the exact canonical URL of a phrase on the course's allowlist (`ttsQuery()` in
`public/js/shared/text.js` builds it, the server rebuilds it and compares). Anything else, including extra parameters,
gets a 400 that is never cached. Audio is cached for a year (`immutable`) by the CDN and the phone, so each phrase is
generated once. A daily character budget caps new audio.

## Telegram (lib/telegram.js)

Login links are HMAC-signed with `SESSION_SECRET`, expire in 10 minutes and are single use (`loginTokens/`). Linking an
existing account uses a one-time code (`telegramLinks/`). Every first contact is a lead with its source (`leads/`).
The webhook checks Telegram's secret header and always answers 200 so a bad update isn't retried forever.

## Browser side

- `public/js/app/main.js`: router, shell, sign-in plumbing. Each screen is a module in `views/` that renders into
  `#app` and returns a cleanup function. HTML is built from strings with `esc()` on every value.
- Strict Content-Security-Policy (no inline scripts, `scripts/check.mjs` enforces it), `X-Frame-Options: DENY`,
  `nosniff`, HSTS. `server.mjs` applies the same headers as `vercel.json` and refuses paths outside `public/`.
- Offline (`public/sw.js`): the app shell is cached on install; pages and files are fetched fresh with a 3.5 s timeout
  and fall back to the saved copy, so a weak roadside signal never hangs the app. Lessons a student opened are cached by
  the app itself, played audio in its own cache.
- Languages: `public/js/app/i18n.js` (Uzbek, Russian, English). The landing page's Uzbek text is filled in at build
  time so it shows before any script runs; `check.mjs` fails if a string is missing in any language.

## Data in the database

| Path | What | Written by |
|---|---|---|
| `users/<uid>` | profile: name, email, Telegram, role, tier, paidUntil, trial, source, note, blocked | sign-in, trial, payments, admin |
| `progress/<uid>` | merged progress | `/api/progress` |
| `results/<uid>` | quiz results graded by the server | `/api/quiz` |
| `payments/<uid>/<id>`, `paymentIndex/<id>` | the ledger and its index | payments, admin |
| `voice/<uid>/<session>`, `voiceConversations/<id>` | voice sessions and claimed conversation ids | voice teacher |
| `usage/<day>/...` | daily counters | limits |
| `trialKeys/<hash>` | who used a trial, by identity | trial start |
| `telegram/<id>`, `telegramLinks/<code>`, `loginTokens/<id>`, `leads/<id>` | Telegram accounts, link codes, used login tokens, leads | bot |
| `whop/events`, `whop/unmatched`, `whop/memberships`, `whop/users` | webhook ids, payments waiting for an account, Whop ids | webhook |
| `audit/<id>` | every admin change with who made it | admin |

A daily cleanup (started from the admin overview) removes usage counters after 40 days, expired login tokens and link
codes, and webhook ids after 30 days. Accounts, progress and payments are never removed automatically.

## Demo mode and tests

`DEMO_MODE=1` with no service account: the same code paths, with an in-memory database (saved to `.data/` by `npm run
dev`), HS256 demo tokens instead of Firebase, `/api/dev` for pretend sign-in and payments, and canned AI answers with the
real limits. Tests use the same in-memory database; `tests/api.test.mjs` starts the real server. `e2e/run.mjs` drives
Chromium through a student's and an admin's day at phone size.
