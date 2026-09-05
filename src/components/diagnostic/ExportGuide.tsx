"use client";

import { useState } from "react";
import type { Audience } from "@/lib/analysis/types";

/**
 * How to get an export that the analysis can actually use.
 *
 * The failures worth preventing here are not "where is the export button".
 * They are choices made in the export dialog that produce a file which loads
 * cleanly, analyses cleanly, and is quietly worthless:
 *
 *   - only won deals, so every cohort closes at 100% and no attribute can
 *     separate anything from anything;
 *   - a date range too recent for deals to have resolved;
 *   - the default column set, which in every CRM omits the email and the
 *     click ID - the two things that let a value reach the right ad click.
 *
 * None of those produce an error. The report just comes back flat, and the
 * advertiser concludes the product does not work.
 *
 * Menu paths are given at the level that stays true. CRM interfaces move, and
 * a confidently wrong instruction is worse than a general one - so the shape
 * of the task is described and the exact wording is left to their screen.
 */

const REQUIRED = [
  { label: "Create date", why: "when the lead arrived - every cohort is built from this" },
  { label: "Deal amount", why: "what it was worth" },
  { label: "Stage", why: "pipeline position, and what the early gate is measured on" },
  { label: "Lead source", why: "where it came from" },
];

const STRONGLY_WANTED = [
  { label: "Close date", why: "unlocks cycle length and the early gate" },
  { label: "Outcome, or won/lost flags", why: "otherwise it is inferred from the stage name" },
  { label: "Email", why: "how a value finds the right ad click when there is no click ID" },
  { label: "Click ID (gclid)", why: "exact matching. If your forms don't capture it yet, step 5 has a one-line script" },
];

const NICE_TO_HAVE = [
  { label: "Employee count", why: "" },
  { label: "Industry", why: "" },
  { label: "Contact title", why: "" },
];

/**
 * A consumer has no headcount or job title. What separates one consumer lead
 * from another is what they asked for, and that is usually already a column
 * on the form: the case type, the product, the coverage or package tier, when
 * they want it. Any short category column is picked up and tested on its own;
 * this list is what to make sure survives the export.
 */
const NICE_TO_HAVE_CONSUMER = [
  { label: "What they asked for", why: "case type, product line, service, programme" },
  { label: "Tier or package", why: "coverage level, plan, package" },
  { label: "Timeline or urgency", why: "when they want it" },
  { label: "State or region", why: "pricing and rules differ by place" },
];

const CRMS = [
  {
    name: "HubSpot",
    steps: [
      "Open Deals and switch to the table view.",
      "Filter to a date range of at least 6–12 months, and make sure closed-lost deals are included - the default view often hides them.",
      "Export, then add the properties below rather than accepting the default set.",
      "Contact and company properties (email, job title, employee count, industry) have to be ticked explicitly - they are not on a deal export by default.",
    ],
  },
  {
    name: "Salesforce",
    steps: [
      "Build a report on Opportunities, not a list view export.",
      "Set the date range on Created Date, and clear any filter that limits it to open or won.",
      "Add the Contact and Account columns you want - Email, Title, Employees, Industry.",
      "Export as Details Only, formatted as CSV.",
    ],
  },
  {
    name: "Pipedrive",
    steps: [
      "Deals, then export from the list view.",
      "Choose all deals rather than the current filter, unless the filter is genuinely your whole business.",
      "Include person and organisation fields in the export selection.",
    ],
  },
  {
    name: "Something else",
    steps: [
      "Any CRM that exports deals or opportunities as a CSV works, including a spreadsheet you keep by hand.",
      "Column names do not matter - the next step works out which is which and lets you correct it.",
      "What matters is that the four required fields are present, and that both won and lost deals are in the file.",
    ],
  },
];

