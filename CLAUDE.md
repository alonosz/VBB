# VBB Engine

Value-based bidding tool for lead-gen advertisers. Computes what leads are
actually worth from CRM data and feeds those values to Google Ads.

Next.js (App Router) · TypeScript · Tailwind · Supabase · deploy target Vercel.

---

# Core principles — binding

These constrain the domain logic. Violating them produces a product that looks
right and bids wrong, so treat them as invariants, not preferences.

## 1. Day-0 values drive bidding

Google's autobidding **ignores value adjustments sent more than 7 days after
the original conversion**. So:

- The value sent at lead creation (Day-0) is what actually influences bidding.
- Late outcomes never adjust a past conversion beyond day 7. They recalibrate
  *tomorrow's* Day-0 cohort table instead — recalibration, not adjustment.
- Never write logic that assumes a close 40 days later can move a bid. It can't.
- Adjustments are emitted only when value change is **>20%** AND the original
  conversion is **<7 days old**. Never emit deltas under 20%.

## 2. Empirical over invented

Every dollar figure shown to a user traces to *their own* historical data —
cohort win rate × median segment deal size. There are **no hardcoded value
guesses anywhere in the product**. If the data can't support a number, say so
instead of producing one.

## 3. Deterministic rules with visible guardrails

No black-box automation and no per-client ML. Every computed figure must be
explainable in one sentence to an advertiser, and the rule that produced it
should be visible in the UI.

## 4. Never invent data

Missing is excluded, always with visible counts and reasons. Stage history is
never trusted blindly — real CRMs are full of retroactive card-dragging that
produces 9-second stage transitions.

## 5. Cap outlier values

Smart Bidding is distorted by outliers. Default cap is **3× median won amount**,
always shown with its rationale and the count of deals it clips. The cap applies
to every emitted value.

---

# Design language — binding

This is the agreed visual identity. Apply it to every screen. Do not introduce
new colors, fonts, or button shapes without asking first.

## Color tokens

Defined in `src/app/globals.css` as CSS custom properties. **Always reference
the token, never a literal hex**, so a brand change is one file.

| Token | Value | Use |
|---|---|---|
| `--primary` | `#2A5CFF` | Primary actions, data marks, active state, accents |
| `--primary-hover` | `#1C46E0` | Hover on primary |
| `--primary-soft` | `#EAF0FF` | Tinted backgrounds, icon chips, focus rings |
| `--navy` | `#0A0E1E` | Emphasis surfaces — the hero/money-shot block, logo mark |
| `--navy-soft` | `#131A33` | Second stop in navy gradients |
| `--background` | `#F6F8FC` | Page ground |
| `--surface` | `#FFFFFF` | Cards, inputs, elevated surfaces |
| `--border` | `#E3E7F0` | Hairlines, card borders |
| `--foreground` | `#0D1226` | Primary ink |
| `--muted` | `#64708A` | Secondary ink |

Neutrals are deliberately **blue-biased**, not pure grey — they must sit with
the brand blue, not fight it.

Status colors are reserved and never reused as decoration or "another series":

| Token | Value | Meaning |
|---|---|---|
| `--accent` | `#10B981` | Good / passing / MEASURED verdict |
| `--warn` | `#F59E0B` | Caution / unreliable data / demo-data badge |
| `--danger` | `#EF4444` | Error / critical / excluded |

## Typography

- **Inter** — all UI and prose. Loaded via `next/font/google` as `--font-inter`.
- **JetBrains Mono** — *every figure*: metrics, table numbers, percentages,
  dates, IDs. Always with `font-variant-numeric: tabular-nums` so columns align.
  This mono-for-data pairing is what gives the product its instrument feel;
  it is part of the identity, not an accident.
- Headings: weight 700–800, `letter-spacing: -.02em`, `text-wrap: balance`.
- Uppercase labels: 10.5–11.5px, weight 700, `letter-spacing: .07em`.
- Body copy stays near 65–72 characters wide.

## Components

- **Buttons are pills** — `border-radius: 999px`. Primary is a
  `135deg` gradient from `--primary` to a deeper blue, with a soft colored
  shadow and a 1px lift on hover.
- **Arrow-in-circle** on primary CTAs — the `<ArrowIcon />` component
  (`src/components/ArrowIcon.tsx`). Carried over from valuebasedbidding.com.
- **Cards**: `--surface`, 1px `--border`, `border-radius: 1.1rem`, soft shadow.
  Add `.card-hover` for the 3px lift + blue-tinted border on hover.
- **Checkmark lists** for feature/benefit copy, matching the marketing site.
- Motion: ~150–260ms, `cubic-bezier(0.16, 1, 0.3, 1)`. Page transitions use
  `.animate-page-in`. Respect `prefers-reduced-motion`.
- **Skeleton loaders, never spinners** — `.skeleton` shimmer class.

## Theme

The **app is light-theme only** — do not add a dark mode to product screens.

Exception: standalone shareable artifacts/reports published outside the app
must support both themes (the viewer's theme is not ours to control).

## Charts

- Single-series magnitude → one hue, brand blue. No legend (the title names it).
- Bars: 4px rounded data-end anchored to the baseline, 2px gap between fills.
- Grid and axes stay recessive; text wears ink tokens, never the series color.
- Never a dual-axis chart.
- The "blindness cost" comparison uses a **desaturated slate for the flat
  state** (what Google sees) against brand blue for real value. The grey
  reading as grey is the message — it is intentional, not a palette bug.
- Validate any new categorical palette before shipping it.

## Voice

- Plain language, active voice. Name things the way an advertiser would.
- **Never invent data.** Missing is excluded, and excluded counts and reasons
  are always shown. Trust warnings ("backfilled — unreliable") are surfaced,
  not hidden.
- Label illustrative or demo figures clearly. Never imply a forecast or a
  performance guarantee.
- Errors say what went wrong and how to fix it. No stack traces, no apologies.

---

# Scope guardrails

Not in scope unless explicitly requested: user accounts/auth, billing,
LLM API calls, live Google Ads / Meta API calls, CRM OAuth beyond a named
phase, multi-tenancy (though schemas carry `client_id` for later).
