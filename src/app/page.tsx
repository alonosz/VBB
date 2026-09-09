import Link from "next/link";
import { ArrowIcon } from "@/components/ArrowIcon";
import { Logo } from "@/components/brand/Logo";
import { SiteFooter } from "@/components/legal/SiteFooter";
import { WorkspaceReadyBar } from "@/components/workspace/WorkspaceReadyBar";

/**
 * What this is, before anyone is asked to do anything.
 *
 * The root used to redirect straight into step 1 of a wizard, which meant a
 * marketer's first screen was a textarea with no idea what they were about to
 * get or how long it would take.
 *
 * The hero states the problem and shows it. The shape on the right is the same
 * comparison the report makes with real numbers - flat grey for one value
 * repeated, brand blue for values that differ - so the promise here and the
 * payoff there are visibly the same thing. It carries no figures and says so:
 * there is no data yet, and inventing some to decorate a landing page is the
 * exact failure the product exists to avoid.
 */

const STAGES = [
  {
    n: "1",
    title: "Measure",
    body: "Upload a CRM export. AI reads your columns and your description of a good lead, then the values come from your own win rates and deal sizes. Nothing invented.",
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

/**
 * Five questions. The qualifying one sits second, so a visitor learns early
 * whether this is for them and reads the rest knowing it.
 * Every answer is true of the product as built; none promises a result.
 */
const FAQ = [
  {
    q: "Why bid on value instead of conversions?",
    a: "Google can only optimise for what you tell it. Tell it every lead is worth the same and it buys the cheapest ones. Tell it what each lead is likely to be worth and it buys the ones that pay.",
  },
  {
    q: "Is my account ready for this?",
    a: "Three things need to be true. Roughly 30 to 50 conversions a month per campaign, which is Google's own guidance for value-based bidding. A year of CRM history with a few hundred closed leads, so the tool has about 25 closed deals in each group it prices. And real differences between your leads: this suits insurance, lending, legal, home services, education and B2B software, and not a single product at a single price.",
  },
  {
    q: "Where do the values come from?",
    a: "From your own history: how often each kind of lead closed, times what it was worth when it did. AI reads your file and your description. It never sets a number.",
  },
  {
    q: "What happens in my Google Ads account?",
    a: "One conversion action is created, called VBB Lead Value, and each lead is sent to it with its own value. Nothing else is touched. Switching a campaign to value-based bidding is a change you make, and we show you where.",
  },
  {
    q: "How will I know it worked?",
    a: "Once connected, the tool keeps reading your CRM and compares the leads Google buys after the switch against the ones before, measured in real outcomes, not in the numbers we sent.",
  },
];


const NEEDED = [
  "A CSV of deals from your CRM - HubSpot, Salesforce, Pipedrive, Close, or a plain spreadsheet.",
  "Create dates and deal amounts in it. Close dates and email addresses make the analysis sharper.",
  "Access to your Google Ads account, for the last step.",
];

/**
 * Fixed heights rather than random ones: the page is server-rendered, and a
 * shape that changes between the server and the browser is a hydration
 * mismatch dressed up as a chart.
 */
const SHAPE = [34, 52, 41, 78, 46, 96, 38, 61, 44, 87, 55, 70, 40, 100, 48, 63];

export default function Home() {
  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <header className="page-wide flex items-center justify-between gap-4 py-5">
        <Logo size={34} showDotCom />
        <Link href="/diagnostic" className="btn btn-secondary btn-sm">
          Start
        </Link>
      </header>

      {/*
        Only rendered for somebody who arrived on an invite. Everyone else sees
        the page exactly as it was.
      */}
      <WorkspaceReadyBar />

      <main className="flex-1">
        {/* ---------------------------------------------------------------- */}
        {/* Hero                                                              */}
        {/* ---------------------------------------------------------------- */}
        <div className="page-wide">
          <section className="panel-navy overflow-hidden">
            <div className="grid items-center gap-8 p-7 sm:p-9 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)] lg:gap-12 lg:p-11">
              <div className="min-w-0">
                <p className="label" style={{ color: "var(--on-navy-muted)" }}>
                  Feed Google&apos;s AI the signal it is missing
                </p>

                <h1
                  className="display mt-4 max-w-[16ch]"
                  style={{ color: "var(--on-navy)" }}
                >
                  Google Ads thinks all your leads are worth the same.
                </h1>

                <p
                  className="lede mt-5 max-w-[54ch]"
                  style={{ color: "var(--on-navy-muted)" }}
                >
                  When every form fill counts the same, a dead-end enquiry looks as
                  valuable as your next premium customer. Use your sales history and
                  AI to teach Google which leads are likely to be worth more, with
                  lead values sent directly to Google Ads.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
                  <Link
                    href="/diagnostic"
                    className="btn btn-primary btn-lg btn-wrap w-full sm:w-auto"
                  >
                    Train Google to hunt high-value leads <ArrowIcon />
                  </Link>
                  <span
                    className="text-[13px]"
                    style={{ color: "var(--on-navy-muted)" }}
                  >
                    About 5 minutes · no CRM data is stored
                  </span>
                </div>
              </div>

              {/* The comparison, with no numbers on it. */}
              <figure className="min-w-0">
                <div className="rounded-[var(--radius-lg)] border border-[var(--navy-line)] bg-black/25 p-5 sm:p-6">
                  <figcaption className="mb-5 flex items-center justify-between gap-3">
                    <span
                      className="text-[12.5px] font-bold"
                      style={{ color: "var(--on-navy-muted)" }}
                    >
                      One value per lead, or the real ones
                    </span>
                    <span className="badge badge-on-navy">Illustration</span>
                  </figcaption>

                  <p
                    className="label mb-2"
                    style={{ color: "var(--on-navy-faint)" }}
                  >
                    What Google gets today
                  </p>
                  <div className="flex h-10 items-end gap-[2px]" aria-hidden>
                    {SHAPE.map((_, i) => (
                      <div key={i} className="bar-flat h-3/5 flex-1" />
                    ))}
                  </div>

                  <p
                    className="label mb-2 mt-6"
                    style={{ color: "var(--on-navy-muted)" }}
                  >
                    What it could get
                  </p>
                  <div className="flex h-24 items-end gap-[3px]" aria-hidden>
                    {SHAPE.map((h, i) => (
                      <div
                        key={i}
                        className="bar flex-1"
                        style={{
                          height: `${h}%`,
                          background:
                            "linear-gradient(180deg, var(--primary-on-navy) 0%, var(--primary) 100%)",
                        }}
                      />
                    ))}
                  </div>

                  <p
                    className="mt-5 text-[12px]"
                    style={{ color: "var(--on-navy-faint)" }}
                  >
                    A shape, not your data. Your own numbers appear in step 4.
                  </p>
                </div>
              </figure>
            </div>
          </section>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* How it goes                                                       */}
        {/* ---------------------------------------------------------------- */}
        <section className="page-wide pt-16">
          <h2 className="h2">How it goes</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {STAGES.map((s) => (
              <div key={s.n} className="card card-hover p-6">
                <span className="mono flex size-8 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[13px] font-bold text-[var(--primary-deep)]">
                  {s.n}
                </span>
                <p className="mt-4 text-[16px] font-bold">{s.title}</p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--muted)]">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* What you'll need, and what leaves your machine                    */}
        {/* ---------------------------------------------------------------- */}
        <section className="page-wide grid gap-4 pt-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
          <div className="card p-6 sm:p-7">
            <h2 className="h3">What you&apos;ll need</h2>
            <ul className="mt-4 grid gap-3 text-[14px]">
              {NEEDED.map((line) => (
                <li key={line} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-[3px] flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent)]"
                  >
                    ✓
                  </span>
                  <span className="max-w-[62ch] text-[var(--muted-strong)]">
                    {line}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="well p-6 sm:p-7">
            <h2 className="h3">What leaves your machine</h2>
            <p className="mt-3 max-w-[52ch] text-[14px] leading-relaxed text-[var(--muted)]">
              Your file is read in your browser and never uploaded. Only the finished
              values Google receives - hashed identifiers, timestamps and amounts - are
              ever stored, and never a name, an address or a deal size.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Questions                                                         */}
        {/* ---------------------------------------------------------------- */}
        <section className="page-wide pt-14">
          <h2 className="h2">Questions</h2>
          <div className="card mt-5 divide-y divide-[var(--border)] px-6 sm:px-7">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-bold [&::-webkit-details-marker]:hidden">
                  <span>{item.q}</span>
                  <span
                    aria-hidden
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[14px] font-bold text-[var(--primary-deep)] transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-2.5 max-w-[68ch] text-[14px] leading-relaxed text-[var(--muted)]">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        <section className="page-wide pb-24 pt-8">
          <p className="text-[13.5px] text-[var(--muted)]">
            No export handy?{" "}
            <Link
              href="/diagnostic"
              className="font-semibold text-[var(--primary)] underline underline-offset-[3px] hover:text-[var(--primary-hover)]"
            >
              Try it on a sample dataset
            </Link>{" "}
            - 500 synthetic deals, the whole flow end to end.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
