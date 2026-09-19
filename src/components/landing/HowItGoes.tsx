/**
 * The three steps, drawn rather than numbered.
 *
 * Three cards of prose with a digit on each said nothing a visitor could not
 * get from the FAQ. Each step carries an illustration of the thing it does:
 * a CRM record becoming bars of different heights, three priced leads
 * flowing into one conversion action, a click ID riding along a lead's
 * journey. A hairline joins the numbers across the row on a wide screen, so
 * the three read as a sequence and not as three unrelated boxes.
 *
 * The drawings are SVG files under public/how, drawn in the brand blue and
 * the ink greys. They are decorative: the title and body under each say
 * what it shows, so the image carries no alt text of its own.
 */

const STAGES = [
  {
    n: "1",
    title: "Measure",
    body: "Upload a CRM export. AI reads your columns and your description of a good lead, then the values come from your own win rates and deal sizes. Nothing invented.",
    art: "/how/measure.svg",
  },
  {
    n: "2",
    title: "Connect",
    body: "Connect Google Ads. One conversion action is created and every lead is sent to it with its own value, new ones as they arrive.",
    art: "/how/connect.svg",
  },
  {
    n: "3",
    title: "Improve",
    body: "A one-line script keeps the ad click ID attached to every future lead, so more of them can be matched at all.",
    art: "/how/improve.svg",
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
            <span className="mono relative z-10 flex size-8 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[13px] font-bold text-[var(--primary-deep)] ring-4 ring-[var(--surface)]">
              {s.n}
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG needs no optimiser */}
            <img
              src={s.art}
              alt=""
              width={240}
              height={120}
              loading="lazy"
              decoding="async"
              className="mx-auto mt-3 h-auto w-full max-w-[240px]"
            />
            <p className="mt-2 text-[16px] font-semibold tracking-[-.015em]">{s.title}</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--muted)]">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
