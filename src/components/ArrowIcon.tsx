export function ArrowIcon({ variant = "onPrimary" }: { variant?: "onPrimary" | "onLight" }) {
  const bg = variant === "onPrimary" ? "rgba(255,255,255,0.22)" : "var(--primary-soft)";
  const fg = variant === "onPrimary" ? "white" : "var(--primary)";

  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
      style={{ background: bg }}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path
          d="M2.5 6H9.5M9.5 6L6.5 3M9.5 6L6.5 9"
          stroke={fg}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
