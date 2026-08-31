import type { StrategyAudit } from "@/lib/sync/google/campaigns";
import { money } from "@/components/report/panels";

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
      <p className="text-[13px] text-[var(--accent)]">
        {tense === "sending"
          ? "Every running campaign is already on a bid strategy that uses conversion value."
          : "Every running campaign is bidding on the values you send."}
      </p>
    );
  }

  return (
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
  );
}
