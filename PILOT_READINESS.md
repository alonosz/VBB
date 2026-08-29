# Pilot readiness

Where VBB stands against the launch-readiness audit, and what a production
deployment needs. Everything below was run, not estimated.

Commit at time of writing: `9c2e742`

---

## Verdict

**Ready for five paid pilots**, with the limitations in `SECURITY_AND_DATA.md`
understood and accepted.

Every P0 from the audit is closed. The remaining P1s make support slightly more
manual than it could be; none of them costs a customer money or exposes data.

The one thing this cannot tell you: **no real customer's CRM export has been
through the engine yet.** Everything here is verified against synthetic data
that I generated, which means it proves the machinery works and does not prove
the thresholds are right for a real advertiser. The first real file is the next
thing that matters, and it may find that a typical SMB's history is too thin to
support a model - in which case the product will say so, correctly, and that is
a commercial finding rather than a bug.

---

## P0 items - all complete

| # | Item | How it was closed |
|---|---|---|
| 1 | No customer identity | `workspaces` table; `client_id` now a required foreign key on every feed |
| 2 | Feed URL could hijack a CRM connection | Feed token reads a CSV and nothing else; state changes need the workspace key |
| 3 | All flow state lost on refresh | Session-scoped snapshot; mapping survives even when the export is too large to keep |
| 4 | Lost feed URL unrecoverable | Rotate keeps rows, model and history; old URL dies immediately |
| 5 | `/api/intake` unauthenticated | Requires a workspace key; refusal degrades to header matching |
| 6 | `/api/feeds` unauthenticated | Requires a workspace key |
| 7 | Cron failure invisible | `sync_runs` records every run; a gap is read as "not run for N days" |
| 8 | CRM sync status never shown | The workspace page, which reports all of it |
| 9 | Migrations manual and undocumented | `supabase/setup.sql` plus `PILOT_DEPLOYMENT.md` |

### Isolation, specifically

A valid workspace key pointed at another customer's feed gets the same answer
as one pointed at a feed that does not exist. Verified by sabotage - removing
the ownership check, ignoring suspension, and distinguishing "someone else's"
from "not found" each cause tests to fail.

---

## P1 items - remaining, none blocking

| # | Item | Why it can wait |
|---|---|---|
| 10 | No operator list of all customers | `npm run workspace -- list` covers it at five |
| 11 | Model drift not shown on the workspace page | Currency mismatch and applicability are; drift needs a re-upload to see |
| 13 | - | Closed: model storage is now workspace-scoped |
| 14 | `/api/snippet/verify` not rate-limited | SSRF-fenced; no cost per call |
| - | No per-customer volume limits | Intake needs a key, so it is not open to the internet |
| - | No audit log | Who rotated what is not recorded |

---

## Test, lint and build results

```
Unit and integration    548 passed, 28 files
Types                   clean
Lint                    0 errors, 6 warnings
                        (all pre-existing, public/vbb.js ES5 catch blocks)
Production build        compiles, 23 routes
Schema assertions       39 passed, against a real Postgres
```

