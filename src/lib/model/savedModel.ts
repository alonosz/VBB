import type { Audience, MappedDeal } from "@/lib/analysis/types";
import type {
  FactorHypothesis,
  ModelFactor,
  ValueModel,
} from "@/lib/analysis/valueModel";
import { buildFactorList } from "@/lib/analysis/factors";
import { effectiveMultiplier } from "@/lib/analysis/valueModel";
import { round } from "@/lib/analysis/helpers";
import type { GateValue } from "@/lib/analysis/gateValue";

/**
 * A saved value model - fit once, applied unchanged.
 *
 * Refitting on every upload is fine for a one-off diagnostic and wrong for a
 * daily loop: a 30-day window one morning and a 90-day window the next produce
 * different multipliers, so the same lead is worth two different amounts on two
 * days for no reason the advertiser can see. Google then learns from a moving
 * target.
 *
 * So the model becomes an artifact. It is fitted, saved, and applied frozen
 * until the data has moved enough to justify refitting - and how far it has
 * moved is measured and shown, not guessed at.
 */

export const MODEL_FORMAT_VERSION = 1;

/**
 * How far a multiplier may drift before the saved model is stale.
 *
 * This is not the >20% adjustment threshold from the Day-0 rule - that governs
 * whether a single conversion's value is worth resending. This governs whether
 * the rules themselves should be refitted. They share a number only because
 * both ask "is this difference large enough to act on", and 20% is where a
 * multiplier change starts moving real bids.
 */
export const DRIFT_THRESHOLD = 0.2;

export interface SavedFactorLevel {
  level: string;
  /** The frozen multiplier. Not refitted while this model is in use. */
  multiplier: number;
  /** Provenance, carried so the rule stays explainable after it is saved. */
  sampleSize: number;
  closeRate: number;
  medianWonAmount: number | null;
  /** Average won with outliers at the cap - the number inside the multiplier.
      Absent in models saved before it existed; the median stands in on screen. */
  avgWonAmount: number | null;
}

export interface SavedFactor {
  key: string;
  label: string;
  levels: SavedFactorLevel[];
}

/**
 * The frozen early gate.
 *
 * A scheduled run has to be able to apply the gate, and it must not refit to
 * find one - refitting nightly is exactly what principle 8 forbids. So the
 * gate is frozen with the rest of the stack.
 *
 * Added as an optional field rather than a new format version: a model saved
 * before this simply has no gate, prices its day-0 stack exactly as it always
 * did, and stays loadable. Bumping the version would have refused every model
 * already saved, to add something they can live without.
 */
export interface SavedGate {
  stage: string;
  multiplier: number;
  /** Provenance, so the gate stays as arguable as every other rule. */
  reachedCount: number;
  closeRateReached: number;
  closeRateNotReached: number;
  withinWindowRate: number;
  rawMultiplier: number;
  wasBounded: boolean;
}

export interface SavedValueModel {
  formatVersion: number;
  /** Stable across refits, so a lineage can be followed. */
  modelId: string;
  fittedAt: string;
  /** Resolved deals the fit was based on. */
  fittedOn: number;
  /** The date range of those deals, so a stale model is visible as stale. */
  window: { from: string | null; to: string | null };
  currencyCode: string;
  baseValue: number;
  calibrationFactor: number;
  cap: number | null;
  factors: SavedFactor[];
  /**
   * Absent when the data supported no gate - which is the common case, and is
   * not a defect. The day-0 stack prices the lead either way.
   */
  gate?: SavedGate | null;
  /** Columns that must be mapped again for the custom rules to fire. */
  customSignalKeys: string[];
  claims: FactorHypothesis[];
  /**
   * Who the model prices for. Optional so a model saved before the flag
   * existed still loads; it is read as businesses, which is what it was.
   */
  audience?: Audience;
}

const CORE_KEYS = new Set(["domainType", "employeeBand", "industry", "seniority"]);

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface SaveOptions {
  /** The deals it was fitted on, used only to record the window. */
  deals: MappedDeal[];
  now?: Date;
  modelId?: string;
  /**
   * Multipliers the user typed over. Saving has to freeze what is on screen -
   * saving the fitted numbers instead would hand back a model that prices
   * leads differently from the one they just approved.
   */
  overrides?: Record<string, number>;
  /**
   * The priced gate, when the data supported one. Frozen with the stack so a
   * scheduled run can apply it without refitting.
   */
  gate?: GateValue | null;
}

