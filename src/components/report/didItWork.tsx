"use client";

import { useState } from "react";
import { readWorkspaceKey } from "@/lib/workspace/clientKey";
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


/**
 * Marking the day, on the day.
 *
 * Deliberately a button rather than something inferred. We could eventually
 * spot the change by reading campaign settings each night, but that needs the
 * Ads API and it needs to have been watching beforehand - and the advertiser
 * standing here having just switched knows the answer now. The date is the one
 * thing that cannot be recovered later, so the cheap version that works today
 * beats the clever one that works eventually.
 */
function RecordSwitch({ onRecorded }: { onRecorded?: (at: Date) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10));

  async function record() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace/switched", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceKey: readWorkspaceKey(),
          switchedAt: new Date(`${when}T00:00:00Z`).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "We couldn't record that.");
        return;
      }
      onRecorded?.(new Date(data.switchedAt as string));
    } catch {
      setError("We couldn't record that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="well p-5">
      <p className="text-[14px] font-bold">Nothing to compare yet</p>
      <p className="mt-1.5 max-w-[70ch] text-[13.5px] text-[var(--muted)]">
        The day you move your campaigns to Maximize conversion value, tell us
        here. From then on this compares the leads Google buys against the ones
        it bought before - measured in deals that actually closed.
      </p>
      <p className="mt-1.5 max-w-[70ch] text-[12.5px] text-[var(--muted)]">
        Worth doing on the day. The &ldquo;before&rdquo; cannot be worked out
        later once the date is forgotten.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="switched-on" className="text-[13px] text-[var(--muted)]">
          Switched on
        </label>
        <input
          id="switched-on"
          type="date"
          value={when}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setWhen(e.target.value)}
          className="input mono w-auto text-[13px]"
        />
        <button
          type="button"
          onClick={() => void record()}
          disabled={saving || !when}
          className="btn btn-secondary text-[13px]"
        >
          {saving ? "Recording…" : "Record it"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2.5 max-w-[62ch] text-[13px] text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

export function DidItWorkPanel({
  verdict,
  currency,
  onRecorded,
}: {
  verdict: ProofVerdict;
  currency: string;
  /** Called once a switch date lands, so the page can recompute. */
  onRecorded?: (at: Date) => void;
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

      {verdict.kind === "no-baseline" && <RecordSwitch onRecorded={onRecorded} />}

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
