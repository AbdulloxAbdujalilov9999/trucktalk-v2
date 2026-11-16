# Setting up TruckTalk v2 for real

Everything below is optional except steps 1–3. Each outside service switches on when its keys are present and the app
hides what isn't configured, so you can go live with the course first and add payments, AI and Telegram one by one.

`GET /api/config?health=1` shows what the running server thinks is configured (no secrets in it).

> Use **new** accounts and projects for v2 (a new Firebase project, a new Telegram bot or a test bot, Whop test mode) so
> nothing here can touch the current TruckTalk or its students.

## 1. Firebase (sign-in and database)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (for example `trucktalk-v2`). Analytics is not needed.
2. **Build → Authentication → Sign-in method**: enable **Google**, and **Email/Password** with **Email link (passwordless sign-in)** turned on. Leave "Email/Password" itself off if you only want links.
3. **Authentication → Settings → Authorized domains**: add your Vercel domain (`your-app.vercel.app`) and your own domain.
4. **Build → Realtime Database → Create database** (choose the region closest to your students; `europe-west1` is fine for Uzbekistan and the US is fine for drivers there). Start in **locked mode**.
5. Deploy the rules and indexes from this repo. They deny all browser access (the server is the only client) and add the indexes the server's queries need (without them the admin search and payments list fail with "Index not defined"):
   ```bash
   npm i -g firebase-tools && firebase login
   firebase deploy --only database --project <your-project-id>
   ```
   Or paste `database.rules.json` into **Realtime Database → Rules** and publish.
6. **Project settings → Service accounts → Generate new private key**. The downloaded JSON is `FIREBASE_SERVICE_ACCOUNT` (paste the whole file, or base64 it: `base64 -w0 key.json`). Keep it secret; never commit it.
7. **Project settings → General → Your apps → Add app → Web**. Copy the config object into `FIREBASE_WEB_CONFIG` as JSON (it is public by design), for example
   `{"apiKey":"AIza...","authDomain":"trucktalk-v2.firebaseapp.com","projectId":"trucktalk-v2","appId":"1:...:web:..."}`
8. `FIREBASE_DATABASE_URL` is shown at the top of the Realtime Database page, e.g. `https://trucktalk-v2-default-rtdb.europe-west1.firebasedatabase.app`.

Google sign-in opens a popup and falls back to a redirect when popups are blocked. On Safari and some in-app browsers
the redirect needs the auth helper on your own domain: if people report that Google sign-in "comes back signed out",
add a rewrite in `vercel.json` from `/__/auth/:path*` to `https://<project-id>.firebaseapp.com/__/auth/:path*` and set
`authDomain` in `FIREBASE_WEB_CONFIG` to your own domain. Email links and Telegram are not affected.

## 2. Vercel

