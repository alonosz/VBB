import type { NumericBucketRule } from "@/lib/types";
import { percentileLabels } from "@/lib/blockDefaults";

export function NumericBucketEditor({
  rule,
  headers,
  onChange,
}: {
  rule: NumericBucketRule;
  headers: string[];
  onChange: (rule: NumericBucketRule) => void;
}) {
  const labels = percentileLabels(rule.percentileScores.length);

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

      <div className="flex overflow-hidden rounded-lg border border-[var(--border)] w-fit">
        {(["range", "percentile"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange({ ...rule, mode: m })}
            className={
              "px-3 py-1.5 text-xs font-semibold transition-colors " +
              (rule.mode === m
                ? "bg-[var(--primary)] text-white"
                : "bg-white text-[#6b6d85] hover:bg-[#f3f3f8]")
            }
          >
            {m === "range" ? "Fixed ranges" : "Percentile"}
          </button>
        ))}
      </div>

      {rule.mode === "range" ? (
        <div className="space-y-2">
          {rule.buckets.map((bucket, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="number"
                placeholder="min"
                className="input w-24"
                value={bucket.min ?? ""}
                onChange={(e) => {
                  const buckets = [...rule.buckets];
                  buckets[i] = {
                    ...buckets[i],
                    min: e.target.value === "" ? null : Number(e.target.value),
                  };
                  onChange({ ...rule, buckets });
                }}
              />
              <span className="text-xs text-[#8688a0]">to</span>
              <input
                type="number"
                placeholder="max"
                className="input w-24"
                value={bucket.max ?? ""}
                onChange={(e) => {
                  const buckets = [...rule.buckets];
                  buckets[i] = {
                    ...buckets[i],
                    max: e.target.value === "" ? null : Number(e.target.value),
                  };
                  onChange({ ...rule, buckets });
                }}
              />
              <span className="text-xs text-[#8688a0]">→</span>
              <input
                type="number"
                min={-100}
                max={100}
                className="input w-20"
                value={bucket.points}
                onChange={(e) => {
                  const buckets = [...rule.buckets];
                  buckets[i] = { ...buckets[i], points: Number(e.target.value) };
                  onChange({ ...rule, buckets });
                }}
              />
              <span className="text-xs text-[#8688a0]">pts</span>
              <button
                type="button"
                aria-label="Remove range"
                className="btn btn-ghost px-2 text-[#b3b4c6] hover:text-[var(--danger)]"
                onClick={() =>
                  onChange({
                    ...rule,
                    buckets: rule.buckets.filter((_, idx) => idx !== i),
                  })
                }
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={() =>
              onChange({
                ...rule,
                buckets: [...rule.buckets, { min: null, max: null, points: 0 }],
              })
            }
          >
            + Add range
          </button>
          <p className="text-xs text-[#8688a0]">
            Leave min or max blank for &ldquo;unbounded&rdquo;. The first
            matching range wins.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="label whitespace-nowrap">Buckets</label>
            <select
              className="input w-20"
              value={rule.percentileScores.length}
              onChange={(e) => {
                const count = Number(e.target.value);
                const scores = Array.from({ length: count }, (_, i) => {
                  if (rule.percentileScores[i] !== undefined)
                    return rule.percentileScores[i];
                  return Math.round(((i + 1) / count) * 100);
                });
                onChange({
                  ...rule,
                  percentileBucketCount: count,
                  percentileScores: scores,
                });
              }}
            >
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          {rule.percentileScores.map((score, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-24 text-xs text-[#6b6d85]">{labels[i]}</span>
              <input
                type="number"
                min={-100}
                max={100}
                className="input w-24"
                value={score}
                onChange={(e) => {
                  const percentileScores = [...rule.percentileScores];
                  percentileScores[i] = Number(e.target.value);
                  onChange({ ...rule, percentileScores });
                }}
              />
              <span className="text-xs text-[#8688a0]">pts</span>
            </div>
          ))}
          <p className="text-xs text-[#8688a0]">
            Percentile edges are computed automatically from whatever data
            you upload, each time you run the model.
          </p>
        </div>
      )}
    </div>
  );
}
