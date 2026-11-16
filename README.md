# TruckTalk v2

English for truck drivers working in the USA: a 60-day course, 50 short video lessons, a grammar book, spaced review, hands-free listening for the road, practice games, conversation practice with an AI police officer, dispatcher or broker, an AI teacher and a live voice teacher. Uzbek first, Russian and English too.

This is a rebuild of the current TruckTalk (`truck-talk-webapp`), made to compare against it. The current app is untouched. SpeakUp is not part of this version. **[docs/DIFFERENCES.md](docs/DIFFERENCES.md)** lists what changed and why.

## Try it in one minute (no accounts, no keys)

Needs [Node.js](https://nodejs.org) 22 or newer, on Windows, macOS or Linux.

```bash
npm install
npm run dev          # http://localhost:3000  (demo mode: pretend sign-in and payments, data in .data/)
```

Demo mode has buttons to sign in as a student, a teacher or an admin, and a pretend checkout, so every screen works without Firebase, Whop, Anthropic or ElevenLabs. It switches itself off whenever a real database is configured.

## What's inside

| Part | Where | What it does |
|---|---|---|
| Landing page | `/` (`public/index.html`) | Explains the course, links all 50 video lessons, and has a box where a viewer types the lesson number from a video |
| Video lessons | `/v/1` … `/v/50` | Every line with audio and translation, a self-test, and "add to review". Free, no sign-up |
| The course | `/app`, `/app/course` | Laid out like the main TruckTalk app: home, the lessons by week, and each day in tabs (Words, Conversation, Grammar, Quiz; review days: Practice, Conversation, Review quiz). 5 orientation days + 60 days, quiz graded by the server, spoken role-play, grammar book (33 units), certificate |
| Homework | `/app/homework` | One session per lesson: study the day's words, then a quiz (fill in the blank and word questions). Search over every course word and video phrase |
| Progress and settings | `/app/progress`, `/app/settings` | Stats, the week's XP against your goal, quizzes worth retaking, badges; language, translations, theme, voice and speed, daily goal, plan, backup, Telegram |
| Practice | `/app/practice` | Hub for everything below, plus spaced review |
| Listen in the truck | `/app/listen` | Hands-free player: English, its meaning (Uzbek natural voice or the phone's Russian voice), a pause to repeat, the English again slower. Keeps the screen on, works with headphone and steering-wheel buttons |
| Practice games | `/app/practice/<game>` | Trucking numbers and spelling read aloud (load and PO numbers, phone numbers, appointment times, weights, bridge heights, rates, mile markers, reefer temps, the radio alphabet), listen and choose, match the pairs, build the sentence, say it (speech recognition). Mistakes go to the review deck |
| Conversation practice | `/app/talk` | 11 real situations (police stop, DOT inspection, shipper, late at the receiver, dispatcher, broker, breakdown, repair shop, DOT physical, truck stop, job interview). Claude plays the other person and coaches every line. One AI use per conversation |
| AI teacher | `/app/teacher` | Claude checks a sentence or answers a question, in Uzbek or Russian. Daily limits per plan |
| Voice teacher | `/app/teacher?tab=voice` | Live spoken lesson (ElevenLabs agent). Paid plans, minutes counted by the server |
| Pricing and checkout | `/app/pricing` | Free, trial (3 days, once per person), Self and Pro plans for 1 or 3 months via Whop; optional manual payment |
| Telegram bot | `t.me/<bot>` | Answers a lesson number or `TRUCK`, sends sign-in links, tracks which video brought each lead |
| Admin | `/admin` | Overview, students (search, grant or revoke a plan, roles, block, notes), payments incl. unmatched ones, Telegram leads, audit log, marketing links for every video |

Free without paying: the orientation days, days 1–3, the first grammar units and all 50 video lessons.

## Commands

```bash
npm run dev            # demo mode on :3000
npm start              # production server (Render or any Node host); Vercel uses api/ directly
npm test               # 66 unit and integration tests (node:test), incl. the real HTTP server in demo mode
npm run check          # content files up to date, offline list complete, no inline scripts, every UI string translated
npm run e2e            # phone-size browser walkthrough with screenshots (needs Playwright; see e2e/run.mjs)
npm run build:content  # rebuild content/ and public/data/ from sources/ (course, grammar, 50 video scripts)
npm run marketing      # video descriptions with lesson links for all 50 videos (reads APP_URL from .env)
npm run secret         # prints a random value for SESSION_SECRET or TELEGRAM_WEBHOOK_SECRET
```

CI (`.github/workflows/ci.yml`) runs check, tests and the browser walkthrough on every push and pull request.

## Deploying

Vercel (recommended, free plan is enough to start) or Render. Step by step, with every environment variable: **[docs/SETUP.md](docs/SETUP.md)**. In short:

1. A new Firebase project: Google + email-link sign-in, a Realtime Database, deploy `database.rules.json` (denies all browser access; the server is the only client).
2. Set the environment variables from `.env.example` in Vercel.
3. Optional services, each switched on by its keys: Whop (payments), Anthropic (AI teacher), ElevenLabs (natural voice and voice teacher), Telegram (bot).
4. `npm run telegram:setup` once to connect the bot (it reads `.env`).

## How it's built

No build step: static pages and native ES modules in `public/`, 11 small server functions in `api/` (Vercel's free plan allows 12), shared logic in `lib/`. The browser never talks to the database. Lessons and answer keys stay on the server, every limit and payment is checked there, and progress merges safely across devices. Details: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

```
public/          landing, app, admin pages; js/app (screens), js/admin, js/shared (also used by the server)
api/             server functions (config, me, content, quiz, progress, pay, webhooks, tts, ai, admin, dev)
lib/             auth, database, payments ledger + Whop, limits, AI tutor, voice, TTS, Telegram, admin
content/         full course content (server only, built from sources/)
sources/         the course as written: v1 curriculum and grammar files, the 50 video scripts
scripts/         content build, checks, marketing captions, Telegram setup
tests/  e2e/     automated tests and the browser walkthrough
elevenlabs/      the voice teacher agent's configuration
```
