const STYLES: Record<string, string> = {
  High: "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-line)]",
  Medium: "bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn-line)]",
  Low: "bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger-line)]",
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
