# Deploying VBB for the pilot

For whoever puts this into production. Follow it top to bottom the first time;
after that only the **Shipping a change** section matters.

Nothing here needs a developer, but step 3 involves secrets — read the warning
in it before you start.

---

## 1. What you need first

| | Where it comes from |
|---|---|
| A Supabase project | supabase.com — free tier is enough for five pilots |
| A Vercel project connected to this repo | vercel.com |
| An Anthropic API key | console.anthropic.com — **optional**, see step 3 |

You do **not** need a HubSpot developer app. Customers connect with a private
app token from their own portal.

---

## 2. Create the database tables

The database and the code have to move together. **Run this before deploying
the code**, or publishing will fail with a constraint error.

1. Supabase → your project → **SQL Editor** → **New query**
2. Open `supabase/setup.sql` from this repo, copy all of it, paste it in
3. **Run**
4. You should see `Success. No rows returned`
5. Check **Table Editor**. You should now have seven tables:

```
workspaces        one row per customer
feeds             one tokenized URL per customer
feed_rows         the finished conversions Google fetches
feed_models       the frozen rule stack a nightly run applies
feed_fetches      every time Google collected, which is also the rate limiter
crm_connections   encrypted HubSpot credentials
sync_runs         what each nightly run did
```

`setup.sql` is every migration concatenated in order and is safe to re-run —
each statement is `create table if not exists`. If you would rather apply them
one at a time they are in `supabase/migrations/`, in filename order.

---

## 3. Set the environment variables

Vercel → your project → **Settings** → **Environment Variables**. Set each for
**Production**.

> **Secrets go from where they are issued straight into Vercel.** Do not paste
> them into email, chat, a ticket, or a conversation with an AI assistant. If
> one is ever exposed, rotate it at the source rather than hoping.

### Required

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **secret** key (`sb_secret_…`). Not the publishable one — the app refuses that and says so. |
| `VBB_TOKEN_KEY` | A generated password, 24+ characters (below). Encrypts customers' CRM credentials. |
| `CRON_SECRET` | Another generated password. Without it the nightly endpoint stays shut rather than falling open. |

For the two you make yourself, use a password generator — a password manager,
or 1password.com/password-generator. Set the length to **40 characters** and
generate one for each. Anything 24 characters or longer is accepted; below that
the app refuses to start rather than encrypting with a weak key.

A developer who would rather generate a raw key can:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Optional

| Variable | What it does if set |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on assisted column mapping. Without it the product runs on header matching and says so. |
| `VBB_INTAKE_MODEL` | Overrides the model used for that. Default is a fast one; latency is what matters there, not depth. |
| `VBB_PUBLIC_ORIGIN` | The domain feed URLs are built from. Only needed for a custom domain — on Vercel the production domain is detected. |
| `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` | Only for OAuth. Private app tokens need neither. |

### About `VBB_TOKEN_KEY`

Rotating it does not lose data. Every CRM connection simply reports that it
needs reconnecting, which is the same thing that happens when a customer
revokes access at their end. Losing it has the same effect. Keep it somewhere
you can find it, but do not treat it as unrecoverable.

---

## 4. Deploy

Vercel → **Deployments** → the top one → **⋯** → **Redeploy**, with
"Use existing Build Cache" **unchecked**.

Wait for **Ready**, then check the deployment is healthy:

- `https://<your-domain>/` loads
- `https://<your-domain>/workspace` shows the key prompt
- `https://<your-domain>/feed-status` shows the feed check

---

## 5. Confirm the nightly job is scheduled

`vercel.json` in this repo requests one cron:

```json
{ "crons": [{ "path": "/api/cron/sync", "schedule": "0 6 * * *" }] }
```

That is 06:00 UTC daily. Vercel picks it up on deploy — check
**Settings → Cron Jobs** shows it.

> Vercel's Hobby plan allows one cron job per day, which is exactly what this
> uses. Nothing needs upgrading for the pilot.

Test it by hand once:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/sync
```

Expect `{"ok":true,"feeds":0,...}` before any customer is connected. Without the
header you should get a 404 — that is correct, the endpoint hides rather than
refusing.

---

## 6. Create your first workspace

From a machine with the Supabase variables set locally:

```bash
npm run workspace -- create "Customer name"
```

It prints a key starting `vbb_ws_` **once**. Store it where you keep customer
records and send it to them. Only a hash is kept, so it cannot be recovered —
if it is lost, create a new workspace.

See `CUSTOMER_ONBOARDING.md` for what happens next.

---

## Shipping a change

1. Check `supabase/migrations/` for anything new since your last deploy.
   If there is, run `supabase/setup.sql` **before** deploying.
2. Push to the branch Vercel builds.
3. Watch the deployment reach Ready.
4. Open one customer's workspace page and confirm it still reports correctly.

Before pushing, these should all pass:

```bash
npm test          # unit and integration
npx tsc --noEmit  # types
npm run lint      # 6 warnings in public/vbb.js are expected and pre-existing
npm run build     # production build
./scripts/db-test.sh   # schema guarantees against a real Postgres
```

---

## If a deployment goes wrong

**Publishing fails with a constraint error** — the migration did not run.
Do step 2, then redeploy.

**Everything returns "not set up on this deployment"** — a required environment
variable is missing. Re-check step 3, then redeploy: Vercel only picks up
variable changes on a new deployment.

**The database is "broken" but nothing is logged** — almost always the
publishable Supabase key rather than the secret one. The app detects this and
writes an explicit line to the Vercel function log.

**Roll back** — Vercel → Deployments → an earlier one → **⋯** → Promote to
Production. Safe as long as you have not applied a migration since; the
migrations only add tables, so an older build ignores what it does not know
about.
