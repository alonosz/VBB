import type { ValueTierRule } from "@/lib/types";

export function ValueTierEditor({
  rule,
  headers,
  onChange,
}: {
  rule: ValueTierRule;
  headers: string[];
  onChange: (rule: ValueTierRule) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Column</label>
        <select
          className="input mt-1"
          value={rule.column}
          onChange={(e) => onChange({ ...rule, column: e.target.value })}
        >
          <option value="">Select a column…</option>
          {headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Value → points</label>
        <div className="mt-1 space-y-2">
          {rule.tiers.map((tier, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input"
                placeholder="e.g. Closed Won"
                value={tier.value}
                onChange={(e) => {
                  const tiers = [...rule.tiers];
                  tiers[i] = { ...tiers[i], value: e.target.value };
                  onChange({ ...rule, tiers });
                }}
              />
              <input
                type="number"
                min={-100}
                max={100}
                className="input w-24"
                value={tier.points}
                onChange={(e) => {
                  const tiers = [...rule.tiers];
                  tiers[i] = { ...tiers[i], points: Number(e.target.value) };
                  onChange({ ...rule, tiers });
                }}
              />
              <button
                type="button"
                aria-label="Remove tier"
                className="btn btn-ghost px-2 text-[var(--muted-soft)] hover:text-[var(--danger)]"
                onClick={() =>
                  onChange({
                    ...rule,
                    tiers: rule.tiers.filter((_, idx) => idx !== i),
                  })
                }
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-secondary mt-2 text-xs"
          onClick={() =>
            onChange({
              ...rule,
              tiers: [...rule.tiers, { value: "", points: 0 }],
            })
          }
        >
          + Add value
        </button>
      </div>

      <div className="flex items-center gap-2">
        <label className="label whitespace-nowrap">Points for unmatched values</label>
        <input
          type="number"
          min={-100}
          max={100}
          className="input w-24"
          value={rule.defaultPoints}
          onChange={(e) =>
            onChange({ ...rule, defaultPoints: Number(e.target.value) })
          }
        />
      </div>
    </div>
  );
}
