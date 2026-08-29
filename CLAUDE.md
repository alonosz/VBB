# VBB Engine

Value-based bidding tool for lead-gen advertisers. Computes what leads are
actually worth from CRM data and feeds those values to Google Ads.

Next.js (App Router) · TypeScript · Tailwind · Supabase · deploy target Vercel.

---

# Core principles: binding

These constrain the domain logic. Violating them produces a product that looks
right and bids wrong, so treat them as invariants, not preferences.

## 1. Day-0 values drive bidding

Google's autobidding **ignores value adjustments sent more than 7 days after
the original conversion**. So:

- The value sent at lead creation (Day-0) is what actually influences bidding.
- Late outcomes never adjust a past conversion beyond day 7. They recalibrate
  *tomorrow's* Day-0 cohort table instead. Recalibration, not adjustment.
- Never write logic that assumes a close 40 days later can move a bid. It can't.
- Adjustments are emitted only when value change is **>20%** AND the original
  conversion is **<7 days old**. Never emit deltas under 20%.

## 2. Empirical over invented

Every dollar figure shown to a user traces to *their own* historical data:
cohort win rate × median segment deal size. There are **no hardcoded value
guesses anywhere in the product**. If the data can't support a number, say so
instead of producing one.

## 3. Deterministic rules with visible guardrails

No black-box automation and no per-client ML. Every computed figure must be
explainable in one sentence to an advertiser, and the rule that produced it
should be visible in the UI.

**Every multiplier is editable.** A marketer who cannot argue with a number does
not trust it. Edits recalibrate the whole model (`withOverrides()`) so the
portfolio average still matches observed E[V], the new calibration constant is
shown rather than hidden, and one click restores what was fitted. Saving a model
freezes what is on screen, edits included.

## 4. Never invent data

Missing is excluded, always with visible counts and reasons. Stage history is
never trusted blindly, because real CRMs are full of retroactive
card-dragging that produces 9-second stage transitions.

## 5. The assistant proposes, the engine computes

One LLM call runs, at upload, in `src/app/api/intake/route.ts`. Its job is to
read the user's free-text description against a *description of each column*
and propose (a) which column is which and (b) which claims the user made about
their buyers. That is the whole remit.

- It **never** returns a value, multiplier, score, weight or close rate. Every
  figure in the product comes from the deterministic engine reading the user's
  own rows. A model-supplied number would be an invented figure presented as
  the user's own data, the exact failure principle 2 exists to prevent.
- Its output is untrusted input. Everything passes through
  `sanitizeProposal()`, which drops columns that aren't in the file, field keys
  we don't have, duplicate claims and impossible numbers.
- Candidate factors are **hypotheses to test**, never rules to apply. They clear
  the same sample-size and lift thresholds as every other factor, and they are
  reported whether they survive or not. A refuted claim is the most valuable
  line in the report.
- **No raw rows leave the browser.** `profileColumns()` sends header names,
  value kinds, fill rates, cardinality, digit counts, and (for short
  low-cardinality category columns only) a few labels. Never emails, names,
  phone numbers, addresses, click IDs, deal amounts (not even as a range), or
  free text. Any new field added to `ColumnProfile` must be checked against
  this list.
- The call never blocks. The flow waits `INTAKE_GRACE_MS` (3s) at most, then
  moves on; the request keeps going and merges into the mapping when it lands,
  respecting any column the user has already set by hand. Every failure path
  returns a reason and the flow continues on the header heuristics alone.
- Default model is a fast one (`claude-haiku-4-5-20251001`). The task is
  comprehension, not depth, and latency is the constraint that matters.

## 6. Cap outlier values

Smart Bidding is distorted by outliers. Default cap is **3× median won amount**,
always shown with its rationale and the count of deals it clips. The cap applies
to every emitted value. Every clipped deal is listed by name in the audit table
The cap is the one place we deliberately report a number lower than the truth,
so it has to be inspectable.

## 7. A value may only sharpen inside the window

The day-0 stack prices what is knowable on arrival. One thing can change it
afterwards: an **early gate**, a pipeline stage that reliably fires inside
Google's 7 days (`gateValue()`). Reaching it in time emits an adjustment;
reaching it later emits nothing and is counted as `gateTooLate`, because Google
discards a late adjustment and reporting one would claim a bid we did not move.

