"use client";

import {
  MIN_COHORT,
  PROOF_CAVEAT,
  type CohortOutcome,
  type ProofVerdict,
} from "@/lib/analysis/didItWork";
import { money } from "./panels";

/**
 * The screen that says whether any of this was worth it.
 *
 * Google will happily report that conversion value went up, and quoting that
 * back would be circular - we are the ones who told Google those values. So
 * none of it appears here. This compares what actually happened to the leads
 * in the advertiser's own CRM, before the switch against after.
 *
 * Most advertisers will see one of the three waiting states for weeks, and
 * those are the important half of this component. A panel that only knows how
 * to show a good result is a marketing asset, not a measurement, so each
 * refusal says plainly what is missing and when it will be answerable.
 */

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function Waiting({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="well p-5">
      <p className="text-[14px] font-bold">{title}</p>
      <p className="mt-1.5 max-w-[70ch] text-[13.5px] text-[var(--muted)]">{children}</p>
    </div>
  );
}

function Column({
  label,
  outcome,
  currency,
  emphasis,
}: {
  label: string;
  outcome: CohortOutcome;
  currency: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border px-4 py-3.5 " +
        (emphasis
          ? "border-[var(--primary)]/35 bg-[var(--primary-soft)]"
          : "border-[var(--border)] bg-[var(--surface)]")
      }
    >
      <p className="label">{label}</p>
      <p className="mono mt-2 text-[24px] font-bold tracking-tight">
        {money(outcome.valuePerLead, currency)}
      </p>
      <p className="text-[12px] text-[var(--muted)]">worth per lead</p>
      <p className="mono mt-2.5 text-[12px] text-[var(--muted)]">
        {pct(outcome.closeRate)} close · {outcome.won.toLocaleString()} won of{" "}
        {outcome.resolved.toLocaleString()} resolved
        {outcome.medianWonAmount !== null && (
          <> · {money(outcome.medianWonAmount, currency)} median</>
        )}
      </p>
    </div>
  );
}

export function DidItWorkPanel({
  verdict,
  currency,
}: {
  verdict: ProofVerdict;
  currency: string;
}) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="h2">Did it work?</h2>
        <p className="mt-1.5 max-w-[72ch] text-[14px] text-[var(--muted)]">
          Measured in your own closed deals, not in the values we sent Google.
          Google reporting a higher conversion value would only be repeating
          back what we told it.
        </p>
      </div>

      {verdict.kind === "no-baseline" && (
        <Waiting title="Nothing to compare yet">
          We record where you started on the day you switch to a value-based bid
          strategy. From then on this compares the leads Google bought after
          against the ones it bought before.
        </Waiting>
      )}

      {verdict.kind === "too-early" && (
        <Waiting title="Too early to tell">
          It has been{" "}
          <span className="mono font-semibold text-[var(--foreground)]">
            {verdict.daysIn}
          </span>{" "}
          days. Your deals take long enough to close that we need about{" "}
          <span className="mono font-semibold text-[var(--foreground)]">
            {verdict.daysNeeded}
          </span>{" "}
          before a comparison means anything - any sooner and we would be
          measuring which group had more time to close, not which group was
          better.
        </Waiting>
      )}

      {verdict.kind === "too-few" && (
        <Waiting title="Not enough resolved deals yet">
          <span className="mono font-semibold text-[var(--foreground)]">
            {verdict.before.toLocaleString()}
          </span>{" "}
          before and{" "}
          <span className="mono font-semibold text-[var(--foreground)]">
            {verdict.after.toLocaleString()}
          </span>{" "}
          after have actually closed, won or lost. Below{" "}
          <span className="mono">{MIN_COHORT}</span> on either side, a swing
          either way is noise, and we would rather say nothing than hand you a
          number that cannot hold weight.
        </Waiting>
      )}

      {verdict.kind === "measured" && (
        <>
          <div
            className={
              "rounded-[var(--radius-lg)] border px-5 py-4 " +
              (verdict.improved
                ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]"
                : "border-[var(--warn)]/40 bg-[var(--warn-soft)]")
            }
          >
            <p className="text-[14px] font-bold">
              {verdict.improved ? (
                <>
                  The leads Google buys are worth{" "}
                  <span className="mono">{pct(Math.abs(verdict.change))}</span> more
                  than before the switch.
                </>
              ) : (
                <>
                  The leads Google buys are worth{" "}
                  <span className="mono">{pct(Math.abs(verdict.change))}</span> less
                  than before the switch.
                </>
              )}
            </p>
            <p className="mt-1 max-w-[72ch] text-[13px] text-[var(--muted-strong)]">
              Close rate times median won amount, on deals that have actually
              resolved in your CRM.
            </p>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Column label="Before the switch" outcome={verdict.before} currency={currency} />
            <Column
              label="Since the switch"
              outcome={verdict.after}
              currency={currency}
              emphasis
            />
          </div>

          {/*
            Always, next to any result. A before-and-after is not an
            experiment, and a real finding stays trustworthy only if what it
            cannot rule out is said out loud.
          */}
          <p className="mt-3 max-w-[74ch] text-[12.5px] text-[var(--muted)]">
            {PROOF_CAVEAT}
          </p>
        </>
      )}
    </section>
  );
}
