/**
 * The ValueBasedBidding mark and wordmark.
 *
 * Drawn as SVG rather than shipped as an image so it stays sharp at any size,
 * needs no network request in the app header, and can pick up the brand tokens.
 *
 * The mark is two overlapping leaf forms: a flat violet one behind, and a
 * gradient blue "J" in front whose foot sweeps left and tapers to a point. The
 * gradient is part of the identity — a flat fill reads as a different logo.
 *
 * Colours here were read off the artwork, not taken from a brand file. They
 * live in `--brand-violet`, `--brand-mark-from` and `--brand-mark-to` in
 * globals.css; replacing those three updates every use of the mark.
 */

/**
 * Every instance of the mark uses the same gradient, so they can share one id.
 * A counter incremented during render would be a side effect, and useId is not
 * available here because the mark renders inside server components. Callers
 * needing a distinct id — an inlined mark in an exported SVG, say — can pass
 * one.
 */
export function LogoMark({
  size = 28,
  className = "",
  gradientId = "vbb-mark-gradient",
}: {
  size?: number;
  className?: string;
  gradientId?: string;
}) {
  const id = gradientId;

  return (
    <svg
      width={(size * 30) / 48}
      height={size}
      viewBox="0 0 30 48"
      fill="none"
      className={className}
      role="img"
      aria-label="ValueBasedBidding"
    >
      <defs>
        <linearGradient id={id} x1="27" y1="4" x2="6" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--brand-mark-from)" />
          <stop offset="1" stopColor="var(--brand-mark-to)" />
        </linearGradient>
      </defs>

      {/* The violet leaf behind: flat right edge where the blue overlaps it,
          rounded away to the left. */}
      <path
        d="M13 12.5H8.6A6.6 6.6 0 0 0 2 19.1v13.3a6.6 6.6 0 0 0 6.6 6.6H13V12.5Z"
        fill="var(--brand-violet)"
      />

      {/* The blue J in front: a rounded leaf tip at the top, then a foot that
          sweeps left and tapers to a point rather than ending in a cap. */}
      <path
        d="M27 9.5C27 6.46 24.54 4 21.5 4h-3C15.46 4 13 6.46 13 9.5V30.6C13 38.4 9.3 43.4 4.6 47h3.8C18.7 47 27 38.7 27 28.4V9.5Z"
        fill={`url(#${id})`}
      />
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
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span
        className="font-extrabold tracking-[-.035em] text-[var(--brand-wordmark)]"
        style={{ fontSize: size * 0.56 }}
      >
        ValueBasedBidding
        {showDotCom && <span className="text-[var(--primary)]">.com</span>}
      </span>
    </span>
  );
}
