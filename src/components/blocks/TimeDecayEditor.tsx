import type { TimeDecayRule } from "@/lib/types";

export function TimeDecayEditor({
  rule,
  headers,
  onChange,
}: {
  rule: TimeDecayRule;
  headers: string[];
  onChange: (rule: TimeDecayRule) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">From date column</label>
          <select
            className="input mt-1"
            value={rule.startColumn}
            onChange={(e) => onChange({ ...rule, startColumn: e.target.value })}
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
          <label className="label">To date column</label>
          <select
            className="input mt-1"
            value={rule.endColumn}
            onChange={(e) => onChange({ ...rule, endColumn: e.target.value })}
          >
            <option value="">Select a column…</option>
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Points at zero days</label>
          <input
            type="number"
            min={-100}
            max={100}
            className="input mt-1"
            value={rule.maxPoints}
            onChange={(e) =>
              onChange({ ...rule, maxPoints: Number(e.target.value) })
            }
          />
        </div>
        <div>
          <label className="label">Half-life (days)</label>
          <input
            type="number"
            min={0.1}
            step={0.5}
            className="input mt-1"
            value={rule.halfLifeDays}
            onChange={(e) =>
              onChange({ ...rule, halfLifeDays: Number(e.target.value) })
            }
          />
        </div>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Points start at {rule.maxPoints} when the two dates are the same day,
        and halve every {rule.halfLifeDays || 0} day(s) after that.
      </p>
    </div>
  );
}
