/**
 * A consumer lead-gen file, as it would be uploaded.
 *
 * The B2B sample has headcount, industry and job title, and the four built-in
 * factors light up on it. A consumer file has none of those. What separates
 * one lead from another is on the form: what they asked for, which tier, how
 * soon, and where. Those are ordinary columns with no special name, and until
 * discovery existed the product would have priced every row here the same.
 *
 * Shaped like an insurance quote funnel, because that is the clearest case of
 * the product's whole argument. It is built so the report has something real
 * to say in every section rather than only in the value model:
 *
 *  - Renters converts far better than anything else and is worth a fifth of
 *    what an auto policy is worth. A bidder optimising for conversion count
 *    chases it and buys the cheapest business in the file. That inversion is
 *    the product's whole argument, sitting in the data rather than a sentence.
 *  - The stated description claims renters is therefore their best product, so
 *    the report has a claim to refute - the most useful line it can print.
 *  - "Quoted" is reached fast and separates outcomes hard: an early gate.
 *  - "Application" is backfilled on nearly half the rows and reached too late,
 *    so the stage-trust check fires and a gate candidate is refused on time.
 *  - One commercial policy is enormous, so the value cap clips something and
 *    the clipped-outliers table has a row to show.
 *  - `form_variant` is pure noise, so a factor gets tested and dropped.
 *  - `referral_partner` and `vehicle_make` are thin and many-levelled, so the
 *    signals list shows both the suggested and the offered-but-off states.
 *  - Some rows carry no identifier at all, so match rate is honest.
 *  - `age_band` has a perfect categorical shape and must be refused.
 *
 * Seeded, so screenshots and tests stay identical between runs.
 */

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Product {
  name: string;
  share: number;
  closeRate: number;
  /** Annual premium, before tier and jitter. */
  premium: number;
}

/**
 * The inversion, on purpose: renters has by far the best close rate and is
 * worth a fraction of anything else. Count-based bidding buys renters.
 *
 * The ladder is deliberately kept inside about five to one, because the value
 * cap is three times the median won deal and a wider ladder would price the
 * top three products identically at the cap. Commercial still sits above it,
 * which is what the clipped-outliers table is for.
 */
const PRODUCTS: Product[] = [
  { name: "Auto",       share: 0.36, closeRate: 0.22, premium: 1200 },
  { name: "Renters",    share: 0.22, closeRate: 0.34, premium: 430 },
  { name: "Home",       share: 0.18, closeRate: 0.18, premium: 1900 },
  { name: "Bundle",     share: 0.11, closeRate: 0.16, premium: 2950 },
  { name: "Life",       share: 0.10, closeRate: 0.12, premium: 2450 },
  { name: "Commercial", share: 0.03, closeRate: 0.10, premium: 6800 },
];

const TIERS = [
  { name: "Basic", lift: 0.6, share: 0.35 },
  { name: "Standard", lift: 1.0, share: 0.45 },
  { name: "Premium", lift: 1.9, share: 0.2 },
];

const TIMELINES = [
  { name: "This week", closeLift: 1.7, share: 0.28 },
  { name: "This month", closeLift: 1.0, share: 0.44 },
  { name: "Just comparing", closeLift: 0.35, share: 0.28 },
];

/**
 * State is a real value driver here, not filler. Insurance premiums for the
 * same cover differ by nearly two to one across these markets, so the engine
 * ought to find it and price on it. Weighted by where the quotes come from.
 */
const STATES = [
  { name: "FL", share: 0.14, priceLift: 1.45 },
  { name: "TX", share: 0.16, priceLift: 1.3 },
  { name: "CA", share: 0.18, priceLift: 1.2 },
  { name: "NY", share: 0.11, priceLift: 1.15 },
  { name: "GA", share: 0.1, priceLift: 1.0 },
  { name: "IL", share: 0.11, priceLift: 0.95 },
  { name: "WA", share: 0.1, priceLift: 0.85 },
  { name: "OH", share: 0.1, priceLift: 0.75 },
];
const SOURCES = ["Paid Search", "Organic Search", "Paid Social", "Comparison Site", "Referral"];
const AGE_BANDS = ["18-24", "25-34", "35-44", "45-54", "55+"];
const FREE_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"];

/** Thin: only the leads an affiliate sent, which is under a third of them. */
const PARTNERS = ["Compare Hub", "QuoteWise", "PolicyFinder", "InsureMate"];