1. Push this repo to GitHub, then [vercel.com/new](https://vercel.com/new) → import it. No build command; the output directory is `public` (already in `vercel.json`).
2. **Settings → Environment Variables** (Production and Preview):

   | Variable | Value |
   |---|---|
   | `APP_URL` | `https://your-domain` (no trailing slash) |
   | `SESSION_SECRET` | 32+ random characters: `npm run secret` prints one |
   | `FIREBASE_SERVICE_ACCOUNT` | step 1.6 |
   | `FIREBASE_DATABASE_URL` | step 1.8 |
   | `FIREBASE_WEB_CONFIG` | step 1.7 |
   | `ADMIN_EMAILS` | your Google / email address (comma separated for more). Only verified sign-ins count |
   | `SUPPORT_TELEGRAM` | optional: your support username, without `@` |

3. Redeploy. Open the site, sign in with the admin email, and `/admin` opens. Make other admins or teachers from a student's page in the admin (they must have signed in once, with Google, an email link or Telegram).

Render instead of Vercel: a **Web Service**, start command `npm start`, same variables. `server.mjs` serves the same routes and headers.

Never set `DEMO_MODE` on a real deploy. (It turns itself off anyway whenever `FIREBASE_SERVICE_ACCOUNT` is set.)

## 3. Check it

- `/api/config?health=1` → `"database": "rtdb"`, `"sessionSecret": true`.
- Sign in on a phone, finish a lesson, sign in on another device: the progress is there.
- Open `/app/day/10` signed out: it asks for a plan; free days 1–3 open.

## 4. Payments (Whop)

1. In Whop, create a product (for example "TruckTalk") with four **one-time** plans, matching `public/js/shared/plans.js`:
   Self 1 month $19 · Self 3 months $49 · Pro 1 month $149 · Pro 3 months $399. (Change prices in both places if you change them.)
2. Copy each plan id (`plan_...`) into `WHOP_PLAN_SELF_MONTH`, `WHOP_PLAN_SELF_QUARTER`, `WHOP_PLAN_PRO_MONTH`, `WHOP_PLAN_PRO_QUARTER`. Only payments for these plan ids ever give access; anything else waits under **Admin → Payments → Unmatched**.
3. **Developer → API keys**: create a key that can create checkout configurations and read payments → `WHOP_API_KEY`.
4. **Developer → Webhooks**: URL `https://your-domain/api/webhooks?src=whop`, events `payment.succeeded`, `payment.refunded`, `refund.created`, `refund.updated`, `dispute.created`, `dispute.updated`, `membership.activated`. Copy the signing secret → `WHOP_WEBHOOK_SECRET`.
5. Test with Whop's test mode on a Vercel preview deployment first: buy, check that the plan opens within seconds, then refund and check that it closes.

How it behaves: a payment adds its days after any time already paid; a refund, dispute or admin revoke removes exactly what that payment gave (access is recomputed from the ledger, never edited in place); the same webhook delivered twice counts once.

**Manual payments** (Click, Payme, bank card transfer): set `MANUAL_PAYMENT_INFO` to the instructions you want shown on the pricing page. The student sends you their account ID (shown next to the instructions); you open their page in the admin and **Grant** the plan. Every grant and revoke is in the audit log.

## 5. AI teacher (Claude)

1. [console.anthropic.com](https://console.anthropic.com) → API key → `ANTHROPIC_API_KEY`.
2. **Set a monthly spend limit** in the Anthropic console. That is the hard stop; the app's limits are the soft ones.
3. Limits in the app (stored in the database, so they hold across server instances): per person per day free 3, trial 15, Self 40, Pro 100, staff 200 (`public/js/shared/plans.js`), and `AI_DAILY_LIMIT` for everyone together (default 3000). Inputs are capped at 400 characters. A conversation practice counts as one use for the student (up to 8 lines), and each line counts against `AI_DAILY_LIMIT`.
4. Model: `claude-haiku-5-5` by default (fast and cheap for short corrections). `TUTOR_MODEL` changes it.

## 6. Natural voice and the voice teacher (ElevenLabs)

1. `ELEVENLABS_API_KEY` turns on natural voices for lesson phrases. Each phrase is generated once and cached by the CDN and on each phone. Only canonical URLs for phrases in the course are answered, so it can't be used as a free text-to-speech service or made to regenerate audio. `TTS_DAILY_CHARS` (default 60000) caps new audio per day. Without a key the app uses the phone's own voice. The Uzbek list includes the meanings that "Listen in the truck" reads out (about 80,000 characters in all, each generated once): raise `TTS_DAILY_CHARS` for the first days if you want them ready sooner; until then the player shows those meanings on screen. (`OPENAI_API_KEY` is an alternative for English.)
2. Voice teacher: create an agent from `elevenlabs/teacher.agent.json` (ElevenLabs → Agents → New → import, or `npx @elevenlabs/cli agents push`). Keep **authentication on** (`enable_auth: true`) so only links signed by your server can start a call. Put its id in `ELEVENLABS_AGENT_ID`.
3. Minutes: Self 30, Pro 300 per 30 days. Each call reserves up to 10 minutes up front and is settled from ElevenLabs' own record of the call, so closing the tab or a modified app can't make calls free. `VOICE_DAILY_MINUTES` (default 240) caps all calls together per day. Also set a usage limit in ElevenLabs.

## 7. Telegram bot

1. [@BotFather](https://t.me/BotFather) → `/newbot` → token → `TELEGRAM_BOT_TOKEN`, username → `TELEGRAM_BOT_USERNAME`.
2. `TELEGRAM_WEBHOOK_SECRET`: `npm run secret` prints one.
3. Redeploy, then connect the webhook once from your computer. Put `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and
   `APP_URL` in a file named `.env` in the project folder (a copy of `.env.example`; it is never committed), then run:
   ```bash
   npm run telegram:setup
   ```
4. Try it: send `/start`, `12`, `TRUCK` and `/login` to the bot.

What the bot does: `t.me/<bot>?start=v12` (or just "12") sends lesson 12's key phrases and a link to it; `TRUCK` or `/start` sends the welcome with the free lessons, the course and prices; `/login` sends a one-time sign-in link (single use, 10 minutes); a signed-in student can connect Telegram from Settings. Every first contact is saved as a lead with its source (which video, the landing page...), visible under **Admin → Telegram leads**.

## 8. Marketing links for the 50 videos

With `APP_URL` and `TELEGRAM_BOT_USERNAME` in `.env`:

```bash
npm run marketing -- --src yt
```

writes `marketing/captions.md` (a ready description per video, with the lesson link and the bot link), `links.csv` and
`end-card.md` (what to say at the end of new videos instead of "DM TRUCK"). The admin's **Marketing links** page shows
the same with copy buttons. Links with `?src=yt-v12` show up in the admin as "came from YouTube, lesson 12".

## Environment variables, all of them

See `.env.example`, which has a comment for each. Required in production: `APP_URL`, `SESSION_SECRET`,
`FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_DATABASE_URL`, `FIREBASE_WEB_CONFIG` (or `FIREBASE_API_KEY` + friends).

## Moving students from the current TruckTalk (only if you switch)

v2 starts with an empty database. If you decide to replace the current app with it:

- Google and email accounts can be matched by email; a small import script can copy their finished days into `progress/<uid>`.
- Phone-number accounts can't sign in to v2 (that sign-in was the security problem). They would sign in with Telegram or Google instead, and their progress can be attached by phone number from the admin.
- The SpeakUp-1 site uses the current TruckTalk's `/api/tutor`, `/api/agent` and `/api/tts`. v2 doesn't serve SpeakUp, so keep the current deployment (or those endpoints) running until SpeakUp-1 has its own.
