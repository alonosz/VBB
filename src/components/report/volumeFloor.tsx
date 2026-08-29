"use client";

import { useState } from "react";
import type { VolumeCheck } from "@/lib/analysis/types";
import { MIN_LEADS_PER_MONTH } from "@/lib/analysis/volume";
import { Alert } from "@/components/ui";
import { money } from "./panels";

/**
 * The budget conversation, at the moment it can still change the outcome.
 *
 * Value-based Smart Bidding is a learning system, and it needs roughly 30
 * conversions a month before it has enough to learn from. Below that it is not
 * that the values are wrong - it is that Google never gets enough of them to
 * separate signal from noise, and bidding stays roughly as random as it was.
 *
 * That threshold is a *budget* decision, not a modelling one, and nothing in
 * the product said so. Someone can leave this screen with a perfect model and
 * a daily budget that produces twelve leads a month, and the only symptom will
 * be that nothing seems to improve.
 *
 * The one figure that would make this actionable - a recommended daily budget
 * - is the one we cannot supply. It needs their cost per lead, which lives in
 * Google Ads, not in a CRM export. Inventing a plausible one would be exactly
 * the failure this product exists to avoid. So the arithmetic is offered and
 * the input is theirs: type your cost per lead, see the monthly floor. Nothing
 * is stored, and it is visibly their number times a documented threshold.
 */

const DAYS_PER_MONTH = 30.44;

export function VolumeFloorPanel({
  volume,
  currency,
}: {
  volume: VolumeCheck;
  currency: string;
}) {
  const [cpl, setCpl] = useState("");

  const parsed = Number(cpl);
  const usableCpl = cpl.trim() !== "" && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  const monthlyFloor = usableCpl === null ? null : usableCpl * MIN_LEADS_PER_MONTH;
  const dailyFloor = monthlyFloor === null ? null : monthlyFloor / DAYS_PER_MONTH;

  const clears = volume.leadVolumeSufficient;

  return (
    <section className="card p-6 sm:p-7">
      <p className="label" style={{ color: clears ? "var(--accent)" : "var(--warn)" }}>
        Before you set the budget
      </p>
      <h2 className="h2 mt-2">Smart Bidding needs {MIN_LEADS_PER_MONTH} conversions a month</h2>
      <p className="mt-2 max-w-[70ch] text-[14px] text-[var(--muted)]">
        Value-based bidding is a learning system. Below roughly{" "}
        <span className="mono font-semibold text-[var(--foreground)]">
          {MIN_LEADS_PER_MONTH}
        </span>{" "}
        conversions a month it never gets enough examples to tell your good leads
        from your bad ones, and bidding stays noisy however good the values are.
        Set the daily budget with that number in mind, not just the cost per lead.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {/* Their own measured rate, which is the honest half of this. */}
        <div className="well p-4">
          <p className="label">Your file shows</p>
          <p
            className="mono mt-1.5 text-[1.6rem] leading-none font-bold"
            style={{ color: clears ? "var(--accent)" : "var(--warn)" }}
          >
            {volume.leadsPerMonth}
            <span className="text-[0.9rem] font-semibold text-[var(--muted)]">/mo</span>
          </p>
          <p className="mono mt-1.5 text-[11.5px] text-[var(--muted)]">
            leads · over {volume.monthsObserved} months
          </p>
          <p className="mt-2 text-[12.5px] text-[var(--muted-strong)]">
            {clears
              ? `Comfortably past ${MIN_LEADS_PER_MONTH}. Keep the budget at a level that holds it there.`
              : `Under ${MIN_LEADS_PER_MONTH}. At this rate Google will not have enough to learn from.`}
          </p>
        </div>

        {/*
          The arithmetic, with their number. We do not know their cost per
          lead - it is in Google Ads, not in a CRM export - so we ask rather
          than guess.
        */}
        <div className="well p-4">
          <label htmlFor="cpl" className="label block">
            Your cost per lead, if you know it
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="mono text-[13px] text-[var(--muted)]">{currency}</span>
            <input
              id="cpl"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={cpl}
              onChange={(e) => setCpl(e.target.value)}
              placeholder="45"
              className="input mono w-28 text-[14px]"
            />
          </div>

          {monthlyFloor === null ? (
            <p className="mt-3 max-w-[38ch] text-[12.5px] text-[var(--muted)]">
              Type it and we&apos;ll show the spend that produces{" "}
              {MIN_LEADS_PER_MONTH} conversions a month. Nothing is sent anywhere.
            </p>
          ) : (
            <div className="mt-3">
              <p className="text-[12.5px] text-[var(--muted)]">
                To reach {MIN_LEADS_PER_MONTH} conversions a month
              </p>
              <p className="mono mt-1 text-[1.35rem] leading-none font-bold text-[var(--primary-deep)]">
                {money(monthlyFloor, currency)}
                <span className="text-[0.85rem] font-semibold text-[var(--muted)]">/mo</span>
              </p>
              <p className="mono mt-1.5 text-[12px] text-[var(--muted)]">
                ≈ {money(dailyFloor ?? 0, currency, 2)}/day
              </p>
              <p className="mt-2 max-w-[38ch] text-[11.5px] text-[var(--muted)]">
                Your figure × {MIN_LEADS_PER_MONTH}. A floor to plan against, not
                a forecast - your real cost per lead moves once bidding changes.
              </p>
            </div>
          )}
        </div>
      </div>

      {!clears && (
        <div className="mt-4">
          <Alert tone="warn" title="Worth deciding before you switch strategies">
            <p className="max-w-[70ch] text-[13.5px]">
              At {volume.leadsPerMonth} leads a month you can still send these
              values - they cost nothing and the data starts accumulating. But
              hold off on switching the campaign to{" "}
              <span className="font-semibold">Maximize conversion value</span>{" "}
              until volume is there, or raise the budget to get it there. Switching
              early means a learning period that never finishes.
            </p>
          </Alert>
        </div>
      )}
    </section>
  );
}
