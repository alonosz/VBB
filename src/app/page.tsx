import Link from "next/link";
import { ArrowIcon } from "@/components/ArrowIcon";
import { Logo } from "@/components/brand/Logo";

/**
 * What this is, before anyone is asked to do anything.
 *
 * The root used to redirect straight into step 1 of a wizard, which meant a
 * marketer's first screen was a textarea with no idea what they were about to
 * get or how long it would take. Two paragraphs and a list of what you need
 * costs one click and removes that.
 */

const STAGES = [
  {
    n: "1",
    title: "Measure",
    body: "Upload a CRM export. We work out what your leads were actually worth from your own closed deals — win rates and deal sizes, nothing invented.",
  },
  {
    n: "2",
    title: "Connect",
    body: "Send those values to Google Ads as a URL it fetches on a schedule, so nobody uploads a file again.",
  },
  {
    n: "3",
    title: "Improve",
    body: "A one-line script keeps the ad click ID attached to every future lead, so more of them can be matched at all.",
  },
];

export default function Home() {
  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <Logo size={44} showDotCom />

        <h1 className="mt-8 max-w-[20ch] text-[clamp(30px,5vw,46px)] font-extrabold leading-[1.08] tracking-[-.03em] text-balance">
          Google Ads thinks all your leads are worth the same.
        </h1>
        <p className="mt-4 max-w-[62ch] text-[17px] leading-relaxed text-[var(--muted)]">
          They aren&apos;t. Some close for six figures and some never answer the phone,
          and Smart Bidding is optimising as though there&apos;s no difference. This
          works out what each lead is really worth from your own closed deals, then
          feeds those numbers back to Google so it bids for the ones that pay.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/diagnostic" className="btn btn-primary">
            Train Google to hunt high-value revenue <ArrowIcon />
          </Link>
          <span className="text-[13.5px] text-[var(--muted)]">
            About 5 minutes · start from a CRM export · no account needed
          </span>
        </div>

        <section className="mt-14">
          <p className="label mb-4">How it goes</p>
          <div className="grid gap-3">
            {STAGES.map((s) => (
              <div key={s.n} className="card flex gap-4 p-5">
                <span className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[13px] font-bold text-[var(--primary)]">
                  {s.n}
                </span>
                <div>
                  <p className="text-[15px] font-bold">{s.title}</p>
                  <p className="mt-1 max-w-[64ch] text-[14px] leading-relaxed text-[var(--muted)]">
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 rounded-2xl border border-[var(--border)] bg-white p-6">
          <p className="text-[15px] font-bold">What you&apos;ll need</p>
          <ul className="mt-3 grid gap-2 text-[14px] text-[var(--muted)]">
            {[
              "A CSV of deals from your CRM — HubSpot, Salesforce, Pipedrive, Close, or a plain spreadsheet.",
              "Create dates and deal amounts in it. Close dates and email addresses make the analysis sharper.",
              "Access to your Google Ads account, for the last step.",
            ].map((line) => (
              <li key={line} className="flex gap-2.5">
                <span className="text-[var(--accent)]">✓</span>
                <span className="max-w-[66ch]">{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-[66ch] border-t border-[var(--border)] pt-3.5 text-[13px] text-[var(--muted)]">
            Your file is read in your browser and never uploaded. Only the finished
            values Google receives — hashed identifiers, timestamps and amounts — are
            ever stored, and never a name, an address or a deal size.
          </p>
        </section>

        <p className="mt-10 text-[13px] text-[var(--muted)]">
          No export handy?{" "}
          <Link
            href="/diagnostic"
            className="font-semibold text-[var(--primary)] underline underline-offset-[3px]"
          >
            Try it on a sample dataset
          </Link>{" "}
          — 500 synthetic deals, the whole flow end to end.
        </p>
      </main>
    </div>
  );
}
