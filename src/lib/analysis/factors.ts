import type { MappedDeal } from "./types";
import { classifyDomain } from "./helpers";

/**
 * Lead-intrinsic factors - attributes observable at form-fill time.
 *
 * Deal source is deliberately absent. Every lead we emit a value for arrived
 * via an ad click, and Google already knows which campaign produced it;
 * feeding a channel judgement back in duplicates its job. CRM attribution
 * fields are also routinely overwritten by later touches, so they are not
 * sound enough to price a conversion. Source stays in the diagnostic as
 * channel insight only.
 */

export type SeniorityBand = "C-level" | "VP" | "Director" | "Manager" | "IC";

/**
 * Seniority from a job title, by keyword. Ordered most senior first so a
 * "VP of Engineering, Director of Platform" style title resolves to the
 * higher band rather than whichever matched first alphabetically.
 */
const SENIORITY_PATTERNS: { band: SeniorityBand; patterns: RegExp[] }[] = [
  {
    band: "C-level",
    patterns: [
      /\b(ceo|cfo|coo|cto|cmo|cro|ciso|cio)\b/i,
      /\bchief\b/i,
      /\b(founder|co-?founder)\b/i,
      /\b(owner|proprietor)\b/i,
      /\bpresident\b/i,
      /\bpartner\b/i,
      /\bmanaging director\b/i,
    ],
  },
  {
    band: "VP",
    patterns: [/\b(vp|svp|evp|avp)\b/i, /\bvice[- ]president\b/i, /\bhead of\b/i],
  },
  {
    band: "Director",
    patterns: [/\bdirector\b/i, /\bprincipal\b/i],
  },
  {
    band: "Manager",
    patterns: [/\bmanager\b/i, /\bsupervisor\b/i, /\blead\b/i, /\bforeman\b/i],
  },
];

export function parseSeniority(title: string | null | undefined): SeniorityBand | null {
  if (!title?.trim()) return null;
  for (const { band, patterns } of SENIORITY_PATTERNS) {
    if (patterns.some((re) => re.test(title))) return band;
  }
  // A title we can read but do not recognize as management is an individual
  // contributor - that is information, not a gap.
  return "IC";
}

export function employeeBand(count: number | null | undefined): string | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
  if (count < 50) return "1–49";
  if (count < 201) return "50–200";
  if (count < 1001) return "201–1,000";
  return "1,000+";
}

export interface FactorDefinition {
  key: string;
  label: string;
  /** Returns the level this deal falls into, or null when unknown. */
  levelOf: (deal: MappedDeal) => string | null;
}

/** Factors always available when the underlying column was mapped. */
export const CORE_FACTORS: FactorDefinition[] = [
  {
    key: "domainType",
    label: "Email domain",
    levelOf: (d) => {
      const type = classifyDomain(d.email);
      if (type === "unknown") return null;
      return type === "corporate" ? "Corporate email" : "Free webmail";
    },
  },
  {
    key: "employeeBand",
    label: "Company size",
    levelOf: (d) => employeeBand(d.employeeCount),
  },
  {
    key: "industry",
    label: "Industry",
    levelOf: (d) => d.industry?.trim() || null,
  },
  {
    key: "seniority",
    label: "Contact seniority",
    levelOf: (d) => parseSeniority(d.contactTitle),
  },
];

/**
 * Any extra categorical column the user maps as a value signal (budget band,
 * timeline, use case…) becomes a candidate factor with the same treatment as
 * the built-ins - it must clear the same sample-size and lift thresholds.
 */
export function customFactor(key: string, label: string): FactorDefinition {
  return {
    key,
    label,
    levelOf: (d) => d.signals?.[key]?.trim() || null,
  };
}

export function buildFactorList(customSignalKeys: string[] = []): FactorDefinition[] {
  return [
    ...CORE_FACTORS,
    ...customSignalKeys.map((k) => customFactor(k, k)),
  ];
}
