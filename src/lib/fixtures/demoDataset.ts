import type { MappedDeal } from "@/lib/analysis/types";

/**
 * Deterministic synthetic dataset (~500 deals) so the whole flow demos without
 * real client data. Shaped to exercise every finding the report can produce:
 *
 *  - 60% of won deals close fast (inside 14 days)
 *  - ~30% of rows carry backfilled stage timestamps (sub-hour durations)
 *  - 6 sources with clearly different economics
 *  - one extreme outlier to trigger the value cap
 *  - ~15% click-ID coverage to trigger the tracking-gap finding
 *  - mixed USD/GBP
 *
 * Seeded PRNG keeps output identical across runs, so tests and screenshots
 * stay stable.
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

interface SourceProfile {
  name: string;
  share: number;
  closeRate: number;
  medianAmount: number;
  /** Spread multiplier on the median. */
  variance: number;
}

const SOURCES: SourceProfile[] = [
  { name: "Webinar",        share: 0.12, closeRate: 0.34, medianAmount: 11400, variance: 0.45 },
  { name: "Referral",       share: 0.08, closeRate: 0.41, medianAmount: 8900,  variance: 0.40 },
  { name: "Paid Search",    share: 0.34, closeRate: 0.19, medianAmount: 7200,  variance: 0.55 },
  { name: "Organic Search", share: 0.17, closeRate: 0.22, medianAmount: 6100,  variance: 0.50 },
  { name: "Paid Social",    share: 0.24, closeRate: 0.11, medianAmount: 4300,  variance: 0.60 },
  { name: "Cold Outbound",  share: 0.05, closeRate: 0.08, medianAmount: 5600,  variance: 0.35 },
];

const FREE_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"];
const CORP_DOMAINS = [
  "northwind-mfg.com", "acmeindustrial.com", "pinnacleops.com", "vertexplant.com",
  "harborworks.com", "lattice-systems.com", "quarrytech.com", "brightpath.io",
];

const INDUSTRIES = ["Manufacturing", "Logistics", "Construction", "Retail", "Healthcare"];

/** Titles matching the stated ICP (ops leadership). */
const ICP_TITLES = [
  "Operations Director", "Plant Manager", "VP Operations", "Director of Operations",
];
/** Everyone else who fills in a form. */
const OTHER_TITLES = [
  "Procurement Lead", "Facilities Coordinator", "Owner", "Marketing Associate",
  "Office Administrator", "Student",
];

const STAGES = ["New", "Qualified", "Proposal", "Closed Won", "Closed Lost"];

const CLICK_ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Builds a token shaped like a real Google click ID. */
function makeClickId(rand: () => number, seed: number): string {
  let out = "Cj0KCQiA";
  const len = 58 + Math.floor(rand() * 24);
  for (let i = 0; i < len; i++) {
    out += CLICK_ID_ALPHABET[Math.floor(rand() * CLICK_ID_ALPHABET.length)];
  }
  return out + seed.toString(36);
}

export interface DemoOptions {
  count?: number;
  seed?: number;
  /** Anchor for generated dates; defaults to a fixed date for stability. */
  now?: Date;
}

