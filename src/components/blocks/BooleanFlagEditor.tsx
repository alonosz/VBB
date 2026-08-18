import type { BooleanFlagRule } from "@/lib/types";

export function BooleanFlagEditor({
  rule,
  headers,
  onChange,
}: {
  rule: BooleanFlagRule;
  headers: string[];
  onChange: (rule: BooleanFlagRule) => void;
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Points if present</label>
          <input
            type="number"
            min={-100}
            max={100}
            className="input mt-1"
            value={rule.presentPoints}
            onChange={(e) =>
              onChange({ ...rule, presentPoints: Number(e.target.value) })
            }
          />
        </div>
        <div>
          <label className="label">Points if absent</label>
          <input
            type="number"
            min={-100}
            max={100}
            className="input mt-1"
            value={rule.absentPoints}
            onChange={(e) =>
              onChange({ ...rule, absentPoints: Number(e.target.value) })
            }
          />
        </div>
      </div>
      <p className="text-xs text-[#8688a0]">
        A record counts as &ldquo;present&rdquo; when the field is non-empty
        (and not &ldquo;no&rdquo;/&ldquo;false&rdquo;/&ldquo;0&rdquo;).
      </p>
    </div>
  );
}
