import type { StrategyAudit } from "@/lib/sync/google/campaigns";
import { money } from "@/components/report/panels";
import { MIN_LEADS_PER_MONTH } from "@/lib/analysis/volume";

/**
 * Which campaigns will act on the values, and which will not.
 *
 * The single most common reason value-based bidding "does not work". Maximize
 * Conversions and Target CPA bid on how many leads arrive and ignore what they
 * are worth, so the values land, are stored, are reported, and change no bid.
 * Google flags none of this: it is a setting, not an error.
 *
 * Shared between the moment of sending and the evaluation screen, because the
 * answer is the same one and it goes stale - a bid strategy somebody changes
 * back in March is invisible until the results go quiet.
 */

export function StrategyPanel({
  audit,
  currencyCode,
  tense = "sending",
}: {
  audit: StrategyAudit;
  currencyCode: string;
  /** Whether the values are about to be sent, or have been going for a while. */
  tense?: "sending" | "running";
}) {
  const ignoring = audit.ignoring;

  /*
   * No campaigns at all is not a clean bill of health. "Every running campaign
   * uses your values" is true of an empty list and reads as a pass, when what
   * actually happened is that nothing is running for the values to reach.
   */
  if (audit.campaigns.length === 0) {
    return (
      <p className="text-[13px] text-[var(--muted)]">
        No campaigns have run in the last 30 days, so there is nothing for your
        values to bid on yet.
      </p>
    );
  }

  if (ignoring.length === 0) {
    return (
      <div className="grid gap-3">
        <p className="text-[13px] text-[var(--accent)]">
          {tense === "sending"
            ? "Every running campaign is already on a bid strategy that uses conversion value."
            : "Every running campaign is bidding on the values you send."}
        </p>
        <VolumeNote audit={audit} />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
    <div className="alert alert-warn">
      <p className="text-[13.5px] font-bold text-[var(--warn)]">
        {ignoring.length === 1 ? "One campaign" : `${ignoring.length} campaigns`}{" "}
        {tense === "sending" ? "will ignore these values" : "are ignoring your values"}
      </p>
      <p className="mt-1 max-w-[70ch] text-[13px] text-[var(--muted-strong)]">
        They are on a bid strategy that optimises for how many leads you get, not
        what they are worth. That is{" "}
        <span className="mono">{money(audit.spendIgnoringValue, currencyCode)}</span> of
        your last 30 days, or{" "}
        <span className="mono">{Math.round(audit.shareIgnoringValue * 100)}%</span>.
        Switch them to Maximize conversion value in Google Ads.
      </p>
      <ul className="mt-2 grid gap-1">
        {ignoring.slice(0, 6).map((c) => (
          <li key={c.id} className="mono text-[12px] text-[var(--muted)]">
            {c.name} · {c.strategyLabel} · {money(c.cost, currencyCode)}
          </li>
        ))}
      </ul>
      {ignoring.length > 6 && (
        <p className="mono mt-1 text-[12px] text-[var(--muted)]">
          and {ignoring.length - 6} more
        </p>
      )}
    </div>
    <VolumeNote audit={audit} />
    </div>
  );
}

/**
 * Whether the value campaigns see enough conversions to learn from.
 *
 * Smart Bidding learns per campaign, so the account total is the wrong
 * number to check: 36 conversions split three ways is three campaigns that
 * never finish learning. That case gets its own message because its fix is
 * free - consolidate, or put the campaigns on one shared portfolio bid
 * strategy - where genuinely thin volume needs budget or wider targeting.
 * Quiet when everything clears the floor; a pass needs no paragraph.
 */
function VolumeNote({ audit }: { audit: StrategyAudit }) {
  if (audit.underVolume.length === 0) return null;

  if (audit.splitVolume) {
    return (
      <div className="alert alert-warn">
        <p className="text-[13.5px] font-bold text-[var(--warn)]">
          Enough conversions, split too thin to learn from
        </p>
        <p className="mt-1 max-w-[70ch] text-[13px] text-[var(--muted-strong)]">
          Your value campaigns saw{" "}
          <span className="mono">{Math.round(audit.valueConversions)}</span> conversions
          in the last 30 days - past the roughly{" "}
          <span className="mono">{MIN_LEADS_PER_MONTH}</span> a month Smart Bidding
          needs - but no single campaign got that many, and each one learns on its
          own. Consolidating them, or putting them on one shared portfolio bid
          strategy, fixes this without spending more.
        </p>
      </div>
    );
  }

  return (
    <div className="alert alert-warn">
      <p className="text-[13.5px] font-bold text-[var(--warn)]">
        {audit.underVolume.length === 1
          ? "One campaign is under the learning floor"
          : `${audit.underVolume.length} campaigns are under the learning floor`}
      </p>
      <p className="mt-1 max-w-[70ch] text-[13px] text-[var(--muted-strong)]">
        Smart Bidding needs roughly{" "}
        <span className="mono">{MIN_LEADS_PER_MONTH}</span> conversions a month per
        campaign to learn which leads are worth more. Below that the values arrive
        and bidding stays noisy. More budget is one fix; broader targeting or
        folding thin campaigns into a bigger one gets there without it.
      </p>
      <ul className="mt-2 grid gap-1">
        {audit.underVolume.slice(0, 6).map((c) => (
          <li key={c.id} className="mono text-[12px] text-[var(--muted)]">
            {c.name} · {Math.round(c.conversions)} conversions in 30 days
          </li>
        ))}
      </ul>
    </div>
  );
}