export function saveValueModel(model: ValueModel, opts: SaveOptions): SavedValueModel {
  const dates = opts.deals
    .filter((d) => d.outcome === "won" || d.outcome === "lost")
    .map((d) => d.createdAt)
    .filter((d): d is Date => d instanceof Date);

  const times = dates.map((d) => d.getTime());

  return {
    formatVersion: MODEL_FORMAT_VERSION,
    modelId: opts.modelId ?? newModelId(),
    fittedAt: (opts.now ?? new Date()).toISOString(),
    fittedOn: model.fittedOn,
    window: {
      from: times.length > 0 ? isoDay(new Date(Math.min(...times))) : null,
      to: times.length > 0 ? isoDay(new Date(Math.max(...times))) : null,
    },
    currencyCode: model.currencyCode,
    baseValue: model.baseValue,
    calibrationFactor: model.calibrationFactor,
    cap: model.cap,
    // Only usable levels are saved: a level that never cleared the sample floor
    // has no multiplier to freeze.
    factors: model.includedFactors.map((f) => ({
      key: f.key,
      label: f.label,
      levels: f.levels
        .filter((l) => l.usable)
        .map((l) => ({
          level: l.level,
          multiplier: effectiveMultiplier(f.key, l, opts.overrides),
          sampleSize: l.sampleSize,
          closeRate: l.closeRate,
          medianWonAmount: l.medianWonAmount,
          avgWonAmount: l.avgWonAmount,
        })),
    })),
    gate: freezeGate(opts.gate),
    customSignalKeys: model.factors.map((f) => f.key).filter((k) => !CORE_KEYS.has(k)),
    claims: model.factors
      .filter((f) => f.userClaim !== null)
      .map((f) => ({ factorKey: f.key, claim: f.userClaim!, statedLevels: f.statedLevels })),
    audience: model.audience ?? "b2b",
  };
}

/** Only a usable gate is worth freezing; anything else is not a rule. */
function freezeGate(gate: GateValue | null | undefined): SavedGate | null {
  if (!gate?.available || !gate.stage || !gate.multiplier || !(gate.multiplier > 0)) return null;
  return {
    stage: gate.stage,
    multiplier: gate.multiplier,
    reachedCount: gate.reachedCount,
    closeRateReached: gate.closeRateReached,
    closeRateNotReached: gate.closeRateNotReached,
    withinWindowRate: gate.withinWindowRate,
    rawMultiplier: gate.rawMultiplier ?? gate.multiplier,
    wasBounded: gate.wasBounded,
  };
}

