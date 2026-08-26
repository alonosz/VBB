/**
 * The ValueBasedBidding mark and wordmark.
 *
 * Drawn as SVG rather than shipped as an image so it stays sharp at any size,
 * inherits the brand tokens, and needs no network request in the app header.
 *
 * The violet in the mark is the one brand value not defined anywhere in code —
 * it is `--brand-violet` in globals.css, currently an estimate read off the
 * logo artwork. Replace that one token with the real hex and every use of the
 * mark updates.
 */

export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 46"
      fill="none"
      className={className}
      role="img"
      aria-label="ValueBasedBidding"
    >
      {/*
        Drawn as two round-capped strokes rather than filled outlines: the mark
        is two bars of equal weight, one of which hooks, and a stroke keeps that
        weight identical without hand-matching two sets of curves.
      */}
      <g strokeWidth="11" strokeLinecap="round" fill="none">
        {/* The shorter violet bar, sitting left and finishing higher. */}
        <path d="M9 9V26" stroke="var(--brand-violet)" />
        {/* The blue J: a longer stem hooking left at the foot. */}
        <path d="M29 9v14a10 10 0 0 1-10 10h-1" stroke="var(--primary)" />
      </g>
    </svg>
  );
}

/**
 * Full lockup. `.com` is part of the identity on the marketing site; inside the
 * app the product is the thing you are using, not the address you came from, so
 * the header drops it.
 */
export function Logo({
  size = 28,
  showDotCom = false,
  className = "",
}: {
  size?: number;
  showDotCom?: boolean;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      <span
        className="font-extrabold tracking-[-.03em] text-[var(--primary)]"
        style={{ fontSize: size * 0.62 }}
      >
        ValueBasedBidding
        {showDotCom && <span className="font-bold">.com</span>}
      </span>
    </span>
  );
}
