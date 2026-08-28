# Onboarding a customer

What to do, in order, to take one advertiser from "signed up" to "Google is
bidding on their real lead values."

Budget about 40 minutes with them, most of it waiting while they find things in
their own accounts. The parts that need them are marked **they do this**.

---

## Before you start, check they qualify

VBB computes what leads are worth from a customer's own closed deals. If the
history is too thin the honest answer is "not yet", and the product will say so
rather than invent a model. Better to find that out now.

| | Needed | Why |
|---|---|---|
| Closed deals | **200+** won or lost in the export | Each rule needs 25 deals behind it before it is priced |
| Outcome recorded | Won/lost, not just "open" | An open deal cannot teach anything yet |
| Deal amount | On won deals at least | This is where value comes from |
| Ad click IDs **or** emails | On most leads | How Google matches a lead to a click |
| Google Ads | Running, with conversions imported | Nothing to bid on otherwise |

Firmographics — company size, industry, job title — are what make the model
*sharp*. Without them the model still works but has fewer rules and less
spread. That is worth saying out loud before they expect miracles.

**If the report comes back saying the data cannot support a model, believe it.**
That is the product working correctly. Ask what else their CRM holds, or come
back when they have more history.

---

## 1. Create their workspace

Go to `<your-domain>/admin`, sign in with your admin password, type their name
and click **Create**.

Copy the `vbb_ws_…` key it shows. It appears once and cannot be shown again —
only a hash is stored.

(There is a terminal equivalent, `npm run workspace -- create "Name"`, if you
prefer it.)

Send it to them with a line like:

> This is your workspace key. It opens your status page at
> `<your-domain>/workspace` — keep it somewhere safe. It is not the feed link
> that goes into Google Ads; that comes later and is a different thing.

---

## 2. They open their workspace page

**They do this.** `<your-domain>/workspace`, paste the key.

It will say no feed has been published yet. That is correct — it also confirms
their key works before you spend time on anything else.

---

## 3. They export their CRM deals

**They do this.** Any CSV of deals or opportunities. From HubSpot:
Sales → Deals → the "…" menu → Export.

Ask for **all** deals with a close date, not just recent ones — the model is
fitted on history.

They should not filter, tidy, or rename columns. Bad rows are reported rather
than silently dropped, and the product reads column names it recognises.

---

## 4. Run the diagnostic together

`<your-domain>/diagnostic`. Five steps:

1. **Your business** — a paragraph on who their good customers are, plus sales
   cycle and typical company size. The free text is checked against the data,
   never fed into the model.
2. **Upload** — their CSV. Stays in their browser; no rows reach the server.
3. **Map columns** — the product guesses; they confirm. Watch for the required
   ones marked *Not found* — those block the analysis.
4. **Your model** — the report. **This is the conversation.** Every multiplier
   is editable and every number traces to a row count. If they disagree with
   one, change it there and watch the calibration adjust.
5. **Connect** — publish the feed.

If a refresh happens mid-way, their work is kept. A very large export may need
re-selecting; the mapping survives regardless.

---

## 5. Publish the feed and set up Google Ads

At step 5 they click **Generate my feed URL**. Copy it — it is shown once.

Then in Google Ads, in this order:

**a. Create the conversion action**
Goals → Conversions → New conversion action → Import → CRM, files or other
data sources → Track conversions from clicks.

- Name it **exactly** `VBB Lead Value`. Google matches rows by this name; a
  mismatch throws every row away and looks like nothing happening.
- Value: **Use different values for each conversion**, default blank.
- Count: One. Click-through window: 90 days, or longer if their cycle is long.
- Include in Conversions: **Yes**.

**b. Point Google at the feed**
New conversion action again → tick **Conversions offline** → Add an offline
data source → **HTTPS**.

- URL: the feed URL, whole, ending `.csv`
- Username: anything
- Password: the part of the URL between the last `/` and `.csv`
- Map fields → Save

**c. The step everyone skips**
Their campaign has to run **Maximize conversion value** or **Target ROAS**.
On Maximize conversions or Target CPA, Google reads every value and bids on
none of them. Leave Target ROAS empty at first — set a target once there is
history to base it on.

---

## 6. Connect their CRM

**They do this**, in their own HubSpot: Settings → Integrations → Private apps
→ Create a private app, with exactly these three scopes:

```
crm.objects.deals.read
crm.objects.contacts.read
crm.objects.companies.read
```

Then on `<your-domain>/feed-status`: paste the feed URL, **Check**, expand
"Or paste a private app token instead", paste the token, **Connect**.

It verifies all three scopes before storing anything, so a missing one is an
error they see immediately rather than a silent failure at 6am.

Skipping this is allowed. Without it they re-run the diagnostic by hand
whenever they want new leads sent.

---

## 7. Confirm it worked

Two checks, a day apart.

**Same day** — their workspace page should show the feed active, a model with a
fitted date, and HubSpot connected. It will say Google has not collected yet;
that is normal.

**Next day** — the workspace page should show:

- Google last collected, with a timestamp
- One nightly run, status `ok`
- **Everything is working** at the top

If it does not, `OPERATOR_RUNBOOK.md` has every message and what to do.

---

## What to tell them to expect

- **Nothing changes immediately.** Google re-learns when a bid strategy
  changes; give it a couple of weeks before judging.
- **Their model does not drift.** It prices leads the same way every day until
  someone refits it deliberately. Re-running the diagnostic in a month shows
  what refitting *would* change before it changes anything.
- **Late outcomes do not move past bids.** A deal closing 40 days later cannot
  change what was bid on it — Google ignores adjustments after 7 days. It
  improves the *next* refit instead. The workspace page counts these as
  "Too late", which is expected, not a fault.

Do not promise a number. Nothing in this product forecasts, and neither
should you.
