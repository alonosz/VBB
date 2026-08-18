import { TEMPLATES } from "@/lib/templates";

export function TemplateGallery({
  onSelect,
}: {
  onSelect: (templateId: string) => void;
}) {
  return (
    <div className="card p-5">
      <p className="text-sm font-semibold">Start from a template</p>
      <p className="mt-1 text-xs text-[#8688a0]">
        Load a starter model and customize it, or skip this and add rule
        blocks yourself below.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className="flex flex-col items-start gap-1 rounded-xl border border-[var(--border)] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--primary)] hover:shadow-md"
          >
            <span className="text-sm font-semibold">{t.name}</span>
            <span className="text-xs text-[#8688a0]">{t.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
