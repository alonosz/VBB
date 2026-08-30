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
| Email ownership check | Otherwise anyone signs up as anyone | folded into the above - the link *is* the proof |
| Abuse limiting | Nothing stops one script creating 10,000 workspaces | ~half a day (rate limit by IP and email domain) |
| The dialog itself | The UI | ~2 hours |

**Estimate: 1.5–2 days.**

### Where to put it

The suggestion was a modal over step 1 with the background blurred. That works,
and it is the right *moment* - they have arrived with intent but have not yet
done any work worth losing.

One trade-off to make deliberately: the landing page currently promises
**"no account needed"**, and gating step 1 makes that false. Two options:

- **Gate at step 1** - higher signup rate, but you lose everyone who wanted to
  try it before committing, and the promise has to come off the landing page.
- **Gate at step 5** (Connect) - they sign up at the moment they have already
  seen their own numbers and want the thing. Lower volume through the form,
  much higher intent, and the "no account needed" promise survives all the way
  to the payoff.

**Recommendation: gate at step 5, alongside payment.** One interruption instead
of two, at the point where the product has already proven itself. The blurred
modal is a good pattern - just put it later.

### Open decision: contact capture before the gate

Gating at step 5 has a cost that the recommendation above ignored. Everyone who
drops out at steps 1–4 leaves no trace, and those are precisely the people
worth a phone call - someone who reached their own model and then stopped is
the most informative churn there is.

The tension dissolves once **collecting an email** and **creating an account**
are treated as separate events. The wall is the account. The email is a field.

Proposed shape:

- **Step 1 or 2** - one optional field: *"Where should we send your model when
  it's ready?"* No password, no verification, skippable. A value exchange, not
  a gate.
- **Step 5** - account and payment, with the email already filled in. Signing
  up becomes one click instead of a form.

**Capture:** email, timestamp, furthest step reached. That is enough for the
call - *"you got all the way to your model and stopped, what happened?"* needs
no more than that.

**Do not capture:** spread ratio, lead count, deal values, or anything else
derived from their file. Today nothing touches the server until a customer
publishes, and that is a promise made on the landing page and in
`SECURITY_AND_DATA.md`. Storing derived facts about a non-customer's revenue is
a materially larger commitment than storing an email, and the same information
is available by asking them.

The one argument for storing the spread is triage - deciding which churned
users to call first. That is a problem worth solving at a few hundred churns
per month, not at zero. Leave it.

**Cost: ~half a day.** An optional field, a `leads` table, a ping per step.

Not code, and not optional if selling into the EU: a sentence at the point of
collection saying you may get in touch, and a delete-on-request path.

**Status: built, 29 Aug. One box, at the bottom of step 5.**

Four placements were considered and three were cut.

*Beside the hero button*, the original suggestion. Cut: above the fold it
competes with the only action on that screen that matters, and it would sit a
few pixels under the line promising no account needed.

*Bottom of the landing page*, as an exit ramp. Built, then cut the same day.
The argument for it was that it costs no starts, and that is true, but costing
nothing is not the same as being worth anything. Nobody fills in a box asking
for their address in exchange for a vague future contact from a company they
have just decided not to try.

*Bottom of the report* was the first version that shipped, on the argument that
the person is looking at what their own leads are worth. Right instinct, wrong
screen: the report still has a step after it, so the box sat next to an action
we would rather they took.

*Bottom of step 5* is where it ended up. They have their model, they have their
feed, and there is nothing left in the product to compete with: whatever
happens next happens in Google Ads. An address left there is worth a phone
call, which is the whole point of collecting one.

Step 1 and 2 stay clean. `leads` holds an address, a moment and a one-word
label, and the schema has no numeric or free-text column, so nothing derived
from their file can be put there later without a migration somebody has to
argue for.

### Note on sessions

Access is currently "this browser remembers a key". That is fine for five
pilots and thin for a real product - no way to sign in on a second device
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
| **Feed URL** (`Generate my feed URL`) | Server - `POST /api/feeds` | **Yes, properly.** No subscription, no feed row, no URL. Nothing to work around. |
| **Download CSV** | Entirely in the browser | **No, not really.** The rows are already on screen; the button just formats them. A gate here is a speed bump anyone can step over with devtools. |

Making the CSV enforceable means generating it server-side, which means the
priced rows leaving the browser - against a core principle of the product
(`CLAUDE.md`, principle 5 and the storage guardrails).

### Recommendation: let that shape the pricing tiers

This is a constraint that happens to point somewhere good:

- **Free - download the CSV.** Manual. You re-upload to Google Ads yourself,
  every time you have new leads. Genuinely useful and genuinely annoying.
- **Paid - the feed URL.** Google fetches on a schedule. Set once, never
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

- Failed payments and dunning - what happens to a live feed when a card
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
step in the funnel - export a file, find it, upload it - disappears for anyone
on HubSpot.

**Decided 28 Aug: submit the HubSpot public app now, build the screen later.**
The reasoning was that app review is the long pole and the one part not under
our control, so it should start while everything else waits.

**Corrected 29 Aug: there is no wait.** A public app does not have to be listed
in the App Marketplace before a customer can install it. You hand them the
OAuth link, they approve, it works. Listing is a distribution channel, for
being found by strangers browsing HubSpot's directory. It is not a permission
gate, and it never blocked us.

So the sequence is: create the app, put `HUBSPOT_CLIENT_ID` and
`HUBSPOT_CLIENT_SECRET` in the environment, and pilot customers can one-click
connect the same week. Marketplace submission becomes an ordinary growth item,
scheduled whenever being discoverable is worth the listing work.

