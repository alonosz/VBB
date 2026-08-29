# Operator runbook

Every message VBB can show a customer, what it means, and what to do about it.

**Written to be used at speed.** Find the message, do the thing. Nothing here
needs code or SQL - anything that does is marked **→ developer** and you should
stop and escalate rather than improvising.

Start by opening the customer's workspace page: `<your-domain>/workspace`, with
their `vbb_ws_` key. Everything below refers to what it says at the top.

---

## The three colours

| | Meaning |
|---|---|
| **Needs fixing** (red) | Values are wrong or not arriving. Act today. |
| **Worth a look** (amber) | Working, but not as well as it could. Act this week. |
| **Working** (green) | Nothing to do. |

Items are ordered worst first. Fix the top one, reload, repeat.

---

## Messages, and what to do

### "No feed has been published yet."

Onboarding stopped before step 5. Run the diagnostic with their export and
publish. `CUSTOMER_ONBOARDING.md` step 4.

---

### "This feed has been revoked."

Somebody revoked it, deliberately or not. Google cannot collect from a revoked
feed at all.

Publish a new feed from the diagnostic and paste the new URL into their Google
Ads data source. The old URL will never work again - this is not recoverable
and is not meant to be.

---

### "No saved model is attached to this feed."

The feed was published before models were stored, or the model failed to save.
The nightly job cannot price anything without one, so nothing new is reaching
Google.

Re-publish from the diagnostic. That saves the model alongside the feed. Their
existing rows in Google are unaffected.

---

### "The model is fitted in USD but the feed reports EUR."

**Stop. This one silently produces wrong numbers.** Every value would be off by
the exchange rate and look completely plausible.

Re-run the diagnostic with the reporting currency set to whatever the model was
fitted in, or refit in the currency the feed uses. Do not "just carry on".

---

### "The stored CRM credentials cannot be read."

The encryption key changed, or the stored value was corrupted. Nothing leaked
and nothing is lost.

Ask the customer to reconnect HubSpot from their workspace page - a new private
app token, or reconnecting OAuth. Two minutes.

If this appears for **every** customer at once, the deployment's `VBB_TOKEN_KEY`
changed. **→ developer.**

---

### "No CRM is connected."

Not a fault. Their feed only updates when somebody publishes by hand, which is
a supported way to work.

Worth a conversation: connecting HubSpot means it refreshes itself nightly and
nobody has to remember. `CUSTOMER_ONBOARDING.md` step 6.

---

### "HubSpot would not renew the connection. Reconnect the account."

Their token was revoked, expired, or the private app was deleted at their end.
Nothing you can do from here.

Ask them to create a new private app token and paste it in. Check they tick all
three read scopes - deals, contacts *and* companies. A missing scope is the
most common cause of this coming straight back.

---

### "The CRM could not be read. Nothing was published; the next run will pick these up."

HubSpot was down or unreachable for that run. Genuinely nothing to do - the
next night catches up, and no leads are lost.

If it happens three nights running, it is not HubSpot. **→ developer.**

---

### "The nightly sync has not run yet."

**If the CRM was connected today:** correct. The first run happens overnight.

**If it was connected days ago:** the scheduled job is not running.
**→ developer.**

---

### "The nightly sync has not run for N days. New leads are not reaching Google."

The scheduled job has stopped firing. This is not something happening to one
customer - check another customer's page, and if theirs says the same, the cron
is down for everyone.

**→ developer.** Nothing on the customer's side causes this.

---

### "Google has never collected this feed."

The feed is fine; Google is not fetching it. In order of likelihood:

1. The HTTPS data source was never saved in Google Ads. Have them re-check
   Goals → Conversions → the data source exists.
2. The URL was shortened, edited, or lost its `.csv` ending. Google validates
   the extension off the end of the URL.
3. The password is wrong. It is the part of the URL between the last `/` and
   `.csv` - not the whole URL, not the username.
4. It was saved less than a day ago. Wait.

---

### "Google last collected this feed N days ago."

It was working and stopped. Values are no longer arriving.

1. Is the data source still in their Google Ads account, or was it deleted?
2. Is it paused?
3. Did anyone rotate the feed token without updating Google Ads? Rotating kills
   the old URL immediately.

---

### "Everything is working."

Nothing to fix. The one thing still worth checking, because it is the step
customers skip: **is their campaign on Maximize conversion value or Target
ROAS?** On Maximize conversions or Target CPA, Google reads every value and
bids on none of them, and everything above will look perfectly healthy while
achieving nothing.

---

## Things you can do without a developer

### Rotate a lost feed URL

A customer lost the URL. Do **not** publish a new feed - that resends every
conversion Google already has.

Rotating issues a new URL while keeping their rows, model and history. The old
URL dies immediately, so the new one must go into Google Ads straight away or
collection stops.

### Disconnect a CRM

Removes the stored credentials entirely. The feed keeps serving what it already
has; nothing new is added until a CRM is reconnected or someone publishes by
hand. Use when a customer asks, or before a pilot ends.

### Revoke a feed

Google can no longer collect from it. Rows already in their account stay there.
Permanent - publishing a new feed means reconfiguring Google Ads.

Use when a pilot ends or a URL is believed compromised.

### Add or suspend a customer

`<your-domain>/admin`, signed in with your admin password. Adding shows the new
key once; suspending is a button on the row.

Their key stops working immediately. **Their feed keeps serving** - suspending
is about access to the workspace, not about stopping Google. To stop values
reaching Google, revoke the feed as well.

---

## When to escalate

**→ developer** for any of these:

- The nightly sync is overdue for more than one customer
- "Cannot be read" credentials across every customer at once
- Any page showing a stack trace or a blank screen
- The same failure three nights running after you have followed the steps here
- A customer reporting values in Google that do not match their workspace page
- Anything asking you to run SQL

**Include in the escalation:** the customer's name, the exact message on their
workspace page, the timestamps in the "Recent nightly runs" table, and what you
already tried. Not a screenshot alone - the timestamps matter.

---

## Two things that look like bugs and are not

**"Too late" counts in the nightly runs table.** A lead whose value moved after
Google's 7-day window. Google discards late adjustments, so VBB does not send
one and counts it instead. The outcome improves the next refit. Expected on
every customer with a sales cycle longer than a week.

**Skipped rows.** Leads with no click ID, no email, or no value the model could
price. Reported rather than silently dropped. A high count is worth
investigating with the customer; any count above zero is normal.
