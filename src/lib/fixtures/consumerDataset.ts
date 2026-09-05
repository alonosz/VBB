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
 * the product's whole argument: a renters quote and a bundled home-and-auto
 * quote are the same "conversion" to Google and are not the same to anybody
 * else. Value is driven by product line first, then tier, then whether they
 * are switching, then urgency - so the engine has something real to find and
 * something real to refuse.
 *
 * It also carries an age band on purpose. That column has a perfect shape
 * and would price well, and the report must be seen to set it aside.
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

const PRODUCTS: Product[] = [
  { name: "Auto",    share: 0.40, closeRate: 0.24, premium: 1450 },
  { name: "Home",    share: 0.22, closeRate: 0.21, premium: 1900 },
  { name: "Renters", share: 0.18, closeRate: 0.31, premium: 240 },
  { name: "Life",    share: 0.10, closeRate: 0.14, premium: 2600 },
  { name: "Bundle",  share: 0.10, closeRate: 0.26, premium: 3300 },
];

const TIERS: { name: string; lift: number; share: number }[] = [
  { name: "Basic",    lift: 0.7, share: 0.35 },
  { name: "Standard", lift: 1.0, share: 0.45 },
  { name: "Premium",  lift: 1.6, share: 0.20 },
];

const TIMELINES: { name: string; closeLift: number; share: number }[] = [
  { name: "This week",      closeLift: 1.6, share: 0.30 },
  { name: "This month",     closeLift: 1.0, share: 0.45 },
  { name: "Just comparing", closeLift: 0.45, share: 0.25 },
];

const STATES = ["CA", "TX", "FL", "NY", "IL", "OH", "GA", "WA"];
const SOURCES = ["Paid Search", "Organic Search", "Paid Social", "Comparison Site", "Referral"];
const AGE_BANDS = ["18-24", "25-34", "35-44", "45-54", "55+"];
const FREE_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"];

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
export function generateConsumerDemoRows(opts: ConsumerDemoOptions = {}): Record<string, string>[] {
  const count = opts.count ?? 600;
  const rand = mulberry32(opts.seed ?? 20260905);
  const now = opts.now ?? new Date("2026-09-05T00:00:00Z");
  const rows: Record<string, string>[] = [];

  for (let i = 0; i < count; i++) {
    const product = pick(rand, PRODUCTS);
    const tier = pick(rand, TIERS);
    const timeline = pick(rand, TIMELINES);
    const insured = rand() < 0.62;
    const state = STATES[Math.floor(rand() * STATES.length)];
    const source = SOURCES[Math.floor(rand() * SOURCES.length)];
    const ageBand = AGE_BANDS[Math.floor(rand() * AGE_BANDS.length)];

    const ageDays = Math.floor(rand() * 182);
    const createdAt = new Date(now.getTime() - ageDays * 86_400_000);

    // Switchers bind more often; a hot timeline binds much more often.
    const closeRate = Math.min(0.8, product.closeRate * (insured ? 1.25 : 0.8) * timeline.closeLift);

    const roll = rand();
    let outcome: "won" | "lost" | "open";
    if (ageDays < 5 && roll < 0.6) outcome = "open";
    else if (roll < closeRate) outcome = "won";
    else if (roll < closeRate + 0.6) outcome = "lost";
    else outcome = "open";

    // A quote funnel resolves in days. Almost everything closes inside two weeks.
    let cycleDays: number | null = null;
    if (outcome !== "open") {
      cycleDays = rand() < 0.8 ? Math.floor(rand() * 10) : Math.floor(10 + rand() * 30);
      if (cycleDays > ageDays) cycleDays = ageDays;
    }
    const closedAt = cycleDays === null ? null : new Date(createdAt.getTime() + cycleDays * 86_400_000);

    let premium = "";
    if (outcome === "won" || (outcome === "open" && rand() < 0.5)) {
      const jitter = 1 + (rand() - 0.5) * 0.6;
      premium = String(Math.round((product.premium * tier.lift * jitter) / 10) * 10);
    }

    // "Quoted" is the gate: reached quickly by most who reach it at all, and
    // by nearly everyone who goes on to bind.
    const reachedQuoted = outcome === "won" ? rand() < 0.96 : rand() < 0.5;
    const quotedAfterDays = reachedQuoted
      ? rand() < 0.85 ? Math.floor(rand() * 4) : Math.floor(4 + rand() * 20)
      : null;

    const stage =
      outcome === "won" ? "Bound"
      : outcome === "lost" ? "Lost"
      : reachedQuoted ? "Quoted"
      : rand() < 0.5 ? "Contacted" : "New";

    const hasClick = rand() < 0.42;
    const email = rand() < 0.95
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
      state,
      age_band: ageBand,
      contact_email: email,
      gclid: hasClick ? makeClickId(rand, i) : "",
      date_entered_quoted:
        quotedAfterDays === null ? "" : isoDay(new Date(createdAt.getTime() + quotedAfterDays * 86_400_000)),
      time_in_stage_quoted: reachedQuoted ? String(Math.floor(rand() * 3 * 86400) + 1800) : "",
    });
  }

  return rows;
}

export const CONSUMER_EXAMPLE =
  "We run an insurance comparison site. People fill in a quote form for auto, home, renters, " +
  "life or a bundle, and our agents call them back. Bundles and life are worth far more than " +
  "renters. Someone who already has a policy and is switching binds more often than a first-time " +
  "buyer, and 'this week' leads bind fastest. Most policies bind inside two weeks. We get roughly " +
  "600 quote requests a month, mostly from paid search.";