One caveat left open: installing an app that is not listed may still require
the customer's Super Admin, or the "App Marketplace Access" permission that
Super Admins carry automatically. Reports conflict on whether an unlisted app
is stricter than a listed one. Worst case that is a marketer forwarding one
link to their admin, which is still far short of the private app token path
(create an app, find the scopes screen, tick three boxes, copy a token).

### Why this is not only convenience (added 29 Aug)

The early gate does not work without it. That was not obvious when this section
was written, so it is worth stating plainly.

Every other figure in the report is fixed the moment a lead arrives, computed
once from the file in front of us. The gate is the one number that fires later:
a lead reaches a pipeline stage, and we send Google a higher value for a
conversion it already has. Google accepts that for 7 days and then stops.

So the gate needs the lead's stage to be **read again, inside that week, after
the upload**. A one-time CSV cannot do it:

| Setup | Adjustments the gate actually produces |
|---|---|
| One CSV, once | Only for leads already in the file and under 7 days old. **None ever** for a lead that arrives tomorrow. |
| Re-upload weekly | Most of them. |
| Re-upload monthly | Almost none. The window has closed by the time we look. |
| Live connection, nightly | All of them. This is what the feature was designed against. |

Nothing in the product was lying about this, but nothing was saying it either.
A customer could read the gate panel, see a x1.7, publish once and reasonably
believe their leads were sharpening as they progressed. The report now states
the condition on the panel itself, and step 5 says the same next to the connect
button.

That does not move the HubSpot app off the critical path, but it does change
what it is for. It is not a nicer way to avoid an export. It is the thing that
makes a whole feature real.

### What already exists

More than expected. The OAuth path is complete and tested: signed state with a
15-minute TTL, code exchange, token refresh, `needsRefresh`. The reader takes a
`windowDays` parameter, so pulling twelve months of history instead of the
nightly window is a call-site change rather than new code.

### What it needs

| Piece | Cost |
|---|---|
| Re-scope CRM connections from feed to workspace (`crm_connections.feed_id` → `workspace_id`, plus the OAuth state which signs a feed id) | ~half a day |
| A history pull - `listRecentDeals()` with `windowDays: 365` | ~1 hour |
| Step 2 UI, and mapping auto-filled from known HubSpot properties | ~half a day |

**Estimate: ~1.5 days**, and it can ship as soon as the app exists. Approval
was never the blocker; see the correction above.

A feed belongs to a workspace anyway, so the re-scoping is a simplification
rather than a workaround - worth doing even if this screen never gets built.

### Why a public app, and not the private token that already works

Private app tokens work today and are right for a pilot customer at step 5:
they are committed, and an operator can walk them through it. At step 2 they
are worse than exporting a CSV - create an app, tick three scopes, copy a
token. One-click OAuth is the only version of this worth building, and that
needs a public app.

### Registering it

**Updated 30 Aug: there is no longer a button for this.** HubSpot sunset
legacy public app creation on 23 June 2026. The dialog in a developer account
now offers Private only, and the tooltip over Public says new legacy public app
creation is disabled. Public apps are created with the HubSpot CLI:
`hs project create`, an `app-hsmeta.json` holding the redirect URL and scopes,
then `hs project upload`.

Full click-by-click, including the exact config file, is in `HUBSPOT_APP.md`.
The values below are still the values, they just live in a file now rather
than a form.

Redirect URI (must match exactly, and this is why the domain should be settled
first - changing it later means editing an app customers have installed):

    https://<your origin>/api/crm/hubspot/callback

Scopes, all read-only, matching `SCOPES` in `src/lib/sync/hubspot/oauth.ts`:

    crm.objects.deals.read
    crm.objects.contacts.read
    crm.objects.companies.read

Nothing that can write to a customer's CRM, because the product never needs
to. That is worth saying plainly in the review submission - read-only scopes
on a narrow set of objects is the easiest kind of app to approve.

Then `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET` in Vercel.

### The gate question, deferred with it

Connecting a CRM needs a workspace key, and a step-2 visitor has none. The
shape agreed for when this is built: **two doors** - CSV stays ungated exactly
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
3. **Create the HubSpot public app.** Free, and it makes one-click OAuth work
   immediately: no marketplace review stands between the app existing and a
   customer installing it. Settle the domain first so the redirect URI does
   not have to change, because changing it later means editing a live app.
4. **Contact capture at step 1**, if that decision goes that way. Half a day,
   independent of everything below it, and the sooner it exists the sooner the
   churn list starts filling.
5. **Stripe + the paywall at step 5.** Gate the feed URL, keep the CSV free.
6. **Signup**, in the same modal as the paywall. One interruption, one moment.
7. **Step 2 HubSpot connection**, any time after the app exists. Note that the
   nightly sync at step 2 in this list already delivers the early gate for
   pilot customers; this item is about removing the export from the funnel,
   not about making the gate work.
8. **Marketplace listing**, if and when being discoverable is worth the
   listing work. Nothing depends on it.
9. **Real sessions** - email magic link, works on any device.

Steps 5 and 6 land together because they are the same screen and the same
moment. Splitting them means interrupting the customer twice.

---

## Deliberately not on this roadmap

Per the scope guardrails in `CLAUDE.md`, and still true:

- Live Google Ads API calls - the feed URL is the integration.
- Meta CAPI - sketched, not scheduled.
- Multi-tenancy beyond one workspace per customer.
- A second LLM call anywhere. The one at intake is bounded to column mapping
  and claim extraction, and that boundary is the product's credibility.