- The gate is measured against **the whole resolved population**, never against
  leads that never reached it. Those barely close, so that denominator produces
  multipliers in the dozens off arithmetic rather than evidence.
- Bounded by `MAX_GATE_MULTIPLIER` (4) for the same reason the day-0 stack is
  bounded: the gate overlaps the attributes that got the lead there, so
  multiplying counts one signal twice. A clipped figure is always shown next to
  the measured one.
- A gate that fires too slowly is refused outright and said so, in the
  advertiser's words. A slow pipeline is not a fault to hide.

## 8. The model is an artifact, not a per-upload recomputation

Refitting on every upload silently reprices yesterday's leads: a 30-day window
one morning and a 90-day window the next produce different multipliers, and the
same lead is worth two different amounts for no reason the advertiser can see.
Google then learns from a moving target.

- A model is **fitted, saved, and applied frozen** (`src/lib/model/savedModel.ts`).
  The downloaded JSON is the artifact; the browser copy is convenience.
- A saved model is untrusted input on the way back in. `loadSavedModel()`
  validates it and refuses a broken one rather than pricing leads at zero.
- Staleness is **measured, never assumed**. `compareToFresh()` reports what
  refitting would change; `DRIFT_THRESHOLD` (20%) or any factor entering or
  leaving the model calls for a refit. Nothing refits itself.
- This is principle 1's recalibration made concrete: the saved model prices
  today's Day-0 cohort, and a refit changes tomorrow's. Never a past
  conversion.
- A saved rule whose column is not mapped this time is inert. Say so
  (`checkApplicability()`); never let it fail silently. A model fitted in one
  currency never prices a file reported in another.

---

# Design language: binding

This is the agreed visual identity. Apply it to every screen. Do not introduce
new colors, fonts, or button shapes without asking first.

## Color tokens

Defined in `src/app/globals.css` as CSS custom properties. **Always reference
the token, never a literal hex**, so a brand change is one file.

| Token | Value | Use |
|---|---|---|
| `--primary` | `#2A47F5` | Primary actions, data marks, active state, accents |
| `--primary-hover` | `#1E35D6` | Hover on primary |
| `--primary-soft` | `#EBEEFE` | Tinted backgrounds, icon chips, focus rings |
| `--navy` | `#0A0E1E` | Emphasis surfaces: the hero/money-shot block, logo mark |
| `--navy-soft` | `#131A33` | Second stop in navy gradients |
| `--background` | `#F6F8FC` | Page ground |
| `--surface` | `#FFFFFF` | Cards, inputs, elevated surfaces |
| `--border` | `#E3E7F0` | Hairlines, card borders |
| `--foreground` | `#0D1226` | Primary ink |
| `--muted` | `#64708A` | Secondary ink |

Neutrals are deliberately **blue-biased**, not pure grey. They must sit with
the brand blue, not fight it.

Status colors are reserved and never reused as decoration or "another series":

| Token | Value | Meaning |
|---|---|---|
| `--accent` | `#10B981` | Good / passing / MEASURED verdict |
| `--warn` | `#F59E0B` | Caution / unreliable data / demo-data badge |
| `--danger` | `#EF4444` | Error / critical / excluded |

## Typography

- **Inter** for all UI and prose. Loaded via `next/font/google` as `--font-inter`.
- **JetBrains Mono** for *every figure*: metrics, table numbers, percentages,
  dates, IDs. Always with `font-variant-numeric: tabular-nums` so columns align.
  This mono-for-data pairing is what gives the product its instrument feel;
  it is part of the identity, not an accident.
- Headings: weight 700–800, `letter-spacing: -.02em`, `text-wrap: balance`.
- Uppercase labels: 10.5–11.5px, weight 700, `letter-spacing: .07em`.
- Body copy stays near 65–72 characters wide.

## Components

- **Buttons are pills**, `border-radius: 999px`. Primary is a
  `135deg` gradient from `--primary` to a deeper blue, with a soft colored
  shadow and a 1px lift on hover.
- **Arrow-in-circle** on primary CTAs, the `<ArrowIcon />` component
  (`src/components/ArrowIcon.tsx`). Carried over from valuebasedbidding.com.
- **Cards**: `--surface`, 1px `--border`, `border-radius: 1.1rem`, soft shadow.
  Add `.card-hover` for the 3px lift + blue-tinted border on hover.
