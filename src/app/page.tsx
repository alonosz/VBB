import Link from "next/link";
import { ArrowIcon } from "@/components/ArrowIcon";
import { Logo } from "@/components/brand/Logo";
import { SiteFooter } from "@/components/legal/SiteFooter";
import { WorkspaceReadyBar } from "@/components/workspace/WorkspaceReadyBar";
import { AccountLink } from "@/components/workspace/AccountLink";
import { PostCard } from "@/components/blog/PostCard";
import { HowItGoes } from "@/components/landing/HowItGoes";
import { listPosts } from "@/lib/blog/posts";

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


/**
 * Six questions. The qualifying one sits second, so a visitor learns early
 * whether this is for them and reads the rest knowing it.
 * Every answer is true of the product as built; none promises a result.
 */
const FAQ: { q: string; a: string; more?: { href: string; label: string } }[] = [
  {
    q: "Why bid on value instead of conversions?",
    a: "Google can only optimise for what you tell it. Tell it every lead is worth the same and it buys the cheapest ones. Tell it what each lead is likely to be worth and it buys the ones that pay.",
  },
  {
    q: "Is my account ready for this?",
    a: "Three things need to be true. Roughly 30 to 50 conversions a month per campaign, which is Google's own guidance for value-based bidding. A year of CRM history with a few hundred closed leads, so the tool has about 25 closed deals in each group it prices. And real differences between your leads: this suits insurance, lending, legal, home services, education and B2B software, and not a single product at a single price.",
    more: { href: "/blog/value-based-bidding-for-lead-generation#this-may-not-be-for-you", label: "The suitability test, in the guide" },
  },
  {
    q: "Where do the values come from?",
    a: "From your own history: how often each kind of lead closed, times what it was worth when it did. AI reads your file and your description. It never sets a number.",
    more: { href: "/blog/is-your-crm-data-ready-for-value-based-bidding", label: "Whether your CRM data can support it" },
  },
  {
    q: "What happens in my Google Ads account?",
    a: "One conversion action is created, called VBB Lead Value, and each lead is sent to it with its own value. Nothing else is touched. Switching a campaign to value-based bidding is a change you make, and we show you where.",
  },
  {
    q: "What has to be switched on in Google Ads?",
    a: "One conversion action, which we create for you. If your leads carry a Google click ID, that is all. If we match on email instead, turn on Enhanced conversions for leads under Goals, Conversions, Settings, and make sure the Google tag on your site collects the email at the form. The Connect step tells you which case you are in.",
  },
  {
    q: "How will I know it worked?",
    a: "Once connected, the tool keeps reading your CRM and compares the leads Google buys after the switch against the ones before, measured in real outcomes, not in the numbers we sent.",
    more: { href: "/blog/value-based-bidding-for-lead-generation#measure-business-results-not-just-reported-value", label: "How to measure the result, in the guide" },
  },
];


