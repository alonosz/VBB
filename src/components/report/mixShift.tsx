"use client";

import type { MixVerdict } from "@/lib/analysis/mixShift";
import { money } from "./panels";

/**
 * The leading indicator: is Google buying a different kind of lead?
 *
 * This answers in weeks what the outcome comparison answers in a year,
 * because every lead counts the day it arrives instead of the day it closes.
 * For most of the first months it is the only thing on this screen with
 * anything to say, and it is saying the thing that matters most early on -
 * the machine is running, or it is not.
 *
 * Deliberately never phrased as a result. "Google is buying better leads" is
 * a statement about who arrived; "you made money" is a statement about who
 * paid, and only the panel above gets to make that one.
 */

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function points(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${(Math.abs(n) * 100).toFixed(0)} pts`;
}

export function MixShiftPanel({
  verdict,
  currency,
}: {
  verdict: MixVerdict;
  currency: string;
}) {
  if (verdict.kind === "no-baseline") return null;

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-[15px] font-bold">The pipeline Google is building you</h2>
      <p className="mt-1 max-w-[72ch] text-[13px] text-[var(--muted)]">
        Value bidding does one thing: it changes the mix of leads the platform
        buys. A lead carries its expected value the day it arrives, so this
        answers in weeks what closed deals take a year to prove. It is pipeline,
        not banked revenue - the comparison above is the money.
      </p>

      {verdict.kind === "flat-model" && (
        <p className="mt-3 max-w-[70ch] text-[13px] text-[var(--muted-strong)]">
          {verdict.reason}
        </p>
      )}

      {verdict.kind === "too-few" && (
        <p className="mt-3 max-w-[70ch] text-[13px] text-[var(--muted-strong)]">
          <span className="mono">{verdict.before.toLocaleString()}</span> Google leads
          before the switch and{" "}
          <span className="mono">{verdict.after.toLocaleString()}</span> since. Below{" "}
          <span className="mono">{verdict.needed}</span> on either side a share is not
          a trend yet. This needs leads, not closed deals, so it usually answers
          within a few weeks of the switch.
        </p>
      )}

      {verdict.kind === "measured" && (
        <>
          <div
            className={
              "mt-3 rounded-[var(--radius-lg)] border px-5 py-4 " +
              (verdict.change > 0
                ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]"
                : "border-[var(--warn)]/40 bg-[var(--warn-soft)]")
            }
          >
            {/*
              The number that goes in the board pack, and the one they will
              screenshot. A rate belongs underneath it, not instead of it.
            */}
            <p className="label">Expected pipeline from Google</p>
            <p className="mono mt-1 text-[1.9rem] leading-none font-bold tracking-tight">
              {money(verdict.pipeline.perMonthAfter, currency)}
              <span className="text-[0.95rem] font-semibold text-[var(--muted)]">
                /mo
              </span>
            </p>
            <p className="mono mt-1.5 text-[12.5px] text-[var(--muted)]">
              up from {money(verdict.pipeline.perMonthBefore, currency)}/mo ·{" "}
              {money(verdict.pipeline.createdSince, currency)} created since the
              switch, across {verdict.googleAfter.toLocaleString()} leads
            </p>

            <p className="mt-3 max-w-[70ch] text-[13.5px] font-bold">
              The leads Google buys now are worth{" "}
              <span className="mono">{pct(Math.abs(verdict.change))}</span>{" "}
              {verdict.change > 0 ? "more" : "less"} each than before the switch.
            </p>
            <p className="mono mt-1 text-[13px] text-[var(--muted-strong)]">
              {money(verdict.scoreBefore, currency)}
              <span className="px-1.5 text-[var(--muted)]">&rarr;</span>
              <span className="font-semibold text-[var(--foreground)]">
                {money(verdict.scoreAfter, currency)}
              </span>{" "}
              <span className="text-[12px] text-[var(--muted)]">per lead</span>
            </p>

            {verdict.attributable !== null && verdict.pipeline.attributable !== null && (
              <p className="mt-2.5 max-w-[70ch] text-[13px] text-[var(--muted-strong)]">
                Leads from everywhere else moved{" "}
                <span className="mono">{pct(verdict.controlChange ?? 0)}</span> over the
                same period, so{" "}
                <span className="mono font-bold">
                  {money(Math.abs(verdict.pipeline.attributable), currency)}
                </span>{" "}
                of that pipeline is the bid change rather than a shift in who was
                going to find you anyway.
              </p>
            )}
          </div>

          <p className="mt-2.5 max-w-[74ch] text-[13px] text-[var(--muted)]">
            Is it luck? Dealing these same leads into before and after at random{" "}
            <span className="mono">{verdict.chance.shuffles.toLocaleString()}</span>{" "}
            times produced a shift this large{" "}
            <span className="mono font-semibold text-[var(--foreground)]">
              {verdict.chance.asExtreme.toLocaleString()}
            </span>{" "}
            {verdict.chance.asExtreme === 1 ? "time" : "times"}.{" "}
            {verdict.chance.unlikelyChance
              ? "Luck is an unlikely explanation."
              : "That is often enough that the mix may not have really moved."}
          </p>

          {/*
            Said plainly, every time. Their CRM will report a bigger pipeline
            number because it counts every open deal at sticker price, and a
            figure that cannot survive being placed beside HubSpot is worse
            than no figure.
          */}
          <p className="mt-2.5 max-w-[74ch] text-[12.5px] text-[var(--muted)]">
            Expected means each lead is already multiplied by how often its kind
            actually closes for you, so this is smaller than the pipeline figure
            in your CRM - and a good deal likelier to arrive.
          </p>

          {/*
            The sentence a marketer repeats to their boss, and can check
            against their own CRM in a minute.
          */}
          {verdict.movers.length > 0 && (
            <div className="mt-4">
              <p className="label">What Google buys more and less of</p>
              <div className="mt-2 grid gap-1.5">
                {verdict.movers.slice(0, 6).map((m) => (
                  <div
                    key={`${m.factorKey}-${m.level}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-[var(--border)] pb-1.5 last:border-0"
                  >
                    <span className="text-[13px]">
                      <span className="font-semibold">{m.level}</span>
                      <span className="ml-2 mono text-[11.5px] text-[var(--muted)]">
                        {m.factorLabel} · &times;{m.multiplier}
                      </span>
                    </span>
                    <span className="mono text-[12.5px] text-[var(--muted)]">
                      {pct(m.beforeShare)}
                      <span className="px-1.5">&rarr;</span>
                      <span className="font-semibold text-[var(--foreground)]">
                        {pct(m.afterShare)}
                      </span>
                      <span
                        className={
                          "ml-2 font-bold " +
                          (m.shift > 0 === m.multiplier > 1
                            ? "text-[var(--accent)]"
                            : "text-[var(--warn)]")
                        }
                      >
                        {points(m.shift)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 max-w-[72ch] text-[12px] text-[var(--muted)]">
                Share of your Google leads carrying each attribute, before and since.
                Green where Google moved towards what your data says is worth more.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
