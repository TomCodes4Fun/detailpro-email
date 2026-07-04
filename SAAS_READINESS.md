# DetailPro CRM — SaaS Readiness Notes

## What changed in this pass
- Removed dead/unused debug files (`button-test.js`, `__appointments_inline.js`) that were no longer
  referenced by any page.
- Removed the blocking `prompt()` that asked for a business name on first load. The app now creates a
  sensible default account silently; the owner renames it from the new **Settings** page instead. A
  blocking native dialog on first run is a bad first impression for a paying customer.
- Added `settings.html`: business profile editing, plan badge, team management (uses the existing
  staff/admin helpers in `main-enhanced.js`), and **data backup/restore** (export everything to a
  `.json` file, restore from one). This was the biggest functional gap — all data lives in the
  browser's `localStorage`, so without backup/restore a customer can lose everything by clearing
  their browser or switching devices.
- Wired the dashboard's gear icon to the new Settings page (it previously did nothing).
- Connected the already-built `server/` email service to the notification system. Previously,
  `notifications.js` only ever opened a `mailto:` link (the owner had to manually hit send every
  time). It can now optionally POST to the included Express/Nodemailer server for real automated
  sending, with the `mailto:` flow kept as a fallback if the server isn't running. Toggle this on
  the Notifications page.

## Still needed before this is a real, sellable multi-tenant SaaS
This app is a strong single-business, single-browser prototype. To sell it as SaaS (multiple paying
businesses, accessible from any device) it still needs:

1. **A real backend + database.** Today "accounts" are just a localStorage record scoped by a
   generated ID — there is no server-side multi-tenancy. Data doesn't sync across devices or survive
   a cleared browser beyond the manual backup/restore added here.
2. **Authentication.** There is no login/password — anyone with the URL (and access to that browser)
   has full access. The "team" feature here is just a name switcher, not real per-user accounts.
3. **Billing.** `account.plan` already has a `free` / `pro` flag and `dpIsPro()` / `dpRequirePro()`
   helpers are scaffolded in `main-enhanced.js`, but nothing charges a card. Stripe (or similar)
   Checkout + webhooks would slot in here.
4. **Production email sending.** `server/server.js` works but needs to be deployed somewhere
   reachable (not `localhost`) with real SMTP credentials, plus rate limiting/auth so it can't be
   used as an open relay.
5. **Deployment & domain.** Currently this is a static file set + a local Node server. A real launch
   needs hosting, HTTPS, and a custom domain.

## Deploying with Netlify (frontend) + GitHub/Render (backend)

This repo is set up as a monorepo: the static frontend at the root, the email
server in `server/`. One GitHub repo, two deploys.

### 1. Push to GitHub
Push this whole folder as one repo. `.gitignore` already excludes `.env` and
`node_modules`, so secrets won't get committed.

### 2. Backend on Render
- New → Web Service → connect the repo.
- `render.yaml` is already set up as a Render "Blueprint" — Render should
  detect it and pre-fill: root directory `server`, build `npm install`,
  start `npm start`.
- Set the env vars it asks for (SMTP_HOST/PORT/USER/PASS, FROM_EMAIL,
  FROM_NAME). Leave `PORT` unset — Render injects it automatically.
- Set `ALLOWED_ORIGINS` to your Netlify URL once you have it, e.g.
  `https://your-app.netlify.app` (comma-separate if you also test from
  `http://localhost:5500` or similar).
- Set `EMAIL_API_KEY` to any random string — this is the shared secret the
  frontend must send so randoms can't use your Render URL as an open email
  relay.
- After deploy, confirm it's alive: `https://your-service.onrender.com/api/health`
  should return `{"ok":true,...}`.
- Note: Render's free tier spins down when idle, so the first email send
  after inactivity will be slow (~30–60s) while it wakes up.

### 3. Frontend on Netlify
- New site from Git → same repo. `netlify.toml` sets publish dir to `.`
  (the repo root) with no build step, so defaults should just work.
- Once deployed, go to **Settings → Notifications** in the app itself and
  enter your Render URL (e.g. `https://your-service.onrender.com`) and the
  `EMAIL_API_KEY` you set on Render, then turn on "Send automatically."
  These are stored per-browser in `localStorage`, not hardcoded in the repo,
  so each install/business configures it themselves.

### 4. CORS gotcha
If you redeploy or change your Netlify domain (including Netlify's deploy
preview URLs, e.g. `https://deploy-preview-12--your-app.netlify.app`), add
that exact origin to `ALLOWED_ORIGINS` on Render too, or the email server
will reject the request with a CORS error in the browser console.

### Reminder: this still doesn't make it multi-tenant
Netlify + Render gets you a live URL and working automated email — it does
not add a database, login, or billing. Every visitor to your Netlify URL
gets their *own* local data (scoped by a random ID generated in their
browser), and clearing that browser still loses their data unless they've
exported a backup from Settings. That's fine for a single business running
it themselves, or for demos, but not yet "sign up and pay for your own
account" SaaS — see the section above for what that requires.