/** Three facts about the data, beside the three things a visitor needs. */
const PRIVATE = [
  "File processed in your browser",
  "Personal information is never stored",
  "Google receives only the required conversion data",
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

/**
 * Three things a visitor wants settled before reading on: what it optimises
 * for, what it reads from, where the result goes. One line each, no claim
 * the product cannot keep.
 */
const TRUST = [
  "Built for pipeline revenue",
  "Works with HubSpot or a CSV export",
  "Values sent straight to Google Ads",
];

export default async function Home() {
  // The three newest. Read at build time, like the blog itself.
  const posts = (await listPosts()).slice(0, 3);

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <header className="page-wide flex items-center justify-between gap-3 py-5">
        {/* The full lockup does not fit beside two buttons on a phone. */}
        <Logo size={34} showDotCom className="max-sm:hidden" />
        <Logo size={27} showDotCom className="sm:hidden" gradientId="vbb-mark-gradient-sm" />
        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          <AccountLink className="whitespace-nowrap text-[13.5px] font-semibold text-[var(--muted)] hover:text-[var(--foreground)]" />
          <Link href="/diagnostic" className="btn btn-secondary btn-sm">
            Start
          </Link>
        </div>
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
            <div className="grid items-center gap-8 p-6 sm:p-9 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)] lg:gap-12 lg:p-11">
              <div className="min-w-0">
                <p className="label" style={{ color: "var(--on-navy-muted)" }}>
                  Feed Google&apos;s AI the signal it is missing
                </p>

                <h1
                  className="display mt-4 max-w-[18ch]"
                  style={{ color: "var(--on-navy)" }}
                >
                  {/* The name of the method never breaks at its hyphen. */}
                  Improve lead quality with <span className="whitespace-nowrap">value-based</span> bidding.
                </h1>

                <p
                  className="lede mt-5 max-w-[54ch] max-sm:text-[15px]"
                  style={{ color: "var(--on-navy-muted)" }}
                >
                  Pass predicted lead values back to Google Ads, so Smart Bidding
                  goes after the prospects who actually pay. Values come from your
                  own CRM history, and none of it is stored.
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
                        className="bar bar-rise flex-1"
                        style={{
                          height: `${h}%`,
                          // Left to right, so the row reads as filling in
                          // rather than appearing. Short enough that the
                          // whole thing has settled inside a second.
                          animationDelay: `${i * 30}ms`,
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

        {/* A quiet strip under the hero. Brand blue rather than the status
            green: these are facts about the product, not a verdict on data. */}
        <ul className="page-wide mt-7 flex flex-wrap gap-x-8 gap-y-2.5 text-[13.5px] font-medium text-[var(--muted-strong)]">
          {TRUST.map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className="mt-[2px] flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[11px] font-bold text-[var(--primary)]"
              >
                ✓
              </span>
              <span className="[text-wrap:balance]">{line}</span>
            </li>
          ))}
        </ul>

        <HowItGoes />

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
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]"
              >
                <svg viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 2.5 3.5 5v4.5c0 4 2.8 6.9 6.5 8 3.7-1.1 6.5-4 6.5-8V5L10 2.5Z" />
                  <path d="m7.5 10 1.8 1.8L12.8 8.3" />
                </svg>
              </span>
              <h2 className="h3">What leaves your machine</h2>
            </div>
            <ul className="mt-4 grid gap-3 text-[14px]">
              {PRIVATE.map((line) => (
                <li key={line} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-[3px] flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent)]"
                  >
                    ✓
                  </span>
                  <span className="text-[var(--muted-strong)]">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Learn value-based bidding                                         */}
        {/* ---------------------------------------------------------------- */}
        {posts.length > 0 && (
          <section className="page-wide pt-14">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 className="h2">Learn value-based bidding</h2>
              <Link
                href="/blog"
                className="text-[13.5px] font-semibold text-[var(--primary)] hover:text-[var(--primary-hover)]"
              >
                All articles
              </Link>
            </div>
            <ul className="mt-5 grid gap-4 md:grid-cols-3">
              {posts.map((post) => (
                <li key={post.slug}>
                  <PostCard post={post} heading="h3" sizes="(min-width: 768px) 33vw, 100vw" />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Questions                                                         */}
        {/* ---------------------------------------------------------------- */}
        <section className="page-wide pt-14">
          <h2 className="h2">Questions</h2>
          <div className="card mt-5 divide-y divide-[var(--border)] px-6 sm:px-7">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
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
                {item.more && (
                  <Link
                    href={item.more.href}
                    className="mt-2 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[var(--primary)] hover:text-[var(--primary-hover)]"
                  >
                    {item.more.label}
                    <span aria-hidden>&rarr;</span>
                  </Link>
                )}
              </details>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* The ending: the same ask as the top, once the case has been made  */}
        {/* ---------------------------------------------------------------- */}
        <section className="page-wide pb-24 pt-14">
          <div className="panel-navy p-7 sm:p-10">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between md:gap-10">
              <div className="min-w-0">
                <h2 className="h1" style={{ color: "var(--on-navy)" }}>
                  See what your own leads are worth
                </h2>
                <p
                  className="mt-3 max-w-[54ch] text-[15px] leading-relaxed"
                  style={{ color: "var(--on-navy-muted)" }}
                >
                  Upload a CRM export and find out whether your lead values vary,
                  and by how much. About five minutes, and nothing is stored.
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-start gap-3 md:items-end">
                <Link
                  href="/diagnostic"
                  className="btn btn-primary btn-lg btn-wrap w-full sm:w-auto"
                >
                  Start with your CRM export <ArrowIcon />
                </Link>
                <Link
                  href="/diagnostic"
                  className="text-[13.5px] font-semibold underline underline-offset-[3px]"
                  style={{ color: "var(--on-navy-muted)" }}
                >
                  No export handy? Try the sample dataset
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
