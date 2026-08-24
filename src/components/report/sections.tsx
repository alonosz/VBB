"use client";

import type {
  CycleLengthStats,
  DomainValueDisparity,
  EarlyGateResult,
  MatchRateReadiness,
  ShadowRoasRow,
  SourceEconomics,
  StageTrustResult,
  ValueSpread,
  Verdict,
} from "@/lib/analysis/types";
import type { Comparison } from "@/lib/analysis/statedVsActual";

export function money(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function SectionHead({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {children}
      </div>
      {note && <span className="text-[12.5px] text-[var(--muted)]">{note}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Shadow ROAS — the opening screen
// ---------------------------------------------------------------------------

export function ShadowRoasSection({
  rows,
  currency,
  blindnessRatio,
}: {
  rows: ShadowRoasRow[];
  currency: string;
  blindnessRatio: number | null;
}) {
  const maxPerLead = Math.max(...rows.map((r) => r.actualValuePerLead), 1);
  const totalLeads = rows.reduce((s, r) => s + r.leads, 0);
  const totalValue = rows.reduce((s, r) => s + r.actualValue, 0);

  return (
    <section className="gradient-navy overflow-hidden rounded-2xl p-6 text-white sm:p-7">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[.1em] text-[#8593ac]">
            What Google sees vs. what happened
          </p>
          <h2 className="max-w-[30ch] text-[clamp(20px,2.6vw,26px)] font-bold leading-tight tracking-tight text-balance">
            Every one of these leads counts the same to Google today.
          </h2>
        </div>
        {blindnessRatio !== null && (
          <div className="text-right">
            <span className="mono block text-[clamp(38px,6vw,56px)] font-bold leading-none tracking-tighter">
              {blindnessRatio}×
            </span>
            <span className="mt-1.5 block text-[11px] font-semibold uppercase tracking-[.09em] text-[#8593ac]">
              Best won deal vs. smallest
            </span>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-left text-[13.5px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-[.07em] text-[#8593ac]">
              <th className="pb-2.5 pr-3 font-bold">Source</th>
              <th className="pb-2.5 pr-3 text-right font-bold">Leads</th>
              <th className="pb-2.5 pr-3 text-right font-bold">Google sees</th>
              <th className="pb-2.5 pr-3 text-right font-bold">Won</th>
              <th className="pb-2.5 pr-3 text-right font-bold">Actual value</th>
              <th className="pb-2.5 font-bold">Real value per lead</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source} className="border-t border-white/10">
                <td className="py-2.5 pr-3 font-semibold">{r.source}</td>
                <td className="mono py-2.5 pr-3 text-right text-[#a7b3c9]">{r.leads}</td>
                {/* Identical for every row — that is the entire point. */}
                <td className="mono py-2.5 pr-3 text-right text-[#6b7a91]">
                  {r.leads} × 1
                </td>
                <td className="mono py-2.5 pr-3 text-right text-[#a7b3c9]">{r.wonDeals}</td>
                <td className="mono py-2.5 pr-3 text-right font-semibold">
                  {money(r.actualValue, currency)}
                </td>
                <td className="py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="h-1.5 w-full max-w-[110px] overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-[#5C86FF]"
                        style={{ width: `${(r.actualValuePerLead / maxPerLead) * 100}%` }}
                      />
                    </div>
                    <span className="mono shrink-0 text-[12.5px] font-semibold">
                      {money(r.actualValuePerLead, currency)}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-white/20">
              <td className="py-2.5 pr-3 text-[11px] font-bold uppercase tracking-wider text-[#8593ac]">
                Total
              </td>
              <td className="mono py-2.5 pr-3 text-right font-semibold">{totalLeads}</td>
              <td className="mono py-2.5 pr-3 text-right text-[#6b7a91]">all equal</td>
              <td />
              <td className="mono py-2.5 pr-3 text-right font-bold">
                {money(totalValue, currency)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. Stated vs actual
// ---------------------------------------------------------------------------

export function StatedVsActual({
  businessContext,
  comparisons,
}: {
  businessContext: string;
  comparisons: Comparison[];
}) {
  if (!businessContext.trim() || comparisons.length === 0) return null;

  const tone: Record<Comparison["verdict"], { badge: string; label: string; rail: string }> = {
    gap: { badge: "bg-amber-100 text-amber-800", label: "Big gap", rail: "bg-[var(--warn)]" },
    confirmed: { badge: "bg-emerald-100 text-emerald-800", label: "Confirmed", rail: "bg-[var(--accent)]" },
    partial: { badge: "bg-amber-100 text-amber-800", label: "Partial", rail: "bg-[var(--warn)]" },
  };

  return (
    <section>
      <div className="grid overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--border)] gap-px md:grid-cols-[.82fr_1.18fr]">
        <div className="bg-white p-5">
          <p className="label mb-3">What you told us</p>
          <blockquote className="border-l-2 border-[var(--primary)] pl-3.5 text-[14.5px] italic leading-relaxed text-[var(--muted)]">
            {businessContext}
          </blockquote>
        </div>
        <div className="bg-white p-5">
          <p className="label mb-3">What your data shows</p>
          <div className="grid gap-3.5">
            {comparisons.map((c) => (
              <div key={c.label} className="border-l-2 pl-3" style={{ borderColor: "transparent" }}>
                <div className={`-ml-3 border-l-2 pl-3 ${tone[c.verdict].rail.replace("bg-", "border-")}`}>
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-bold">{c.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone[c.verdict].badge}`}
                    >
                      {tone[c.verdict].label}
                    </span>
                  </div>
                  <div className="mb-1 flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] text-[var(--muted)]">
                      you said <b className="font-semibold text-[var(--foreground)]">{c.stated}</b>
                    </span>
                    <span className="text-[12px] text-[var(--muted)]">→</span>
                    <span className="mono text-[16px] font-bold tracking-tight">{c.actual}</span>
                  </div>
                  <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-[var(--muted)]">
                    {c.note}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2.5 max-w-[78ch] px-0.5 text-[12px] text-[var(--muted)]">
        Matched by keyword against your description. It&apos;s a rough read of what you
        wrote, not a classifier, and it never overrides what&apos;s in your data.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. Verdict
// ---------------------------------------------------------------------------

export function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const style =
    verdict.mode === "MEASURED"
      ? "border-emerald-300/60 bg-emerald-50/70"
      : verdict.mode === "PREDICTED"
      ? "border-[var(--primary)]/30 bg-[var(--primary-soft)]"
      : "border-amber-300/60 bg-amber-50/70";

  const badge =
    verdict.mode === "MEASURED"
      ? "bg-[var(--accent)]"
      : verdict.mode === "PREDICTED"
      ? "bg-[var(--primary)]"
      : "bg-[var(--warn)]";

  const modes = [
    { key: "MEASURED", label: "Measured — send real values" },
    { key: "PREDICTED", label: "Predicted — cohort estimates" },
    { key: "NOT_YET", label: "Not yet — fix data first" },
  ];

  return (
    <section className={`rounded-2xl border p-5 sm:p-6 ${style}`}>
      <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
        <span
          className={`mono inline-block self-start rounded-lg px-3.5 py-2 text-[12px] font-bold tracking-[.07em] text-white ${badge}`}
        >
          {verdict.mode.replace("_", " ")}
        </span>
        <div>
          <h2 className="text-[17px] font-bold tracking-tight">{verdict.headline}</h2>
          <p className="mt-1 max-w-[72ch] text-[14.5px] text-[var(--muted)]">
            {verdict.reasoning}
          </p>

          {verdict.blockers.length > 0 && (
            <ul className="mt-3.5 grid gap-2">
              {verdict.blockers.map((b, i) => (
                <li
                  key={i}
                  className="flex gap-2.5 rounded-lg bg-white/70 px-3.5 py-2.5 text-[13.5px] text-[var(--muted)]"
                >
                  <span className="font-bold text-[var(--warn)]">!</span>
                  {b}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {modes.map((m) => (
              <span
                key={m.key}
                className={
                  "rounded-full border px-2.5 py-1 text-[11px] font-semibold " +
                  (m.key === verdict.mode
                    ? "border-current bg-white text-[var(--foreground)]"
                    : "border-[var(--border)] bg-white/50 text-[#a8b0c2]")
                }
              >
                {m.key === verdict.mode ? "✓ " : ""}
                {m.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. Tracking gap
// ---------------------------------------------------------------------------

export function TrackingGapSection({ match }: { match: MatchRateReadiness }) {
  const healthy = !match.isTrackingGap;
  return (
    <section>
      <SectionHead
        title="Can we match your leads to ad clicks?"
        note="Nothing can be sent without an identifier"
      />
      <div
        className={
          "rounded-2xl border p-5 " +
          (healthy ? "border-[var(--border)] bg-white" : "border-amber-300/60 bg-amber-50/60")
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-3">
          <div>
            <span className="mono text-[32px] font-bold leading-none tracking-tight">
              {pct(match.overallRate)}
            </span>
            <span className="ml-2 text-[13px] text-[var(--muted)]">of all leads</span>
          </div>
          <div>
            <span className="mono text-[24px] font-bold leading-none tracking-tight">
              {pct(match.wonRate)}
            </span>
            <span className="ml-2 text-[13px] text-[var(--muted)]">of won deals</span>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {[
            { k: "Click ID", v: match.withClickId },
            { k: "Valid email", v: match.withValidEmail },
            { k: "Either", v: match.withAnyIdentifier },
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-[var(--border)] bg-white px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                {s.k}
              </p>
              <p className="mono text-[15px] font-bold">
                {s.v.toLocaleString()}{" "}
                <span className="text-[12px] font-normal text-[var(--muted)]">
                  / {match.totalRows.toLocaleString()}
                </span>
              </p>
            </div>
          ))}
        </div>

        <p className="mt-3.5 max-w-[74ch] text-[13.5px] text-[var(--muted)]">
          {healthy ? (
            <>
              Enough coverage to send values. The{" "}
              <span className="mono">
                {(match.totalRows - match.withAnyIdentifier).toLocaleString()}
              </span>{" "}
              leads without an identifier simply won&apos;t be included — they&apos;re
              not counted against you anywhere in this report.
            </>
          ) : (
            <>
              <b className="text-[var(--foreground)]">This is the blocker to fix first.</b>{" "}
              Value-based bidding needs a click ID or a usable email on each lead. Below
              40% there isn&apos;t enough to bid on, and no amount of value modelling
              fixes it. A tracking snippet on your forms captures the click ID going
              forward.
            </>
          )}
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5a. Cycle histogram
// ---------------------------------------------------------------------------

export function CycleSection({ cycle }: { cycle: CycleLengthStats }) {
  if (cycle.sampleSize === 0) {
    return (
      <section>
        <SectionHead title="Time to close" />
        <div className="card p-5 text-[13.5px] text-[var(--muted)]">
          No closed-won deals with both a create and close date, so there is no cycle
          to measure yet.
        </div>
      </section>
    );
  }

  const max = Math.max(...cycle.histogram.map((b) => b.count), 1);
  // The bucket containing the median gets the emphasis.
  const medianBucket = cycle.histogram.find(
    (b) =>
      cycle.medianDays !== null &&
      cycle.medianDays >= b.minDays &&
      (b.maxDays === null || cycle.medianDays <= b.maxDays)
  );

  return (
    <section>
      <SectionHead
        title="Time to close"
        note={`${cycle.sampleSize.toLocaleString()} won deals`}
      />
      <div className="card p-5">
        <div className="grid gap-2.5">
          {cycle.histogram.map((b) => (
            <div key={b.label} className="grid grid-cols-[62px_1fr_46px] items-center gap-3">
              <span className="mono text-right text-[12.5px] text-[var(--muted)]">
                {b.label}
              </span>
              <div className="h-[22px] overflow-hidden rounded bg-[#f2f5fa]">
                <div
                  className={
                    "h-full rounded-r transition-all " +
                    (b === medianBucket ? "bg-[var(--primary-hover)]" : "bg-[var(--primary)]")
                  }
                  style={{ width: `${(b.count / max) * 100}%` }}
                />
              </div>
              <span className="mono text-[12.5px] text-[var(--muted)]">{b.count}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--border)] pt-3.5 text-[12.5px] text-[var(--muted)]">
          <span>
            Median <b className="mono text-[var(--foreground)]">{cycle.medianDays}d</b>
          </span>
          <span>
            p25 <b className="mono text-[var(--foreground)]">{cycle.p25Days}d</b>
          </span>
          <span>
            p75 <b className="mono text-[var(--foreground)]">{cycle.p75Days}d</b>
          </span>
          <span>
            Classification{" "}
            <b className="text-[var(--foreground)]">{cycle.classification}</b>
          </span>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5b. Source economics
// ---------------------------------------------------------------------------

export function SourceEconomicsSection({
  sources,
  currency,
}: {
  sources: SourceEconomics[];
  currency: string;
}) {
  const maxValue = Math.max(...sources.map((s) => s.totalWonValue), 1);
  return (
    <section>
      <SectionHead title="Source economics" note="Ranked by realized value" />
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[13.5px]">
            <thead>
              <tr className="bg-[#f8fafd] text-[10.5px] uppercase tracking-[.07em] text-[var(--muted)]">
                <th className="px-4 py-2.5 font-bold">Source</th>
                <th className="px-4 py-2.5 text-right font-bold">Leads</th>
                <th className="px-4 py-2.5 text-right font-bold">Won</th>
                <th className="px-4 py-2.5 text-right font-bold">Lost</th>
                <th className="px-4 py-2.5 text-right font-bold">Close rate</th>
                <th className="px-4 py-2.5 text-right font-bold">Median deal</th>
                <th className="px-4 py-2.5 text-right font-bold">Total won</th>
                <th className="w-[90px] px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.source} className="border-t border-[var(--border)] hover:bg-[#f8fafd]">
                  <td className="px-4 py-2.5 font-semibold">{s.source}</td>
                  <td className="mono px-4 py-2.5 text-right text-[var(--muted)]">{s.total}</td>
                  <td className="mono px-4 py-2.5 text-right text-[var(--muted)]">{s.won}</td>
                  <td className="mono px-4 py-2.5 text-right text-[var(--muted)]">{s.lost}</td>
                  <td className="mono px-4 py-2.5 text-right text-[var(--muted)]">
                    {s.closeRate !== null ? pct(s.closeRate) : "—"}
                  </td>
                  <td className="mono px-4 py-2.5 text-right text-[var(--muted)]">
                    {s.medianWonAmount !== null ? money(s.medianWonAmount, currency) : "—"}
                  </td>
                  <td className="mono px-4 py-2.5 text-right font-bold">
                    {money(s.totalWonValue, currency)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#eef1f7]">
                      <div
                        className="h-full rounded-full bg-[var(--primary)]"
                        style={{ width: `${(s.totalWonValue / maxValue) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5c. Value spread + cap
// ---------------------------------------------------------------------------

export function ValueSpreadSection({
  spread,
  currency,
}: {
  spread: ValueSpread;
  currency: string;
}) {
  if (spread.sampleSize === 0) return null;

  const stops = [
    { k: "Smallest", v: spread.min! },
    { k: "p25", v: spread.p25! },
    { k: "Median", v: spread.median! },
    { k: "p75", v: spread.p75! },
    { k: "Largest", v: spread.max! },
  ];

  return (
    <section>
      <SectionHead title="Value spread and recommended cap" />
      <div className="card p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {stops.map((s) => (
            <div key={s.k}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                {s.k}
              </p>
              <p className="mono mt-0.5 text-[17px] font-bold tracking-tight">
                {money(s.v, currency)}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-[var(--primary)]/25 bg-[var(--primary-soft)]/60 p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[13px] font-bold">Recommended cap</span>
            <span className="mono text-[19px] font-bold tracking-tight text-[var(--primary)]">
              {money(spread.recommendedCap!, currency)}
            </span>
            <span className="text-[12.5px] text-[var(--muted)]">
              ({spread.capMultiple}× your median won deal)
            </span>
          </div>
          <p className="mt-1.5 max-w-[74ch] text-[13px] text-[var(--muted)]">
            Smart Bidding chases the largest values it sees, so a single outlier pulls
            spend toward whatever superficially resembled that lead. Capping keeps the
            ordering between your cohorts intact while removing that distortion. This
            cap would clip{" "}
            <b className="mono text-[var(--foreground)]">{spread.dealsAboveCap}</b>{" "}
            {spread.dealsAboveCap === 1 ? "deal" : "deals"} in this file.
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5d. Domain disparity
// ---------------------------------------------------------------------------

export function DomainSection({
  domain,
  currency,
}: {
  domain: DomainValueDisparity;
  currency: string;
}) {
  if (!domain.available || domain.byDomainType.length < 2) return null;

  const corp = domain.byDomainType.find((d) => d.segment === "corporate");
  const free = domain.byDomainType.find((d) => d.segment === "free");
  const ratio =
    corp?.expectedValue && free?.expectedValue && free.expectedValue > 0
      ? Math.round((corp.expectedValue / free.expectedValue) * 10) / 10
      : null;

  const groups = [
    { title: "By email domain", rows: domain.byDomainType },
    ...(domain.byEmployeeBand ? [{ title: "By company size", rows: domain.byEmployeeBand }] : []),
    ...(domain.byIndustry ? [{ title: "By industry", rows: domain.byIndustry }] : []),
  ];

  return (
    <section>
      <SectionHead
        title="What's knowable on day one"
        note="Signals available the moment a lead arrives"
      >
        <p className="mt-1 max-w-[70ch] text-[13.5px] text-[var(--muted)]">
          {ratio
            ? `Corporate-domain leads are worth ${ratio}× a free-webmail lead. That difference is visible at lead creation, so it can be priced immediately — no model required.`
            : "These differences are visible at lead creation, so they can be priced immediately."}
        </p>
      </SectionHead>

      <div className="grid gap-4 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.title} className="card p-4">
            <p className="label mb-2.5">{g.title}</p>
            <div className="grid gap-2">
              {g.rows.slice(0, 5).map((r) => (
                <div key={r.segment} className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[13px] font-medium capitalize">
                    {r.segment}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="mono text-[11.5px] text-[var(--muted)]">
                      {r.closeRate !== null ? pct(r.closeRate) : "—"}
                    </span>
                    <span className="mono text-[13px] font-bold">
                      {r.expectedValue !== null ? money(r.expectedValue, currency) : "—"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5e. Early gate + trust warnings
// ---------------------------------------------------------------------------

export function DataQualitySection({
  gate,
  trust,
  excluded,
}: {
  gate: EarlyGateResult;
  trust: StageTrustResult;
  excluded: { id: string; reason: string }[];
}) {
  const reasons = new Map<string, number>();
  for (const e of excluded) reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1);

  return (
    <section>
      <SectionHead title="Data quality" note="What we couldn't use, and what looked wrong" />
      <div className="grid gap-2.5">
        {/* Early gate */}
        <div
          className={
            "rounded-xl border p-4 " +
            (gate.recommended
              ? "border-[var(--primary)]/25 bg-[var(--primary-soft)]/50"
              : "border-[var(--border)] bg-white")
          }
        >
          <p className="text-[13.5px] font-bold">
            {gate.recommended
              ? `"${gate.recommended.stage}" works as an early signal`
              : "No reliable early gate in this data"}
          </p>
          <p className="mt-0.5 max-w-[74ch] text-[13px] text-[var(--muted)]">
            {gate.recommended ? (
              <>
                It fires within 7 days of lead creation for{" "}
                <b className="mono text-[var(--foreground)]">
                  {pct(gate.recommended.withinWindowRate)}
                </b>{" "}
                of deals that reach it, which is inside the window where Google still
                acts on a value adjustment. Outside that window an adjustment is
                ignored, so a later stage is no use for bidding however predictive it is.
              </>
            ) : (
              gate.message
            )}
          </p>
        </div>

        {/* Stage trust */}
        {trust.available && trust.untrustedStages.length > 0 && (
          <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-4">
            <p className="text-[13.5px] font-bold">
              {trust.untrustedStages.length === 1
                ? `"${trust.untrustedStages[0]}" stage timestamps look backfilled`
                : `${trust.untrustedStages.length} stages have backfilled timestamps`}
            </p>
            <p className="mt-0.5 max-w-[74ch] text-[13px] text-[var(--muted)]">
              {trust.findings
                .filter((f) => !f.trusted)
                .map((f) => `${pct(f.subHourRate)} of "${f.stage}" durations are under an hour`)
                .join("; ")}
              . That pattern usually means the stage was set retroactively rather than
              lived through, so we excluded it from early-gate detection instead of
              trusting a sequence that never happened.
            </p>
          </div>
        )}

        {/* Exclusions */}
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-[13.5px] font-bold">
            {excluded.length === 0
              ? "No rows were excluded"
              : `${excluded.length.toLocaleString()} ${excluded.length === 1 ? "row" : "rows"} excluded`}
          </p>
          {excluded.length > 0 ? (
            <ul className="mt-2 grid gap-1.5">
              {[...reasons.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([reason, count]) => (
                  <li
                    key={reason}
                    className="flex items-baseline justify-between gap-4 border-t border-dashed border-[var(--border)] pt-1.5 text-[13px] text-[var(--muted)] first:border-0 first:pt-0"
                  >
                    <span>{reason}</span>
                    <span className="mono shrink-0 font-semibold">{count}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-0.5 text-[13px] text-[var(--muted)]">
              Every row in the file had what the analysis needed.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
