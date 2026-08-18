"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { RuleBlock, RuleDetail } from "@/lib/types";
import { RULE_TYPE_META } from "@/lib/blockDefaults";
import { ValueTierEditor } from "@/components/blocks/ValueTierEditor";
import { NumericBucketEditor } from "@/components/blocks/NumericBucketEditor";
import { BooleanFlagEditor } from "@/components/blocks/BooleanFlagEditor";
import { TimeDecayEditor } from "@/components/blocks/TimeDecayEditor";

export function RuleBlockCard({
  block,
  headers,
  index,
  onChange,
  onRemove,
}: {
  block: RuleBlock;
  headers: string[];
  index: number;
  onChange: (block: RuleBlock) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });

  const meta = RULE_TYPE_META[block.rule.type];

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function updateRule(rule: RuleDetail) {
    onChange({ ...block, rule });
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        "card animate-block-enter overflow-hidden " +
        (isDragging ? "opacity-60 shadow-xl ring-2 ring-[var(--primary)]" : "") +
        (block.enabled ? "" : " opacity-60")
      }
    >
      <div className="flex items-start gap-3 border-b border-[var(--border)] px-4 py-3">
        <button
          type="button"
          aria-label="Drag to reorder"
          className="mt-0.5 cursor-grab touch-none text-[#c7c8d6] hover:text-[#8688a0] active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>

        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-sm">
          {meta.icon}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#8688a0]">
              Step {index + 1} · {meta.label}
            </span>
          </div>
          <input
            className="mt-0.5 w-full truncate border-none bg-transparent p-0 text-sm font-semibold outline-none focus:ring-0"
            value={block.label}
            onChange={(e) => onChange({ ...block, label: e.target.value })}
          />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onChange({ ...block, enabled: !block.enabled })}
            title={block.enabled ? "Disable block" : "Enable block"}
            className={
              "relative h-5 w-9 rounded-full transition-colors " +
              (block.enabled ? "bg-[var(--accent)]" : "bg-[#dcdde8]")
            }
          >
            <span
              className={
                "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform " +
                (block.enabled ? "translate-x-4" : "translate-x-0.5")
              }
            />
          </button>
          <button
            type="button"
            aria-label="Remove block"
            onClick={onRemove}
            className="btn btn-ghost px-2 text-[#b3b4c6] hover:text-[var(--danger)]"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {block.rule.type === "value_tier" && (
          <ValueTierEditor rule={block.rule} headers={headers} onChange={updateRule} />
        )}
        {block.rule.type === "numeric_bucket" && (
          <NumericBucketEditor rule={block.rule} headers={headers} onChange={updateRule} />
        )}
        {block.rule.type === "boolean_flag" && (
          <BooleanFlagEditor rule={block.rule} headers={headers} onChange={updateRule} />
        )}
        {block.rule.type === "time_decay" && (
          <TimeDecayEditor rule={block.rule} headers={headers} onChange={updateRule} />
        )}

        <div className="flex items-center gap-3 border-t border-[var(--border)] pt-3">
          <label className="label whitespace-nowrap">Weight</label>
          <input
            type="range"
            min={0}
            max={100}
            value={block.weight}
            onChange={(e) => onChange({ ...block, weight: Number(e.target.value) })}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[#e6e7f2] accent-[var(--primary)]"
          />
          <span className="w-12 text-right text-sm font-semibold tabular-nums">
            {block.weight}%
          </span>
        </div>
      </div>
    </div>
  );
}