Reproduce with:

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build && ./scripts/db-test.sh
```

### On how these tests were written

Several were checked by deliberately breaking the code to confirm the test
fails - inflating values, dropping the gate, removing the ownership check,
skipping the run record, refitting during a sync. Three tests passed their
first sabotage and were rewritten. The most useful example: the golden path
originally asserted a lead's value was "greater than zero", which would have
stayed green while the nightly job silently repriced every lead. It now
recomputes the exact figure the frozen model predicts.

---

## Production environment variables

Required:

```
NEXT_PUBLIC_SUPABASE_URL       Supabase → Settings → API → Project URL
SUPABASE_SERVICE_ROLE_KEY      Supabase → Settings → API → secret key (sb_secret_…)
VBB_TOKEN_KEY                  a generated password, 24+ chars - encrypts CRM credentials
CRON_SECRET                    a generated password, 24+ chars - gates the nightly job
VBB_ADMIN_KEY                  the operator's own password, 16+ chars - opens /admin
```

Optional:

```
ANTHROPIC_API_KEY              assisted column mapping; runs on header matching without it
VBB_INTAKE_MODEL               overrides the model used for that
VBB_PUBLIC_ORIGIN              only for a custom domain
HUBSPOT_CLIENT_ID              only for OAuth; private app tokens need neither
HUBSPOT_CLIENT_SECRET
```

For the two you make yourself, use a password generator set to 40 characters.
Anything 24 characters or longer is accepted. A developer can instead run:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Database migration steps

**Run before deploying the code.** `client_id` becomes required, and only the
new code supplies it.

1. Supabase → SQL Editor → New query
2. Paste all of `supabase/setup.sql`
3. Run - expect `Success. No rows returned`
4. Table Editor should show seven tables: `workspaces`, `feeds`, `feed_rows`,
   `feed_models`, `feed_fetches`, `crm_connections`, `sync_runs`

Safe to re-run. Individual migrations are in `supabase/migrations/` in filename
order.

> Any feed created before this migration is deleted by it, having no owner to
> infer. An orphan row still serving a CSV to Google is worse than no row.

---

## Dry run

`npm run dry-run` - the whole journey against synthetic data, no network, no
database. Output as of `9c2e742`:

```
VBB Engine - dry run against synthetic data
Started 2026-08-28T00:41:22.129Z

────────────────────────────────────────────────────────────────
1. Operator creates a workspace
────────────────────────────────────────────────────────────────
   workspace                          Northridge Fabrication
   key prefix                         vbb_ws_D4wN…
   key stored as                      SHA-256 hash only

────────────────────────────────────────────────────────────────
2. Customer's export is analysed
────────────────────────────────────────────────────────────────
   deals in export                    501
   verdict                            MEASURED
   base value                         $1993.73
   rules fitted                       domainType, employeeBand, industry, seniority
   rules dropped                      0
   early gate                         Qualified ×1.709

────────────────────────────────────────────────────────────────
3. Model approved and frozen
────────────────────────────────────────────────────────────────
   model id                           model-dryrun
   fitted on                          343 resolved deals
   size                               2153 bytes
   contains an '@'                    no

────────────────────────────────────────────────────────────────
4. Feed published
────────────────────────────────────────────────────────────────
   status                             200
   identifier                         email
   rows published                     464
   skipped                            37 (no email address to match against)
   model stored                       true
   URL ends in .csv                   yes

────────────────────────────────────────────────────────────────
5. Isolation checked
────────────────────────────────────────────────────────────────
   another workspace reaches this feed no
   answer given                       404 No feed found in this workspace.

────────────────────────────────────────────────────────────────
6. CRM connected
────────────────────────────────────────────────────────────────
   stored                             yes
   plaintext token in row             no

────────────────────────────────────────────────────────────────
7. Nightly sync runs unattended
────────────────────────────────────────────────────────────────
   result                             ok
   deals pulled                       1
   rows before / after                464 / 465
   run recorded                       1 (status ok)
   priced by                          model-dryrun

────────────────────────────────────────────────────────────────
8. Google collects the file
────────────────────────────────────────────────────────────────
   status                             200
   content type                       text/csv; charset=utf-8
   rows in file                       465
   contains an email address          no
   contains a job title               no

────────────────────────────────────────────────────────────────
9. Workspace page reports
────────────────────────────────────────────────────────────────
   feed                               active, 465 rows
   model                              model-dryrun, 4 rules
   CRM                                connected
   last Google fetch                  recorded
   run health                         healthy
   working                            true
   top message                        Everything is working.

────────────────────────────────────────────────────────────────
DRY RUN PASSED - the journey completes end to end.
────────────────────────────────────────────────────────────────
```

---

## What to do first

1. **Deploy** - `PILOT_DEPLOYMENT.md`, in order. Migration before code.
2. **Onboard one customer** - `CUSTOMER_ONBOARDING.md`. Ideally one whose data
   you already know, so a surprising model is recognisable as surprising.
3. **Check the next morning** - their workspace page should show Google
   collecting and one nightly run.
4. **Then read `OPERATOR_RUNBOOK.md`** properly, before something breaks rather
   than after.

The honest ordering: get one real CRM export through the engine before
onboarding a second customer. It is the only remaining unknown, and no further
building will resolve it.