export function generateDemoDeals(opts: DemoOptions = {}): MappedDeal[] {
  const count = opts.count ?? 500;
  const rand = mulberry32(opts.seed ?? 20260824);
  const now = opts.now ?? new Date("2026-08-24T00:00:00Z");

  // Weighted source picker.
  const cumulative: { name: SourceProfile; upTo: number }[] = [];
  let acc = 0;
  for (const s of SOURCES) {
    acc += s.share;
    cumulative.push({ name: s, upTo: acc });
  }
  const pickSource = (): SourceProfile => {
    const r = rand() * acc;
    return (cumulative.find((c) => r <= c.upTo) ?? cumulative[cumulative.length - 1]).name;
  };

  const deals: MappedDeal[] = [];

  for (let i = 0; i < count; i++) {
    const profile = pickSource();

    // Spread creation across the last ~6 months.
    const ageDays = Math.floor(rand() * 182);
    const createdAt = new Date(now.getTime() - ageDays * 86_400_000);

    // Firmographics, decided before outcome so they can influence it. Roughly
    // a third of leads look like the stated ICP (mid-market manufacturing,
    // ops leadership).
    const isIcpLike = rand() < 0.34;
    const employeeCount = isIcpLike
      ? Math.floor(200 + rand() * 800)
      : Math.floor(10 + rand() * 190);
    const industry = isIcpLike
      ? "Manufacturing"
      : INDUSTRIES[1 + Math.floor(rand() * (INDUSTRIES.length - 1))];
    const contactTitle = isIcpLike
      ? ICP_TITLES[Math.floor(rand() * ICP_TITLES.length)]
      : OTHER_TITLES[Math.floor(rand() * OTHER_TITLES.length)];

    // Corporate-domain leads close better than free webmail. This correlation
    // is the whole point of the domain-disparity finding: it is knowable at
    // lead creation, so it can be priced on day 0 without any model.
    const isFree = rand() < 0.38;

    // Outcome. Deals too young to have closed stay open more often.
    // Domain type and ICP fit both shift the effective close rate.
    const domainLift = isFree ? 0.55 : 1.3;
    const icpLift = isIcpLike ? 1.35 : 0.85;
    const effectiveCloseRate = Math.min(
      0.85,
      profile.closeRate * domainLift * icpLift
    );

    const roll = rand();
    let outcome: MappedDeal["outcome"];
    if (ageDays < 10 && roll < 0.55) {
      outcome = "open";
    } else if (roll < effectiveCloseRate) {
      outcome = "won";
    } else if (roll < effectiveCloseRate + 0.55) {
      outcome = "lost";
    } else {
      outcome = "open";
    }

    // Cycle: 60% of closes land inside 14 days, the rest tail out.
    let cycleDays: number | null = null;
    if (outcome !== "open") {
      cycleDays = rand() < 0.6
        ? Math.floor(rand() * 14)
        : Math.floor(14 + rand() * 76);
      if (cycleDays > ageDays) cycleDays = ageDays;
    }
    const closedAt =
      cycleDays === null ? null : new Date(createdAt.getTime() + cycleDays * 86_400_000);

    // Amount, log-ish spread around the source median. ICP-fitting accounts
    // also buy bigger, so the ICP finding shows up in value as well as rate.
    let amount: number | null = null;
    if (outcome === "won" || (outcome === "open" && rand() < 0.4)) {
      const jitter = 1 + (rand() - 0.5) * 2 * profile.variance;
      const sizeLift = isIcpLike ? 1.4 : 0.8;
      amount = Math.max(
        400,
        Math.round((profile.medianAmount * jitter * sizeLift) / 100) * 100
      );
    }
    // 5% of rows genuinely lack an amount.
    if (rand() < 0.05) amount = null;

    // Identifiers: ~15% click-ID coverage, most rows have an email.
    const hasClick = rand() < 0.15;
    const domain = isFree
      ? FREE_DOMAINS[Math.floor(rand() * FREE_DOMAINS.length)]
      : CORP_DOMAINS[Math.floor(rand() * CORP_DOMAINS.length)];
    const email = rand() < 0.92 ? `lead${i}@${domain}` : null;

    // Stage: consistent with outcome.
    const stage =
      outcome === "won" ? "Closed Won"
      : outcome === "lost" ? "Closed Lost"
      : STAGES[Math.floor(rand() * 3)];

    // Only "Proposal" is backfilled, which is how real accounts look: a team
    // drags cards through one stage retroactively and lives the others
    // honestly. This lets the demo show both findings at once — an untrusted
    // stage AND a usable early gate in "Qualified".
    const backfilled = rand() < 0.42;
    const stageDurations: Record<string, number> = {
      // Honest durations: hours to days.
      Qualified: Math.floor(rand() * 4 * 86400) + 3600,
      Proposal: backfilled
        ? Math.floor(rand() * 50) + 3 // 3-53 seconds — nobody lived through this
        : Math.floor(rand() * 9 * 86400) + 7200,
    };
    // "Qualified" is reached early for most deals — the intended proxy gate.
    const stageReachedAfterDays: Record<string, number> = {
      Qualified: rand() < 0.78 ? Math.floor(rand() * 7) : Math.floor(7 + rand() * 30),
      Proposal: Math.floor(rand() * 40),
    };

    deals.push({
      id: `demo-${i + 1}`,
      createdAt,
      closedAt,
      outcome,
      amount,
      stage,
      source: profile.name,
      email,
      // Realistic length and alphabet: a real gclid is a ~60-90 char opaque
      // token, and detection keys off that shape rather than the header alone.
      clickId: hasClick ? makeClickId(rand, i) : null,
      stageDurations,
      stageReachedAfterDays,
      employeeCount,
      industry,
      contactTitle,
    });
  }

  // One extreme outlier, to prove the value cap does something visible.
  deals.push({
    id: "demo-outlier",
    createdAt: new Date(now.getTime() - 40 * 86_400_000),
    closedAt: new Date(now.getTime() - 35 * 86_400_000),
    outcome: "won",
    amount: 200_000,
    stage: "Closed Won",
    source: "Referral",
    email: "whale@northwind-mfg.com",
    clickId: null,
    stageDurations: { Qualified: 172800, Proposal: 259200 },
    stageReachedAfterDays: { Qualified: 2, Proposal: 4 },
    employeeCount: 4200,
    industry: "Manufacturing",
    contactTitle: "VP Operations",
  });

  return deals;
}

function isoDay(base: Date | null, offsetDays: number | undefined): string {
  if (!base || offsetDays === undefined) return "";
  return new Date(base.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** The demo CSV as the user would upload it — pre-mapping, with mixed currency. */
export function demoDealsToCsvRows(deals: MappedDeal[]): Record<string, string>[] {
  return deals.map((d, i) => ({
    record_id: d.id,
    created_at: d.createdAt ? d.createdAt.toISOString().slice(0, 10) : "",
    close_date: d.closedAt ? d.closedAt.toISOString().slice(0, 10) : "",
    dealstage: d.stage ?? "",
    amount__c: d.amount === null ? "" : String(d.amount),
    // A handful of GBP rows, so the mixed-currency prompt has something to find.
    deal_currency: i % 137 === 0 && i > 0 ? "GBP" : "USD",
    lead_source: d.source ?? "",
    pipeline_name: "Default",
    // Durations feed the backfill trust check; entered-dates feed early-gate
    // detection. A real export carries one or both, so the demo carries both.
    time_in_stage_qualified: String(d.stageDurations?.Qualified ?? ""),
    time_in_stage_proposal: String(d.stageDurations?.Proposal ?? ""),
    date_entered_qualified: isoDay(d.createdAt, d.stageReachedAfterDays?.Qualified),
    date_entered_proposal: isoDay(d.createdAt, d.stageReachedAfterDays?.Proposal),
    owner_email: "rep@vbb-demo.com",
    contact_email: d.email ?? "",
    gclid_c: d.clickId ?? "",
    employee_count: d.employeeCount === null ? "" : String(d.employeeCount ?? ""),
    industry: d.industry ?? "",
    contact_title: d.contactTitle ?? "",
  }));
}