function newModelId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `model-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Loading - a saved model from disk is untrusted input like any other
// ---------------------------------------------------------------------------

export interface LoadResult {
  model: SavedValueModel | null;
  /** Plain-English reason, shown to the user. Null on success. */
  error: string | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function loadSavedModel(raw: unknown): LoadResult {
  if (!raw || typeof raw !== "object") {
    return { model: null, error: "That file isn't a saved model." };
  }
  const r = raw as Record<string, unknown>;

  if (num(r.formatVersion) === null) {
    return { model: null, error: "That file isn't a saved model - it has no format version." };
  }
  if (r.formatVersion !== MODEL_FORMAT_VERSION) {
    return {
      model: null,
      error: `That model was saved in format v${r.formatVersion}, and this version of VBB reads v${MODEL_FORMAT_VERSION}. Refit and save it again.`,
    };
  }

  const baseValue = num(r.baseValue);
  const calibrationFactor = num(r.calibrationFactor);
  if (baseValue === null || baseValue <= 0) {
    return { model: null, error: "That model has no base value, so it can't price anything." };
  }
  if (calibrationFactor === null || calibrationFactor <= 0) {
    return { model: null, error: "That model has no calibration factor." };
  }

  const factors: SavedFactor[] = [];
  if (Array.isArray(r.factors)) {
    for (const f of r.factors) {
      if (!f || typeof f !== "object") continue;
      const e = f as Record<string, unknown>;
      if (typeof e.key !== "string") continue;
      const levels: SavedFactorLevel[] = [];
      if (Array.isArray(e.levels)) {
        for (const l of e.levels) {
          if (!l || typeof l !== "object") continue;
          const lv = l as Record<string, unknown>;
          const multiplier = num(lv.multiplier);
          if (typeof lv.level !== "string" || multiplier === null || multiplier <= 0) continue;
          levels.push({
            level: lv.level,
            multiplier,
            sampleSize: num(lv.sampleSize) ?? 0,
            closeRate: num(lv.closeRate) ?? 0,
            medianWonAmount: num(lv.medianWonAmount),
            // Models saved before the capped average existed load as null here
            // rather than being refused; a missing provenance stat is not a
            // broken rule.
            avgWonAmount: num(lv.avgWonAmount),
          });
        }
      }
      // A factor with nothing to apply is not a rule.
      if (levels.length === 0) continue;
      factors.push({
        key: e.key,
        label: typeof e.label === "string" ? e.label : e.key,
        levels,
      });
    }
  }

  // A gate that is present but broken is refused rather than dropped. Dropping
  // it would quietly under-price every lead that reached it, and a model that
  // silently prices differently from the one that was saved is the failure
  // this whole file exists to prevent.
  let gate: SavedGate | null = null;
  if (r.gate !== undefined && r.gate !== null) {
    if (typeof r.gate !== "object") {
      return { model: null, error: "That model's early gate could not be read. Refit and save it again." };
    }
    const g = r.gate as Record<string, unknown>;
    const multiplier = num(g.multiplier);
    if (typeof g.stage !== "string" || !g.stage.trim() || multiplier === null || multiplier <= 0) {
      return { model: null, error: "That model's early gate has no usable stage or multiplier. Refit and save it again." };
    }
    gate = {
      stage: g.stage,
      multiplier,
      reachedCount: num(g.reachedCount) ?? 0,
      closeRateReached: num(g.closeRateReached) ?? 0,
      closeRateNotReached: num(g.closeRateNotReached) ?? 0,
      withinWindowRate: num(g.withinWindowRate) ?? 0,
      rawMultiplier: num(g.rawMultiplier) ?? multiplier,
      wasBounded: g.wasBounded === true,
    };
  }

  const window = (r.window ?? {}) as Record<string, unknown>;

  return {
    model: {
      formatVersion: MODEL_FORMAT_VERSION,
      modelId: typeof r.modelId === "string" ? r.modelId : newModelId(),
      fittedAt: typeof r.fittedAt === "string" ? r.fittedAt : new Date(0).toISOString(),
      fittedOn: num(r.fittedOn) ?? 0,
      window: {
        from: typeof window.from === "string" ? window.from : null,
        to: typeof window.to === "string" ? window.to : null,
      },
      currencyCode: typeof r.currencyCode === "string" ? r.currencyCode : "USD",
      baseValue,
      calibrationFactor,
      cap: num(r.cap),
      factors,
      gate,
      customSignalKeys: Array.isArray(r.customSignalKeys)
        ? r.customSignalKeys.filter((k): k is string => typeof k === "string")
        : [],
      audience: r.audience === "b2c" ? "b2c" : "b2b",
      claims: Array.isArray(r.claims)
        ? (r.claims as unknown[])
            .filter((c): c is FactorHypothesis => {
              if (!c || typeof c !== "object") return false;
              const h = c as Record<string, unknown>;
              return typeof h.factorKey === "string" && typeof h.claim === "string";
            })
            .map((c) => ({ ...c, statedLevels: c.statedLevels ?? [] }))
        : [],
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/**
 * Rebuilds the in-memory shape the valuing code already understands, with
 * every multiplier frozen at what was saved. Nothing is refitted here - the
 * whole point is that today's rows do not move today's prices.
 */
export function savedModelToValueModel(saved: SavedValueModel): ValueModel {
  const factors: ModelFactor[] = saved.factors.map((f) => {
    const claim = saved.claims.find((c) => c.factorKey === f.key) ?? null;
    return {
      key: f.key,
      label: f.label,
      levels: f.levels.map((l) => ({
        level: l.level,
        sampleSize: l.sampleSize,
        won: Math.round(l.sampleSize * l.closeRate),
        closeRate: l.closeRate,
        medianWonAmount: l.medianWonAmount,
        avgWonAmount: l.avgWonAmount,
        expectedValue: round(saved.baseValue * l.multiplier),
        lift: l.multiplier,
        usable: true,
      })),
      strongestLift: f.levels.reduce(
        (best, l) => Math.max(best, Math.max(l.multiplier, 1 / l.multiplier)),
        1
      ),
      included: true,
      droppedReason: null,
      userClaim: claim?.claim ?? null,
      statedLevels: claim?.statedLevels ?? [],
    };
  });

  return {
    baseValue: saved.baseValue,
    calibrationFactor: saved.calibrationFactor,
    cap: saved.cap,
    factors,
    includedFactors: factors,
    droppedFactors: [],
    refutedClaims: [],
    isFlat: factors.length === 0,
    audience: saved.audience ?? "b2b",
    fittedOn: saved.fittedOn,
    currencyCode: saved.currencyCode,
  };
}

/**
 * Which of a saved model's rules can actually fire on this file. A rule whose
 * column was not mapped this time is silently inert, which is exactly the kind
 * of thing that must be said out loud rather than discovered later.
 */
export interface Applicability {
  key: string;
  label: string;
  dealsCovered: number;
  coverage: number;
}

export function checkApplicability(
  saved: SavedValueModel,
  deals: MappedDeal[],
  reportingCurrency?: string
): { factors: Applicability[]; inert: Applicability[]; currencyMismatch: string | null } {
  const defs = buildFactorList(
    saved.factors.map((f) => f.key).filter((k) => !CORE_KEYS.has(k)),
    saved.audience ?? "b2b"
  );

  const factors = saved.factors.map((f) => {
    const def = defs.find((d) => d.key === f.key);
    const covered = def
      ? deals.filter((d) => {
          const level = def.levelOf(d);
          return level !== null && f.levels.some((l) => l.level === level);
        }).length
      : 0;
    return {
      key: f.key,
      label: f.label,
      dealsCovered: covered,
      coverage: deals.length > 0 ? round(covered / deals.length, 3) : 0,
    };
  });

  // A model fitted in one currency prices leads in that currency. Applying it
  // to a file reported in another would emit numbers that look right and are
  // wrong by the exchange rate.
  const currencyMismatch =
    reportingCurrency && reportingCurrency !== saved.currencyCode
      ? `This model was fitted in ${saved.currencyCode}, and this file is reported in ${reportingCurrency}. Refit before using it, or switch the reporting currency back.`
      : null;

  return {
    factors,
    inert: factors.filter((f) => f.dealsCovered === 0),
    currencyMismatch,
  };
}

// ---------------------------------------------------------------------------
// Drift - has the data moved enough to justify refitting?
// ---------------------------------------------------------------------------

export interface LevelDrift {
  level: string;
  savedMultiplier: number | null;
  freshMultiplier: number | null;
  /** Relative change, saved → fresh. Null when the level is new or gone. */
  change: number | null;
}

export interface FactorDrift {
  key: string;
  label: string;
  status: "held" | "moved" | "added" | "removed";
  levels: LevelDrift[];
  /** Largest absolute relative change across levels present in both. */
  largestChange: number;
}

export interface ModelDrift {
  baseValueChange: number;
  factors: FactorDrift[];
  largestChange: number;
  verdict: "HOLD" | "REFIT";
  reasons: string[];
}

function relativeChange(from: number, to: number): number {
  if (from === 0) return to === 0 ? 0 : 1;
  return (to - from) / from;
}

/**
 * Compares a saved model against what the same engine would fit on today's
 * file. Nothing here changes a value - it only answers whether the saved rules
 * still describe the business, and says why.
 */
export function compareToFresh(saved: SavedValueModel, fresh: ValueModel): ModelDrift {
  const reasons: string[] = [];
  const baseValueChange = round(relativeChange(saved.baseValue, fresh.baseValue), 4);

  if (Math.abs(baseValueChange) > DRIFT_THRESHOLD) {
    reasons.push(
      `Your average lead is worth ${Math.abs(Math.round(baseValueChange * 100))}% ${baseValueChange > 0 ? "more" : "less"} than when this model was fitted`
    );
  }

  const freshByKey = new Map(fresh.includedFactors.map((f) => [f.key, f]));
  const savedByKey = new Map(saved.factors.map((f) => [f.key, f]));
  const keys = [...new Set([...savedByKey.keys(), ...freshByKey.keys()])];

  const factors: FactorDrift[] = [];
  let largestChange = Math.abs(baseValueChange);

  for (const key of keys) {
    const s = savedByKey.get(key);
    const f = freshByKey.get(key);

    if (s && !f) {
      factors.push({
        key,
        label: s.label,
        status: "removed",
        levels: s.levels.map((l) => ({
          level: l.level,
          savedMultiplier: l.multiplier,
          freshMultiplier: null,
          change: null,
        })),
        largestChange: 0,
      });
      reasons.push(`${s.label} no longer clears the threshold on this data`);
      continue;
    }

    if (!s && f) {
      factors.push({
        key,
        label: f.label,
        status: "added",
        levels: f.levels
          .filter((l) => l.usable)
          .map((l) => ({
            level: l.level,
            savedMultiplier: null,
            freshMultiplier: l.lift,
            change: null,
          })),
        largestChange: 0,
      });
      reasons.push(`${f.label} now clears the threshold and is not in your saved model`);
      continue;
    }

    if (!s || !f) continue;

    const levels: LevelDrift[] = [];
    let worst = 0;
    const levelNames = [
      ...new Set([
        ...s.levels.map((l) => l.level),
        ...f.levels.filter((l) => l.usable).map((l) => l.level),
      ]),
    ];

    for (const name of levelNames) {
      const sl = s.levels.find((l) => l.level === name) ?? null;
      const fl = f.levels.find((l) => l.level === name && l.usable) ?? null;
      const change =
        sl && fl ? round(relativeChange(sl.multiplier, fl.lift), 4) : null;
      if (change !== null) worst = Math.max(worst, Math.abs(change));
      levels.push({
        level: name,
        savedMultiplier: sl?.multiplier ?? null,
        freshMultiplier: fl?.lift ?? null,
        change,
      });
    }

    largestChange = Math.max(largestChange, worst);
    const moved = worst > DRIFT_THRESHOLD;
    if (moved) {
      reasons.push(
        `${s.label} has moved by up to ${Math.round(worst * 100)}% since this model was fitted`
      );
    }
    factors.push({
      key,
      label: s.label,
      status: moved ? "moved" : "held",
      levels,
      largestChange: round(worst, 4),
    });
  }

  const structural = factors.some((f) => f.status === "added" || f.status === "removed");

  return {
    baseValueChange,
    factors,
    largestChange: round(largestChange, 4),
    verdict:
      structural || largestChange > DRIFT_THRESHOLD || Math.abs(baseValueChange) > DRIFT_THRESHOLD
        ? "REFIT"
        : "HOLD",
    reasons,
  };
}

/**
 * Rebuilds the shape buildFeedRows understands from a frozen gate.
 *
 * Nothing is measured here. The multiplier is whatever was saved, and the
 * counts come along so the rule stays explainable in a scheduled run's report
 * exactly as it was on screen.
 */
export function savedGateToGateValue(saved: SavedValueModel): GateValue | null {
  const gate = saved.gate;
  if (!gate) return null;
  return {
    available: true,
    stage: gate.stage,
    multiplier: gate.multiplier,
    reachedCount: gate.reachedCount,
    notReachedCount: 0,
    closeRateReached: gate.closeRateReached,
    closeRateNotReached: gate.closeRateNotReached,
    medianWonReached: null,
    withinWindowRate: gate.withinWindowRate,
    rawMultiplier: gate.rawMultiplier,
    wasBounded: gate.wasBounded,
    unusableReason: null,
  };
}
