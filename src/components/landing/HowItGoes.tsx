/**
 * The three steps, drawn rather than numbered.
 *
 * Three cards of prose with a digit on each said nothing a visitor could not
 * get from the FAQ. Each step now carries a small line drawing of the thing
 * it does, in the same vocabulary as the hero: rows of a file becoming bars
 * of different heights, values converging on a bidding target, a click ID
 * tagged onto a lead. A hairline joins the three on a wide screen, so the
 * row reads as a sequence and not as three unrelated boxes.
 *
 * Everything is a token: the drawings pick up the brand blue and the ink
 * greys from the stylesheet, so a palette change reaches them too.
 */

const STROKE = { fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** A CRM export on the left, the spread of values it contains on the right. */
function MeasureGlyph() {
  const bars = [14, 30, 20, 40, 26];
  return (
    <svg viewBox="0 0 160 56" className="h-14 w-40" aria-hidden>
      <rect x="6" y="8" width="52" height="40" rx="7" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="1.5" />
      {[18, 28, 38].map((y, i) => (
        <line key={y} x1="14" y1={y} x2={[50, 42, 46][i]} y2={y} stroke="var(--border-strong)" {...STROKE} />
      ))}
      <path d="M66 28h18m-6-6l6 6-6 6" stroke="var(--muted)" {...STROKE} />
      {bars.map((h, i) => (
        <rect key={i} x={96 + i * 12} y={48 - h} width="8" height={h} rx="2" fill="var(--primary)" />
      ))}
    </svg>
  );
}

/** Three priced leads, each on its own path into one bidding target. */
function ConnectGlyph() {
  const ys = [12, 28, 44];
  return (
    <svg viewBox="0 0 160 56" className="h-14 w-40" aria-hidden>
      {ys.map((y) => (
        <path key={y} d={`M38 ${y} C 68 ${y}, 68 28, 98 28`} stroke="var(--primary)" strokeOpacity=".45" {...STROKE} strokeWidth="1.5" />
      ))}
      {ys.map((y) => (
        <g key={y}>
          <rect x="6" y={y - 6} width="32" height="12" rx="6" fill="var(--primary-soft)" />
          <text x="22" y={y + 3.5} textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--primary-deep)" className="mono">
            $
          </text>
        </g>
      ))}
      <rect x="98" y="12" width="56" height="32" rx="9" fill="var(--surface)" stroke="var(--primary)" strokeWidth="1.5" />
      <circle cx="126" cy="28" r="8" stroke="var(--primary)" {...STROKE} strokeWidth="1.5" />
      <circle cx="126" cy="28" r="2.5" fill="var(--primary)" />
    </svg>
  );
}

/** A lead record with the click ID pinned to its corner. */
function ImproveGlyph() {
  return (
    <svg viewBox="0 0 160 56" className="h-14 w-40" aria-hidden>
      <rect x="8" y="12" width="96" height="36" rx="8" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="1.5" />
      <circle cx="26" cy="30" r="7" fill="var(--primary-soft)" />
      <line x1="42" y1="25" x2="88" y2="25" stroke="var(--border-strong)" {...STROKE} />
      <line x1="42" y1="35" x2="74" y2="35" stroke="var(--border-strong)" {...STROKE} />
      <rect x="92" y="4" width="60" height="20" rx="10" fill="var(--primary)" stroke="var(--surface)" strokeWidth="3" />
      <text x="122" y="17.5" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#fff" className="mono">
        gclid
      </text>
    </svg>
  );
}

const STAGES = [
  {
    n: "1",
    title: "Measure",
    body: "Upload a CRM export. AI reads your columns and your description of a good lead, then the values come from your own win rates and deal sizes. Nothing invented.",
    glyph: <MeasureGlyph />,
  },
  {
    n: "2",
    title: "Connect",
    body: "Connect Google Ads. One conversion action is created and every lead is sent to it with its own value, new ones as they arrive.",
    glyph: <ConnectGlyph />,
  },
  {
    n: "3",
    title: "Improve",
    body: "A one-line script keeps the ad click ID attached to every future lead, so more of them can be matched at all.",
    glyph: <ImproveGlyph />,
  },
];

export function HowItGoes() {
  return (
    <section className="page-wide pt-16">
      <h2 className="h2">How it goes</h2>
      <ol className="relative mt-5 grid gap-4 md:grid-cols-3">
        {/*
          The line through the step numbers. Drawn once behind the row on a
          wide screen; on a phone the cards stack and the digits carry the order.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-[16.67%] right-[16.67%] top-[calc(1.5rem+16px)] hidden h-px bg-[var(--border-strong)] md:block"
        />
        {STAGES.map((s) => (
          <li key={s.n} className="card card-hover relative p-6">
            <div className="flex items-start justify-between gap-4">
              <span className="mono relative z-10 flex size-8 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[13px] font-bold text-[var(--primary-deep)] ring-4 ring-[var(--surface)]">
                {s.n}
              </span>
              <div className="-mr-1 -mt-1">{s.glyph}</div>
            </div>
            <p className="mt-4 text-[16px] font-bold">{s.title}</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--muted)]">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
