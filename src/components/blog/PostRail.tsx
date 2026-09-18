"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A row of cards that scrolls sideways.
 *
 * Three fit across a laptop and the rest sit off the right edge, reached by
 * scrolling, by swiping, or by the two arrows. The browser does the moving
 * with scroll snapping, so the only JavaScript here decides whether the
 * arrows have anywhere to go. On a phone one card fills most of the width
 * and the next one shows its edge, which is the whole hint anyone needs.
 */
export function PostRail({ children }: { children: ReactNode[] }) {
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setEdge({
        start: el.scrollLeft <= 1,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
      });
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, []);

  const step = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const by = card ? card.getBoundingClientRect().width + 16 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * by, behavior: "smooth" });
  };

  const arrow = (dir: 1 | -1, disabled: boolean, label: string) => (
    <button
      type="button"
      onClick={() => step(dir)}
      disabled={disabled}
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:cursor-default disabled:opacity-35 disabled:hover:border-[var(--border-strong)] disabled:hover:text-[var(--foreground)]"
    >
      <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path
          d={dir === 1 ? "M2.5 6H9.5M9.5 6L6.5 3M9.5 6L6.5 9" : "M9.5 6H2.5M2.5 6L5.5 3M2.5 6L5.5 9"}
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );

  const scrollable = !(edge.start && edge.end);

  return (
    <div className="relative">
      <ul
        ref={ref}
        className="rail mt-5 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-2"
      >
        {children.map((child, i) => (
          <li key={i} className="w-[84%] shrink-0 snap-start sm:w-[60%] md:w-[calc((100%-2rem)/3)]">
            {child}
          </li>
        ))}
      </ul>
      {scrollable && (
        <div className="mt-3 flex justify-end gap-2">
          {arrow(-1, edge.start, "Previous articles")}
          {arrow(1, edge.end, "Next articles")}
        </div>
      )}
    </div>
  );
}