- **Checkmark lists** for feature/benefit copy, matching the marketing site.
- Motion: ~150–260ms, `cubic-bezier(0.16, 1, 0.3, 1)`. Page transitions use
  `.animate-page-in`. Respect `prefers-reduced-motion`.
- **Skeleton loaders, never spinners**, via the `.skeleton` shimmer class.

## Theme

The **app is light-theme only**. Do not add a dark mode to product screens.

Exception: standalone shareable artifacts/reports published outside the app
must support both themes (the viewer's theme is not ours to control).

## Charts

- Single-series magnitude → one hue, brand blue. No legend (the title names it).
- Bars: 4px rounded data-end anchored to the baseline, 2px gap between fills.
- Grid and axes stay recessive; text wears ink tokens, never the series color.
- Never a dual-axis chart.
- The "blindness cost" comparison uses a **desaturated slate for the flat
  state** (what Google sees) against brand blue for real value. The grey
  reading as grey is the message. It is intentional, not a palette bug.
- Validate any new categorical palette before shipping it.

## Voice

- Plain language, active voice. Name things the way an advertiser would.
- **Never invent data.** Missing is excluded, and excluded counts and reasons
  are always shown. Trust warnings ("backfilled, unreliable") are surfaced,
  not hidden.
- Label illustrative or demo figures clearly. Never imply a forecast or a
  performance guarantee.
- Errors say what went wrong and how to fix it. No stack traces, no apologies.

### No em dashes

**Never use an em dash on this project.** Not in UI copy, not in code comments,
not in docs, not in commit messages, not in chat.

**Use a plain hyphen instead**, spaced: `like this - here`. That is the house
substitute and it applies everywhere, including where an em dash was doing the
work of a comma, a colon, brackets, or a full stop.

Rewriting the sentence is still welcome where it reads better, and often it
does:

| Doing the job of | Reads better as |
|---|---|
| A pause or aside | a comma |
| Introducing a consequence or a list | a colon |
| A parenthetical | brackets |
| Joining two thoughts | a full stop, and two sentences |

The rule is about the long dash only. A hyphen where a hyphen belongs
(well-formed, day-0) was never in question.

---

# CSV upload is permanent

The HubSpot connection is the better route and will carry most customers. It
does not replace the file upload, and the upload is not a fallback waiting to
be deprecated. It is a first-class way in, kept for good.

Reasons it stays:

- Most CRMs are not HubSpot. Salesforce, Pipedrive, Close, and a spreadsheet
  somebody maintains by hand all reach the same engine through a file.
- A connection needs permission from whoever owns the CRM. A file needs
  nobody's approval, which is often the difference between an evaluation
  happening this week or not at all.
- It is the only route that touches no credential and no third-party API, so
  it keeps working when HubSpot changes something, and it is what the
  no-account-needed promise on the landing page rests on.

Anything built for the connection has to leave the file route working, and
both sources land on the same `MappedDeal[]` so nothing downstream knows or
cares which one was used.

---

# Scope guardrails

Not in scope unless explicitly requested: user accounts/auth, billing,
live Google Ads / Meta API calls, CRM OAuth beyond a named phase,
multi-tenancy (though schemas carry `client_id` for later).

**Server-side storage**: the feed tables only (`supabase/README.md`). Hashed
identifiers, timestamps, values, currency, model id. Never CRM records, names,
deal amounts or free text. The CHECK constraints enforce this rather than
trusting anyone to remember it; re-run `./scripts/db-test.sh` after any
migration that touches them.

**The feed emits nothing the platform will ignore.** `buildFeedRows()` sends a
new conversion for a new lead, and an adjustment only when the value moved more
than 20% *and* the conversion is under 7 days old. A later change is counted as
`recalibrationOnly` and reported as what it is: input for the next refit,
which prices tomorrow's leads. Emitting a late adjustment would tell the advertiser we
moved a bid we did not move. The server cannot price anything: rows are built in
the browser from the model on screen and posted finished.

**LLM calls**: exactly one, the assisted intake described in principle 5. It is
bounded to column mapping and claim extraction. Do not add a second LLM call,
and do not widen this one to compute, rank, or value anything. That boundary
is the product's credibility. Configuration is `ANTHROPIC_API_KEY` and an
optional `VBB_INTAKE_MODEL`; with no key set the product runs unchanged on
header heuristics.