/** Many-levelled, and only on auto quotes, so it is thin twice over. */
const VEHICLE_MAKES = [
  "Toyota", "Honda", "Ford", "Chevrolet", "Nissan", "Hyundai", "Kia", "Subaru",
  "Mazda", "Volkswagen", "BMW", "Mercedes", "Audi", "Lexus", "Jeep", "Ram",
  "GMC", "Tesla",
];

function pick<T extends { share: number }>(rand: () => number, items: T[]): T {
  const r = rand();
  let acc = 0;
  for (const item of items) {
    acc += item.share;
    if (r <= acc) return item;
  }
  return items[items.length - 1];
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function makeClickId(rand: () => number, i: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "Cj0KCQ";
  const len = 70 + Math.floor(rand() * 15);
  for (let k = 0; k < len; k++) out += alphabet[Math.floor(rand() * alphabet.length)];
  return `${out}${i.toString(36)}`;
}

export interface ConsumerDemoOptions {
  count?: number;
  seed?: number;
  now?: Date;
}

/** The file, row by row, headers as a quote funnel would name them. */
export function generateConsumerDemoRows(
  opts: ConsumerDemoOptions = {}
): Record<string, string>[] {
  const count = opts.count ?? 700;
  const rand = mulberry32(opts.seed ?? 20260905);
  const now = opts.now ?? new Date("2026-09-05T00:00:00Z");
  const rows: Record<string, string>[] = [];

  for (let i = 0; i < count; i++) {
    const product = pick(rand, PRODUCTS);
    const tier = pick(rand, TIERS);
    const timeline = pick(rand, TIMELINES);
    const insured = rand() < 0.62;
    const state = pick(rand, STATES);
    const source = SOURCES[Math.floor(rand() * SOURCES.length)];
    const ageBand = AGE_BANDS[Math.floor(rand() * AGE_BANDS.length)];

    // Pure noise, deliberately. Nothing downstream reads it, so the engine
    // should test it and drop it for carrying no lift.
    const formVariant = rand() < 0.5 ? "A" : "B";

    const ageDays = Math.floor(rand() * 182);
    const createdAt = new Date(now.getTime() - ageDays * 86_400_000);

    // Switchers bind more often; a hot timeline binds much more often.
    const closeRate = Math.min(
      0.85,
      product.closeRate * (insured ? 1.3 : 0.75) * timeline.closeLift
    );

    const roll = rand();
    let outcome: "won" | "lost" | "open";
    if (ageDays < 5 && roll < 0.6) outcome = "open";
    else if (roll < closeRate) outcome = "won";
    else if (roll < closeRate + 0.6) outcome = "lost";
    else outcome = "open";

    // A quote funnel resolves in days. Almost everything closes inside a
    // fortnight, which is what makes the seven-day window usable here.
    let cycleDays: number | null = null;
    if (outcome !== "open") {
      cycleDays = rand() < 0.8 ? Math.floor(rand() * 10) : Math.floor(10 + rand() * 30);
      if (cycleDays > ageDays) cycleDays = ageDays;
    }
    const closedAt =
      cycleDays === null ? null : new Date(createdAt.getTime() + cycleDays * 86_400_000);

    let premium = "";
    if (outcome === "won" || (outcome === "open" && rand() < 0.45)) {
      const jitter = 1 + (rand() - 0.5) * 0.6;
      premium = String(
        Math.round((product.premium * tier.lift * state.priceLift * jitter) / 10) * 10
      );
    }

    /*
     * Two stages with opposite characters, because a real CRM has both.
     *
     * "Quoted" is lived honestly and reached fast: it is the early gate.
     * "Application" is dragged through retroactively on nearly half the rows
     * (durations of seconds nobody lived through) and reached around three
     * weeks in, so it fails the trust check and is refused as a gate for
     * being too slow. A fixture where every stage is clean teaches nothing
     * about a product whose job is noticing when a stage is lying.
     */
    const reachedQuoted = outcome === "won" ? rand() < 0.96 : rand() < 0.5;
    const quotedAfterDays = reachedQuoted
      ? rand() < 0.85
        ? Math.floor(rand() * 4)
        : Math.floor(4 + rand() * 20)
      : null;

    const reachedApplication = reachedQuoted && (outcome === "won" ? rand() < 0.9 : rand() < 0.3);
    const applicationBackfilled = rand() < 0.46;
    const applicationAfterDays = reachedApplication
      ? Math.floor(14 + rand() * 26)
      : null;

    const stage =
      outcome === "won" ? "Bound"
      : outcome === "lost" ? "Lost"
      : reachedApplication ? "Application"
      : reachedQuoted ? "Quoted"
      : rand() < 0.5 ? "Contacted" : "New";

    /*
     * Identifiers. Roughly 6% of rows carry neither, which is what a real
     * funnel looks like once a consent banner and an ad blocker have had
     * their say - and it is what makes the match-rate finding honest rather
     * than a perfect score nobody believes.
     */
    const neither = rand() < 0.06;
    const hasClick = !neither && rand() < 0.47;
    const email = neither
      ? ""
      : rand() < 0.96
        ? `quote${i}@${FREE_DOMAINS[Math.floor(rand() * FREE_DOMAINS.length)]}`
        : "";

    rows.push({
      lead_id: `Q-${100000 + i}`,
      created_at: isoDay(createdAt),
      closed_at: closedAt ? isoDay(closedAt) : "",
      outcome: outcome === "won" ? "Won" : outcome === "lost" ? "Lost" : "",
      stage,
      premium_amount: premium,
      lead_source: source,
      product_line: product.name,
      coverage_tier: tier.name,
      currently_insured: insured ? "Yes" : "No",
      timeline: timeline.name,
      state: state.name,
      age_band: ageBand,
      form_variant: formVariant,
      // Thin on purpose: offered in the signals list, switched off by default.
      referral_partner:
        rand() < 0.28 ? PARTNERS[Math.floor(rand() * PARTNERS.length)] : "",
      // Many-levelled and thin: offered, and off, for two separate reasons.
      vehicle_make:
        product.name === "Auto"
          ? VEHICLE_MAKES[Math.floor(rand() * VEHICLE_MAKES.length)]
          : "",
      contact_email: email,
      gclid: hasClick ? makeClickId(rand, i) : "",
      date_entered_quoted:
        quotedAfterDays === null
          ? ""
          : isoDay(new Date(createdAt.getTime() + quotedAfterDays * 86_400_000)),
      time_in_stage_quoted: reachedQuoted
        ? String(Math.floor(rand() * 3 * 86400) + 1800)
        : "",
      date_entered_application:
        applicationAfterDays === null
          ? ""
          : isoDay(new Date(createdAt.getTime() + applicationAfterDays * 86_400_000)),
      time_in_stage_application: reachedApplication
        ? applicationBackfilled
          ? String(Math.floor(rand() * 40) + 4) // seconds - a dragged card
          : String(Math.floor(rand() * 6 * 86400) + 7200)
        : "",
    });
  }

  /*
   * One enormous commercial policy, so the value cap clips something visible
   * and the clipped-outliers table has a row to explain itself with. Without
   * it the cap is a paragraph about a thing that never happened.
   */
  const outlierCreated = new Date(now.getTime() - 48 * 86_400_000);
  rows.push({
    lead_id: "Q-199999",
    created_at: isoDay(outlierCreated),
    closed_at: isoDay(new Date(outlierCreated.getTime() + 9 * 86_400_000)),
    outcome: "Won",
    stage: "Bound",
    premium_amount: "62000",
    lead_source: "Referral",
    product_line: "Commercial",
    coverage_tier: "Premium",
    currently_insured: "Yes",
    timeline: "This week",
    state: "TX",
    age_band: "45-54",
    form_variant: "A",
    referral_partner: "",
    vehicle_make: "",
    contact_email: "fleet@harborlogistics.com",
    gclid: "",
    date_entered_quoted: isoDay(new Date(outlierCreated.getTime() + 2 * 86_400_000)),
    time_in_stage_quoted: "115200",
    date_entered_application: isoDay(new Date(outlierCreated.getTime() + 5 * 86_400_000)),
    time_in_stage_application: "259200",
  });

  return rows;
}

/**
 * What the advertiser says about the file, written to be partly wrong.
 *
 * The renters claim is the point. It is true that it converts best, and the
 * conclusion drawn from it is wrong: it is the least valuable thing they sell.
 * That is exactly the mistake optimising for conversion count teaches, and the
 * report says so back. A demo where every claim survives shows the tool
 * agreeing with somebody, which proves nothing.
 */
export const CONSUMER_EXAMPLE =
  "We help people shop for insurance. They fill in a quote form for auto, home, " +
  "renters, life or a bundle, and our agents call them back. Renters converts better " +
  "than anything else we sell, close to double auto, so I would guess it is our best " +
  "product. Someone who already has a policy and is switching binds more often than a " +
  "first-time buyer, and 'this week' leads bind fastest. Most policies bind inside two " +
  "weeks. We get roughly 700 quote requests a month, mostly from paid search.";
