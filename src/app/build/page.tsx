"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useAppState } from "@/context/AppStateContext";
import { StepHeader } from "@/components/StepHeader";
import { RuleBlockCard } from "@/components/RuleBlockCard";
import { WeightSummaryBar } from "@/components/WeightSummaryBar";
import { LivePreviewPanel } from "@/components/LivePreviewPanel";
import { TemplateGallery } from "@/components/TemplateGallery";
import { createDefaultBlock, RULE_TYPE_META } from "@/lib/blockDefaults";
import { TEMPLATES } from "@/lib/templates";
import type { ModelConfig, RuleBlock, RuleType } from "@/lib/types";
import { MODEL_FORMAT_VERSION } from "@/lib/types";

function blankModel(): ModelConfig {
  return {
    formatVersion: MODEL_FORMAT_VERSION,
    name: "",
    createdAt: new Date().toISOString(),
    blocks: [],
  };
}

export default function BuildPage() {
  const router = useRouter();
  const { csvData, model, setModel } = useAppState();
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  useEffect(() => {
    if (!csvData) {
      router.replace("/upload");
      return;
    }
    if (!model) setModel(blankModel());
  }, [csvData, model, router, setModel]);

  if (!csvData || !model) return null;

  function updateBlocks(blocks: RuleBlock[]) {
    setModel({ ...model!, blocks });
  }

  function handleAddBlock(type: RuleType) {
    const block = createDefaultBlock(type, csvData!.headers, csvData!.rows.slice(0, 25));
    const currentTotal = model!.blocks
      .filter((b) => b.enabled)
      .reduce((s, b) => s + b.weight, 0);
    block.weight = Math.max(0, Math.min(100, 100 - currentTotal));
    updateBlocks([...model!.blocks, block]);
    setAddMenuOpen(false);
  }

  function handleRemoveBlock(id: string) {
    updateBlocks(model!.blocks.filter((b) => b.id !== id));
  }

  function handleChangeBlock(updated: RuleBlock) {
    updateBlocks(model!.blocks.map((b) => (b.id === updated.id ? updated : b)));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = model!.blocks.findIndex((b) => b.id === active.id);
    const newIndex = model!.blocks.findIndex((b) => b.id === over.id);
    updateBlocks(arrayMove(model!.blocks, oldIndex, newIndex));
  }

  function handleNormalize() {
    const active = model!.blocks.filter((b) => b.enabled);
    const total = active.reduce((s, b) => s + b.weight, 0);
    if (active.length === 0) return;

    let scaled: number[];
    if (total <= 0) {
      const even = Math.floor(100 / active.length);
      scaled = active.map(() => even);
      scaled[scaled.length - 1] += 100 - even * active.length;
    } else {
      scaled = active.map((b) => Math.round((b.weight / total) * 100));
      const diff = 100 - scaled.reduce((s, n) => s + n, 0);
      scaled[scaled.length - 1] += diff;
    }

    let i = 0;
    updateBlocks(
      model!.blocks.map((b) => {
        if (!b.enabled) return b;
        const weight = scaled[i];
        i += 1;
        return { ...b, weight };
      })
    );
  }

  function handleUseTemplate(templateId: string) {
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    setModel({
      ...model!,
      blocks: template.build(csvData!.headers),
      name: model!.name || template.name,
    });
  }

  const hasEnabledBlocks = model.blocks.some((b) => b.enabled);

  return (
    <div className="flex min-h-screen flex-col">
      <StepHeader current="build" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Build your scoring model</h1>
            <p className="mt-1 text-sm text-[#6b6d85]">
              Stack rule blocks to score each record. Drag to reorder, adjust
              weights, and watch the live preview update instantly.
            </p>
          </div>
          <div className="w-full max-w-xs sm:w-64">
            <label className="label">Model name</label>
            <input
              className="input mt-1"
              placeholder="e.g. Q1 2026 Lead Score Model"
              value={model.name}
              onChange={(e) => setModel({ ...model, name: e.target.value })}
            />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            {model.blocks.length === 0 && (
              <TemplateGallery onSelect={handleUseTemplate} />
            )}

            {model.blocks.length > 0 && (
              <WeightSummaryBar blocks={model.blocks} onNormalize={handleNormalize} />
            )}

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={model.blocks.map((b) => b.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-4">
                  {model.blocks.map((block, i) => (
                    <RuleBlockCard
                      key={block.id}
                      block={block}
                      headers={csvData.headers}
                      index={i}
                      onChange={handleChangeBlock}
                      onRemove={() => handleRemoveBlock(block.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <div className="relative">
              <button
                type="button"
                onClick={() => setAddMenuOpen((v) => !v)}
                className="btn btn-secondary w-full justify-center border-dashed py-3"
              >
                + Add rule block
              </button>
              {addMenuOpen && (
                <div className="card absolute left-0 right-0 top-full z-10 mt-2 grid gap-1 p-2 sm:grid-cols-2">
                  {(Object.keys(RULE_TYPE_META) as RuleType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleAddBlock(type)}
                      className="flex items-start gap-2 rounded-lg p-2.5 text-left hover:bg-[var(--primary-soft)]"
                    >
                      <span className="text-lg">{RULE_TYPE_META[type].icon}</span>
                      <span>
                        <span className="block text-sm font-semibold">
                          {RULE_TYPE_META[type].label}
                        </span>
                        <span className="block text-xs text-[#8688a0]">
                          {RULE_TYPE_META[type].description}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={!hasEnabledBlocks}
                onClick={() => router.push("/summary")}
                className="btn btn-primary"
                title={
                  hasEnabledBlocks ? undefined : "Add at least one rule block first"
                }
              >
                Continue to summary →
              </button>
            </div>
          </div>

          <div>
            <LivePreviewPanel csvData={csvData} model={model} />
          </div>
        </div>
      </main>
    </div>
  );
}