function Group({
  title,
  note,
  items,
  tone,
}: {
  title: string;
  note: string;
  items: { label: string; why: string }[];
  tone: "required" | "wanted" | "extra";
}) {
  const dot =
    tone === "required"
      ? "var(--danger)"
      : tone === "wanted"
        ? "var(--primary)"
        : "var(--muted-soft)";

  return (
    <div>
      <p className="flex items-center gap-2 text-[13px] font-bold">
        <span
          aria-hidden
          className="inline-block size-[7px] shrink-0 rounded-full"
          style={{ background: dot }}
        />
        {title}
      </p>
      <p className="hint mt-0.5">{note}</p>
      <ul className="mt-2 grid gap-1.5">
        {items.map((f) => (
          <li key={f.label} className="text-[13px] leading-snug">
            <span className="font-semibold">{f.label}</span>
            {f.why && <span className="text-[var(--muted)]"> - {f.why}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExportGuide({ audience = "b2b" }: { audience?: Audience }) {
  const [crm, setCrm] = useState(CRMS[0].name);
  const consumer = audience === "b2c";
  const active = CRMS.find((c) => c.name === crm) ?? CRMS[0];

  return (
    <details className="card mt-4 overflow-hidden p-0">
      <summary className="cursor-pointer list-none px-5 py-4 transition-colors hover:bg-[var(--surface-sunken)]">
        <span className="flex items-center justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-[14px] font-bold">
              Not sure what to export?
            </span>
            <span className="mt-0.5 block text-[13px] text-[var(--muted)]">
              What the file needs, and the three choices that quietly ruin one.
            </span>
          </span>
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary-deep)]"
          >
            ▾
          </span>
        </span>
      </summary>

      <div className="border-t border-[var(--border)] p-5 sm:p-6">
        {/*
          The warnings come first. A file missing a column gets caught on the
          next screen and can be fixed; a file covering the wrong deals loads
          perfectly and produces a flat model, and nothing downstream can tell
          the difference between that and a business whose leads really are
          all worth the same.
        */}
        <div className="alert alert-warn">
          <p className="text-[13.5px] font-bold text-[var(--warn)]">
            Three things that quietly ruin an export
          </p>
          <ol className="mt-2 grid gap-2 text-[13px] text-[var(--muted-strong)]">
            <li>
              <span className="font-semibold text-[var(--foreground)]">
                Won deals only.
              </span>{" "}
              The model is built from win rates, so it needs the losses too.
              Export only the wins and every group closes at 100%, nothing can
              be told apart, and the report comes back flat.
            </li>
            <li>
              <span className="font-semibold text-[var(--foreground)]">
                Too short a date range.
              </span>{" "}
              Deals need time to resolve. If your sales cycle is two months,
              the last two months are almost all still open. Six to twelve
              months of history is the right ask.
            </li>
            <li>
              <span className="font-semibold text-[var(--foreground)]">
                The default column set.
              </span>{" "}
              Every CRM leaves the email and the click ID off a deal export
              unless you tick them. Those are what let a value reach the right
              ad click.
            </li>
          </ol>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <Group
            tone="required"
            title="Must be in the file"
            note="Without these the analysis cannot run."
            items={REQUIRED}
          />
          <Group
            tone="wanted"
            title="Makes it much better"
            note="Each one is a finding you get or don't."
            items={STRONGLY_WANTED}
          />
          <Group
            tone="extra"
            title={consumer ? "What separates one lead from another" : "Unlocks the ICP check"}
            note={
              consumer
                ? "Usually on the form already. Keep them in the export."
                : "Whether your best customers really are who you think."
            }
            items={consumer ? NICE_TO_HAVE_CONSUMER : NICE_TO_HAVE}
          />
        </div>

        <p className="hint mt-5">
          Column names don&apos;t matter - the next step works out which is
          which and lets you correct anything it gets wrong. Missing a field
          only costs you the findings that depend on it, and the report says
          which those are.
        </p>

        <div className="divider my-6" />

        <p className="label mb-2.5">Where to find it</p>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Your CRM">
          {CRMS.map((c) => (
            <button
              key={c.name}
              type="button"
              role="tab"
              aria-selected={c.name === crm}
              onClick={() => setCrm(c.name)}
              className={
                "rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors " +
                (c.name === crm
                  ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-deep)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:border-[var(--primary)]/40")
              }
            >
              {c.name}
            </button>
          ))}
        </div>

        <ol className="mt-4 grid gap-2.5">
          {active.steps.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="mono mt-[1px] flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[11px] font-bold text-[var(--muted-strong)]">
                {i + 1}
              </span>
              <span className="max-w-[70ch] text-[13px] leading-relaxed text-[var(--muted-strong)]">
                {step}
              </span>
            </li>
          ))}
        </ol>

        <p className="hint mt-4">
          Menus move, so these describe the shape of the job rather than the
          exact wording on your screen.
        </p>
      </div>
    </details>
  );
}
