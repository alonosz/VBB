import type { FactorLevel, ModelFactor } from "./valueModel";

/**
 * Was the advertiser right about their own customers?
 *
 * This is the question the claims section exists to answer, and answering it
 * needs more than "did the factor make the model". Those are different
 * questions, and conflating them produces the worst possible output: telling
 * somebody their theory holds up while showing them evidence that it does not.
 *
 * It happened on the first real run. An advertiser said "C-level contacts are
 * the ones that close". Contact seniority did make the model, so the report
 * said the claim held up - and then quoted Manager at 1.68x, because that is
 * the strongest level. C-level was 0.71x, well below their average lead. The
 * claim was refuted and the screen called it confirmed.
 *
 * A refuted claim is the most valuable line in the report. It is the only
 * place the product tells a marketer something they did not already believe,
 * and getting it backwards is worse than never having asked.
 */

/** Below this the named level is not meaningfully better than average. */
export const CLAIM_LIFT_FLOOR = 1.1;

export type ClaimVerdict =
  | {
      kind: "confirmed";
      /** The level they named, which the data agrees is worth more. */
      level: FactorLevel;
    }
  | {
      kind: "refuted";
      /** Their level, measured. Present when we could measure it at all. */
      level: FactorLevel | null;
      /** The level that actually is strongest, when there is one. */
      strongest: FactorLevel | null;
      /** Why: the factor was dropped, or their level is not the good one. */
      because: "factor-dropped" | "wrong-level";
    }
  | {
      kind: "untested";
      /** Why we cannot say either way, in the advertiser's words. */
      reason: string;
    };

/** Matches the advertiser's wording to a level, forgiving case and spacing. */
export function findLevel(levels: FactorLevel[], named: string): FactorLevel | null {
  const want = named.trim().toLowerCase();
  if (!want) return null;
  return (
    levels.find((l) => l.level.trim().toLowerCase() === want) ??
    // A near miss is worth catching: somebody writes "C level" for "C-level",
    // and refusing to test it would report a claim as untestable when we can
    // see exactly which level they meant.
    levels.find((l) => l.level.trim().toLowerCase().replace(/[\s-]+/g, "") === want.replace(/[\s-]+/g, "")) ??
    null
  );
}

function strongestOf(levels: FactorLevel[]): FactorLevel | null {
  const usable = levels.filter((l) => l.usable);
  if (usable.length === 0) return null;
  return usable.reduce((best, l) => (l.lift > best.lift ? l : best));
}

export function judgeClaim(factor: ModelFactor): ClaimVerdict {
  const strongest = strongestOf(factor.levels);

  if (!factor.included) {
    return { kind: "refuted", level: null, strongest: null, because: "factor-dropped" };
  }

  // No level named: they said the factor matters and it does. That is all we
  // were told, so it is all we can confirm.
  if (factor.statedLevels.length === 0) {
    return strongest
      ? { kind: "confirmed", level: strongest }
      : { kind: "untested", reason: "no level had enough resolved deals to measure" };
  }

  const named = factor.statedLevels
    .map((l) => findLevel(factor.levels, l))
    .filter((l): l is FactorLevel => l !== null);

  if (named.length === 0) {
    return {
      kind: "untested",
      reason: "that value does not appear in this file, so there was nothing to test it against",
    };
  }

  const measurable = named.filter((l) => l.usable);
  if (measurable.length === 0) {
    return {
      kind: "untested",
      reason: "too few resolved deals at that value to tell the difference from chance",
    };
  }

  // Their best named level decides it. Naming three things where one is right
  // is a claim that was partly right, and the right half is what prices leads.
  const theirs = measurable.reduce((best, l) => (l.lift > best.lift ? l : best));

  if (theirs.lift >= CLAIM_LIFT_FLOOR) return { kind: "confirmed", level: theirs };

  return {
    kind: "refuted",
    level: theirs,
    // Only worth naming when it is not the one they picked.
    strongest: strongest && strongest.level !== theirs.level ? strongest : null,
    because: "wrong-level",
  };
}
