# Roadmap

What comes after the pilot, in the order it makes sense to build it, with
honest cost estimates and the traps that are easy to miss.

Written against commit `5f3dfd3`.

---

## Where the product is right now

- Seven screens, redesigned. Deployed.
- A customer is created by the operator at `/admin` and sent a **one-time link**.
  Clicking it mints their workspace key in their own browser.
- No account, no password, no email. Access lives in the browser that clicked
  the link.
- Nothing is charged for. Nothing gates any screen.
- **Still unproven: Google Ads has never accepted a feed.** That remains the
  first thing to establish, ahead of everything on this page.

---

## 1. Self-serve signup

**Goal:** a visitor creates their own workspace instead of the operator doing
it by hand.

### The important thing to know

This got a lot cheaper on 28 Aug. The invite work already built the hard half:
workspaces, key minting, one-time redemption, rotation and browser-side
sessions all exist and are tested. Signup is mostly *pointing the existing
machinery at the visitor instead of the operator*.

What is genuinely missing:

| Piece | Why it's needed | Cost |
|---|---|---|
| Email delivery | The link has to reach them | ~half a day (Resend or Postmark) |
| Email ownership check | Otherwise anyone signs up as anyone | folded into the above — the link *is* the proof |
| Abuse limiting | Nothing stops one script creating 10,000 workspaces | ~half a day (rate limit by IP and email domain) |
| The dialog itself | The UI | ~2 hours |

**Estimate: 1.5–2 days.**

### Where to put it

The suggestion was a modal over step 1 with the background blurred. That works,
and it is the right *moment* — they have arrived with intent but have not yet
done any work worth losing.

One trade-off to make deliberately: the landing page currently promises
**"no account needed"**, and gating step 1 makes that false. Two options:

- **Gate at step 1** — higher signup rate, but you lose everyone who wanted to
  try it before committing, and the promise has to come off the landing page.
- **Gate at step 5** (Connect) — they sign up at the moment they have already
  seen their own numbers and want the thing. Lower volume through the form,
  much higher intent, and the "no account needed" promise survives all the way
  to the payoff.

**Recommendation: gate at step 5, alongside payment.** One interruption instead
of two, at the point where the product has already proven itself. The blurred
modal is a good pattern — just put it later.

### Open decision: contact capture before the gate

Gating at step 5 has a cost that the recommendation above ignored. Everyone who
drops out at steps 1–4 leaves no trace, and those are precisely the people
worth a phone call — someone who reached their own model and then stopped is
the most informative churn there is.

The tension dissolves once **collecting an email** and **creating an account**
are treated as separate events. The wall is the account. The email is a field.

Proposed shape:

- **Step 1 or 2** — one optional field: *"Where should we send your model when
  it's ready?"* No password, no verification, skippable. A value exchange, not
  a gate.
- **Step 5** — account and payment, with the email already filled in. Signing
  up becomes one click instead of a form.

**Capture:** email, timestamp, furthest step reached. That is enough for the
call — *"you got all the way to your model and stopped, what happened?"* needs
no more than that.

**Do not capture:** spread ratio, lead count, deal values, or anything else
derived from their file. Today nothing touches the server until a customer
publishes, and that is a promise made on the landing page and in
`SECURITY_AND_DATA.md`. Storing derived facts about a non-customer's revenue is
a materially larger commitment than storing an email, and the same information
is available by asking them.

The one argument for storing the spread is triage — deciding which churned
users to call first. That is a problem worth solving at a few hundred churns
per month, not at zero. Leave it.

**Cost: ~half a day.** An optional field, a `leads` table, a ping per step.

Not code, and not optional if selling into the EU: a sentence at the point of
collection saying you may get in touch, and a delete-on-request path.

**Status: undecided.** The trade-off is between a slightly heavier step 1 and
having a churn list at all.

### Note on sessions

Access is currently "this browser remembers a key". That is fine for five
pilots and thin for a real product — no way to sign in on a second device
without a new link. Real sessions (email → magic link → cookie) are the
upgrade, and the redemption endpoint is already 80% of it.

---

## 2. Paid subscription

**Goal:** the automated feed requires an active subscription.

### The trap, stated first

There are two ways to get values out at step 5, and they are **not equally
enforceable**:

| Route | Runs where | Can it be gated? |
|---|---|---|
| **Feed URL** (`Generate my feed URL`) | Server — `POST /api/feeds` | **Yes, properly.** No subscription, no feed row, no URL. Nothing to work around. |
| **Download CSV** | Entirely in the browser | **No, not really.** The rows are already on screen; the button just formats them. A gate here is a speed bump anyone can step over with devtools. |

Making the CSV enforceable means generating it server-side, which means the
priced rows leaving the browser — against a core principle of the product
(`CLAUDE.md`, principle 5 and the storage guardrails).

### Recommendation: let that shape the pricing tiers

This is a constraint that happens to point somewhere good:

- **Free — download the CSV.** Manual. You re-upload to Google Ads yourself,
  every time you have new leads. Genuinely useful and genuinely annoying.
- **Paid — the feed URL.** Google fetches on a schedule. Set once, never
  touched again. Plus the nightly CRM sync when that lands.

