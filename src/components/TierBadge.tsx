const STYLES: Record<string, string> = {
  High: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Medium: "bg-amber-50 text-amber-700 border-amber-200",
  Low: "bg-rose-50 text-rose-700 border-rose-200",
};

export function TierBadge({ tier }: { tier: "High" | "Medium" | "Low" }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold " +
        STYLES[tier]
      }
    >
      {tier}
    </span>
  );
}
