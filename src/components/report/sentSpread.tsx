import { sentValueSpread } from "@/lib/analysis/sentSpread";
import { money } from "./panels";

/**
 * The check that costs nothing and can save three months.
 *
 * Everything else about "did it work" needs a sales cycle to answer. This one
 * is answerable before a single value is sent: if every lead carries the same
 * figure, Maximize Conversion Value will buy exactly the leads Maximize
 * Conversions would have bought, because there is no difference for it to act
 * on. Saying so here is worth more than a polite result in April.
 *
 * Shown above both send routes, since it is true of the values themselves and
 * has nothing to do with how they reach Google.
 */
export function SentSpreadPanel({
  values,
  currency,
}: {
  values: number[];
  currency: string;
}) {
  const spread = sentValueSpread(values);
  if (!spread) return null;

  const tone =
    spread.verdict === "workable"
      ? { border: "border-[var(--accent)]/40", bg: "bg-[var(--accent-soft)]", ink: "text-[var(--accent)]" }
      : spread.verdict === "narrow"
        ? { border: "border-[var(--warn)]/40", bg: "bg-[var(--warn-soft)]", ink: "text-[var(--warn)]" }
        : { border: "border-[var(--danger)]/40", bg: "bg-[var(--danger-soft)]", ink: "text-[var(--danger)]" };

  const heading =
    spread.verdict === "workable"
      ? "Your values vary enough to bid on"
      : spread.verdict === "narrow"
        ? "Your values barely vary"
        : "Your values are flat";

  return (
    <section className={`rounded-[var(--radius-lg)] border px-5 py-4 ${tone.border} ${tone.bg}`}>
      <p className={`text-[14px] font-bold ${tone.ink}`}>{heading}</p>
      <p className="mt-1 max-w-[72ch] text-[13px] text-[var(--muted-strong)]">
        {spread.because}
      </p>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        <Figure label="Bottom 10%" value={money(spread.p10, currency)} />
        <Figure label="Typical" value={money(spread.p50, currency)} />
        <Figure label="Top 10%" value={money(spread.p90, currency)} />
        <Figure
          label="Different values"
          value={spread.distinct.toLocaleString()}
          hint={`across ${spread.leads.toLocaleString()} leads`}
        />
      </div>

      {spread.verdict !== "workable" && (
        <p className="mt-3 max-w-[72ch] text-[12.5px] text-[var(--muted)]">
          This is not a reason to stop, but it is a reason to expect little. The
          fix is more of what separates a good lead from a bad one in your CRM:
          a filled-in industry, company size, or the form field your best buyers
          answer differently.
        </p>
      )}
    </section>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="mono mt-0.5 text-[17px] font-bold tracking-tight">{value}</p>
      {hint && <p className="text-[11.5px] text-[var(--muted)]">{hint}</p>}
    </div>
  );
}