The free tier is the thing you can't lock anyway, and the paid tier is exactly
the automation people will pay to stop doing by hand. The technical limit and
the commercial line are the same line.

### What it takes

| Piece | Cost |
|---|---|
| Stripe Checkout + customer portal | ~1 day |
| Webhook → subscription status on the workspace row | ~1 day (this is where the fiddly cases live) |
| Gate `POST /api/feeds` on that status | ~half a day |
| Paywall UI at step 5, with the free CSV route kept visible | ~half a day |

**Estimate: 2.5–3 days of code.**

### The part that is not code

Billing is where "done" and "finished" diverge:

- Failed payments and dunning — what happens to a live feed when a card
  expires? (Suggested: keep serving for a grace period, then stop. A feed that
  dies silently costs the customer money in a way they will blame you for.)
- Refunds and cancellations mid-period.
- **EU VAT / MOSS** if you sell to European businesses. This one is a genuine
  administrative project, not an afternoon.
- Invoices, receipts, VAT numbers.

Budget at least as much time for this as for the code.

---

## 3. Connect HubSpot at step 2

**Goal:** step 2 offers "connect HubSpot" beside "drop a CSV", so the worst
step in the funnel — export a file, find it, upload it — disappears for anyone
on HubSpot.

**Decided 28 Aug: submit the HubSpot public app now, build the screen later.**
The app review is the long pole and it is the one part not under our control,
so it starts while everything else waits. Step 2 stays CSV-only until it comes
back approved — by which point we will also know whether Google Ads accepts a
feed at all, which is the thing that decides if any of this matters.

### What already exists

More than expected. The OAuth path is complete and tested: signed state with a
15-minute TTL, code exchange, token refresh, `needsRefresh`. The reader takes a
`windowDays` parameter, so pulling twelve months of history instead of the
nightly window is a call-site change rather than new code.

### What it needs

| Piece | Cost |
|---|---|
| Re-scope CRM connections from feed to workspace (`crm_connections.feed_id` → `workspace_id`, plus the OAuth state which signs a feed id) | ~half a day |
| A history pull — `listRecentDeals()` with `windowDays: 365` | ~1 hour |
| Step 2 UI, and mapping auto-filled from known HubSpot properties | ~half a day |

**Estimate: ~1.5 days**, and none of it can ship before the app is approved.

A feed belongs to a workspace anyway, so the re-scoping is a simplification
rather than a workaround — worth doing even if this screen never gets built.

### Why a public app, and not the private token that already works

Private app tokens work today and are right for a pilot customer at step 5:
they are committed, and an operator can walk them through it. At step 2 they
are worse than exporting a CSV — create an app, tick three scopes, copy a
token. One-click OAuth is the only version of this worth building, and that
needs a public app.

### Registering it

Redirect URI (must match exactly, and this is why the domain should be settled
first — changing it later means editing the app):

    https://<your origin>/api/crm/hubspot/callback

Scopes, all read-only, matching `SCOPES` in `src/lib/sync/hubspot/oauth.ts`:

    crm.objects.deals.read
    crm.objects.contacts.read
    crm.objects.companies.read

Nothing that can write to a customer's CRM, because the product never needs
to. That is worth saying plainly in the review submission — read-only scopes
on a narrow set of objects is the easiest kind of app to approve.

Then `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET` in Vercel.

### The gate question, deferred with it

Connecting a CRM needs a workspace key, and a step-2 visitor has none. The
shape agreed for when this is built: **two doors** — CSV stays ungated exactly
as it is today, HubSpot asks for an email first. Someone willing to OAuth their
CRM is a much warmer lead than a CSV uploader, so asking at that moment is
qualification rather than friction, and "no account needed" stays true of the
door that touches nothing.

---

## 4. Suggested order

1. **Get one feed accepted by Google Ads.** Nothing on this page matters if the
   core mechanic doesn't work in a real account.
2. **HubSpot nightly sync** for the pilot customers. Needs `VBB_TOKEN_KEY` and
   `CRON_SECRET`. The code is built and tested; only configuration is missing.
3. **Submit the HubSpot public app.** Free, parallel, and the slowest thing
   here. Settle the domain first so the redirect URI does not have to change.
4. **Contact capture at step 1**, if that decision goes that way. Half a day,
   independent of everything below it, and the sooner it exists the sooner the
   churn list starts filling.
5. **Stripe + the paywall at step 5.** Gate the feed URL, keep the CSV free.
6. **Signup**, in the same modal as the paywall. One interruption, one moment.
7. **Step 2 HubSpot connection**, once the app is approved.
8. **Real sessions** — email magic link, works on any device.

Steps 5 and 6 land together because they are the same screen and the same
moment. Splitting them means interrupting the customer twice.

---

## Deliberately not on this roadmap

Per the scope guardrails in `CLAUDE.md`, and still true:

- Live Google Ads API calls — the feed URL is the integration.
- Meta CAPI — sketched, not scheduled.
- Multi-tenancy beyond one workspace per customer.
- A second LLM call anywhere. The one at intake is bounded to column mapping
  and claim extraction, and that boundary is the product's credibility.
