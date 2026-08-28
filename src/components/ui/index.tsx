import type { ReactNode } from "react";

/**
 * The shared vocabulary every screen composes from.
 *
 * These exist so a page describes what it is showing rather than how to draw
 * it. The previous version styled each screen independently, which is why five
 * steps doing five different jobs all looked identical — nothing forced a
 * difference, and nothing forced consistency either.
 */

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------

/**
 * The heading block every screen opens with: what this is, what it is for, and
 * the action if there is one.
 */
export function PageHead({
  eyebrow,
  title,
  lede,
  action,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        {eyebrow && <p className="label mb-2">{eyebrow}</p>}
        <h1 className="h1">{title}</h1>
        {/* Capped tighter than the prose default so the action stays on this
            row at desktop widths instead of dropping under the text. */}
        {lede && <p className="lede mt-2.5 max-w-[52ch]">{lede}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A titled block of content. The title carries the meaning; the box is quiet. */
export function Section({
  title,
  hint,
  aside,
  children,
  className = "",
}: {
  title?: ReactNode;
  hint?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-5 sm:p-6 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            {title && <h2 className="h2">{title}</h2>}
            {hint && <p className="hint mt-1 max-w-[68ch]">{hint}</p>}
          </div>
          {aside && <div className="shrink-0">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type Tone = "neutral" | "primary" | "good" | "warn" | "bad";

export function Badge({
  tone = "neutral",
  children,
  onNavy = false,
}: {
  tone?: Tone;
  children: ReactNode;
  onNavy?: boolean;
}) {
  const cls = onNavy ? "badge-on-navy" : `badge-${tone}`;
  return <span className={`badge ${cls}`}>{children}</span>;
}

/**
 * A filled dot, for a status that is being scanned rather than read.
 *
 * Never the only signal — it always sits beside a word, because colour alone
 * fails for anyone who cannot distinguish these hues.
 */
export function StatusDot({ tone }: { tone: Tone }) {
  const color =
    tone === "good" ? "var(--accent)"
    : tone === "warn" ? "var(--warn)"
    : tone === "bad" ? "var(--danger)"
    : tone === "primary" ? "var(--primary)"
    : "var(--muted)";
  return (
    <span
      aria-hidden
      className="inline-block size-[7px] shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

/**
 * A problem and what to do about it.
 *
 * The action is required rather than optional: an alert that states a fault
 * without a next step just relocates the confusion.
 */
export function Alert({
  tone = "neutral",
  title,
  children,
  footnote,
}: {
  tone?: Tone;
  title?: ReactNode;
  children: ReactNode;
  footnote?: ReactNode;
}) {
  const cls =
    tone === "good" ? "alert-good"
    : tone === "warn" ? "alert-warn"
    : tone === "bad" ? "alert-bad"
    : tone === "primary" ? "alert-info"
    : "";
  const ink =
    tone === "good" ? "var(--accent)"
    : tone === "warn" ? "var(--warn)"
    : tone === "bad" ? "var(--danger)"
    : tone === "primary" ? "var(--primary)"
    : "var(--muted-strong)";

  return (
    <div className={`alert ${cls}`} role={tone === "bad" ? "alert" : undefined}>
      {title && (
        <p className="flex items-center gap-2 font-bold" style={{ color: ink }}>
          <StatusDot tone={tone} />
          {title}
        </p>
      )}
      <div className={title ? "mt-1 max-w-[70ch]" : "max-w-[70ch]"}>{children}</div>
      {footnote && <p className="hint mt-2">{footnote}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/**
 * One number, labelled. Mono and tabular, as every figure in this product is.
 */
export function Metric({
  label,
  value,
  hint,
  tone,
  size = "md",
  onNavy = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  onNavy?: boolean;
}) {
  const valueSize =
    size === "lg" ? "text-[1.75rem] leading-[1.1]"
    : size === "sm" ? "text-[0.9375rem]"
    : "text-[1.25rem]";
  const ink =
    tone === "good" ? "var(--accent)"
    : tone === "warn" ? "var(--warn)"
    : tone === "bad" ? "var(--danger)"
    : tone === "primary" ? "var(--primary)"
    : onNavy ? "var(--on-navy)"
    : "var(--foreground)";

  return (
    <div className="min-w-0">
      <p
        className="label"
        style={onNavy ? { color: "var(--on-navy-muted)" } : undefined}
      >
        {label}
      </p>
      <p className={`mono mt-1.5 font-bold ${valueSize}`} style={{ color: ink }}>
        {value}
      </p>
      {hint && (
        <p
          className="hint mt-1"
          style={onNavy ? { color: "var(--on-navy-muted)" } : undefined}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A label and a figure on one line, for a list of facts.
 *
 * Used wherever a screen is answering "what is currently true", which is most
 * of the operational surface.
 */
export function DataRow({
  label,
  value,
  hint,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const ink =
    tone === "good" ? "var(--accent)"
    : tone === "warn" ? "var(--warn)"
    : tone === "bad" ? "var(--danger)"
    : undefined;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 border-b border-[var(--border)] py-2.5 last:border-0">
      <span className="text-[0.8125rem] text-[var(--muted)]">{label}</span>
      <span className="flex items-baseline gap-2 text-right">
        <span className="mono text-[0.8125rem] font-semibold" style={ink ? { color: ink } : undefined}>
          {value}
        </span>
        {hint && <span className="hint">{hint}</span>}
      </span>
    </div>
  );
}

/** Empty state that says what is missing and what would fill it. */
export function Empty({
  title,
  body,
  action,
  children,
}: {
  title: ReactNode;
  body?: ReactNode;
  /** The way out. An empty state that names a fix should also offer it. */
  action?: ReactNode;
  children?: ReactNode;
}) {
  const text = body ?? children;
  return (
    <div className="well px-4 py-6 text-center">
      <p className="text-[0.875rem] font-semibold">{title}</p>
      {text && <p className="hint mx-auto mt-1 max-w-[52ch]">{text}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
