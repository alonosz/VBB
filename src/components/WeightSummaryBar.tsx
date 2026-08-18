import type { RuleBlock } from "@/lib/types";

export function WeightSummaryBar({
  blocks,
  onNormalize,
}: {
  blocks: RuleBlock[];
  onNormalize: () => void;
}) {
  const active = blocks.filter((b) => b.enabled);
  const total = active.reduce((s, b) => s + b.weight, 0);
  const isBalanced = total === 100;
  const isOver = total > 100;

  return (
    <div className="card sticky top-[61px] z-10 flex items-center gap-4 px-4 py-3">
      <div className="flex-1">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="font-semibold text-[#6b6d85]">Total weight</span>
          <span
            className={
              "font-bold tabular-nums " +
              (isBalanced
                ? "text-[var(--accent)]"
                : isOver
                ? "text-[var(--danger)]"
                : "text-[var(--warn)]")
            }
          >
            {total}%{" "}
            {isBalanced ? "· balanced" : isOver ? "· over 100%" : "· under 100%"}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[#eceeF7]">
          <div
            className={
              "h-full rounded-full transition-all duration-200 " +
              (isBalanced
                ? "bg-[var(--accent)]"
                : isOver
                ? "bg-[var(--danger)]"
                : "bg-[var(--warn)]")
            }
            style={{ width: `${Math.min(100, total)}%` }}
          />
        </div>
      </div>
      {!isBalanced && active.length > 0 && (
        <button type="button" onClick={onNormalize} className="btn btn-secondary shrink-0 text-xs">
          Normalize to 100%
        </button>
      )}
    </div>
  );
}
