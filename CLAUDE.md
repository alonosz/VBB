# VBB Engine

Value-based bidding tool for lead-gen advertisers. Computes what leads are
actually worth from CRM data and feeds those values to Google Ads.

Next.js (App Router) · TypeScript · Tailwind · deploy target Vercel.

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
