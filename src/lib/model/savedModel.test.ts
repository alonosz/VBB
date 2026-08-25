import { describe, expect, it } from "vitest";
import {
  saveValueModel,
  loadSavedModel,
  savedModelToValueModel,
  checkApplicability,
  compareToFresh,
  DRIFT_THRESHOLD,
  MODEL_FORMAT_VERSION,
} from "./savedModel";
import { buildValueModel, valueLead } from "@/lib/analysis/valueModel";
import type { MappedDeal } from "@/lib/analysis/types";

const DAY = new Date("2026-06-01T00:00:00Z");
const NOW = new Date("2026-06-15T12:00:00Z");

function deal(p: Partial<MappedDeal> & { id: string }): MappedDeal {
  return {
    createdAt: DAY,
    closedAt: DAY,
    outcome: "lost",
    amount: null,
    stage: null,
    source: "Paid Search",
    email: null,
    clickId: null,
    ...p,
  };
}

function cohort(
  prefix: string,
  n: number,
  wonCount: number,
  amount: number,
  attrs: Partial<MappedDeal>
): MappedDeal[] {
  return Array.from({ length: n }, (_, i) =>
    deal({
      id: `${prefix}-${i}`,
      outcome: i < wonCount ? "won" : "lost",
      amount: i < wonCount ? amount : null,
      ...attrs,
    })
  );
}

/** Corporate email closes well; free webmail does not. */
const STRONG = [
  ...cohort("corp", 80, 40, 20_000, { email: "a@acme.com" }),
  ...cohort("free", 80, 8, 5_000, { email: "a@gmail.com" }),
];

/** The same shape, but every lead is worth roughly half as much. */
const HALVED = [
  ...cohort("corp", 80, 20, 20_000, { email: "a@acme.com" }),
  ...cohort("free", 80, 4, 5_000, { email: "a@gmail.com" }),
];

function fit(deals: MappedDeal[]) {
  return buildValueModel({ deals, cap: null, currencyCode: "USD" });
}

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

describe("saving and loading", () => {
  const model = fit(STRONG);
  const saved = saveValueModel(model, { deals: STRONG, now: NOW, modelId: "m1" });

  it("records when and on what it was fitted", () => {
    expect(saved.formatVersion).toBe(MODEL_FORMAT_VERSION);
    expect(saved.fittedAt).toBe(NOW.toISOString());
    expect(saved.fittedOn).toBe(160);
    expect(saved.window).toEqual({ from: "2026-06-01", to: "2026-06-01" });
  });

  it("survives a JSON round trip unchanged", () => {
    const { model: back, error } = loadSavedModel(JSON.parse(JSON.stringify(saved)));
    expect(error).toBeNull();
    expect(back).toEqual(saved);
  });

  it("prices a lead identically to the model it was saved from", () => {
    const { model: back } = loadSavedModel(JSON.parse(JSON.stringify(saved)));
    const rebuilt = savedModelToValueModel(back!);
    for (const d of [STRONG[0], STRONG[100]]) {
      expect(valueLead(d, rebuilt).value).toBe(valueLead(d, model).value);
    }
  });

  it("saves only levels that cleared the sample floor", () => {
    const deals = [...STRONG, ...cohort("tiny", 5, 3, 90_000, { email: "a@rare.dev" })];
    const s = saveValueModel(fit(deals), { deals, now: NOW });
    const domain = s.factors.find((f) => f.key === "domainType")!;
    // "rare.dev" is corporate, so it folds into the corporate level rather
    // than becoming a level of its own — but nothing under the floor is saved.
    expect(domain.levels.every((l) => l.sampleSize >= 25)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The guarantee the whole feature exists for
// ---------------------------------------------------------------------------

describe("a frozen model does not move with the file", () => {
  it("gives the same lead the same value on a different day's export", () => {
    const june = fit(STRONG);
    const saved = loadSavedModel(
      JSON.parse(JSON.stringify(saveValueModel(june, { deals: STRONG, now: NOW })))
    ).model!;
    const frozen = savedModelToValueModel(saved);

    // A refit on the later, weaker file prices the same lead differently.
    const july = fit(HALVED);
    const lead = deal({ id: "x", email: "someone@acme.com", outcome: "open" });

    expect(valueLead(lead, july).value).not.toBe(valueLead(lead, june).value);
    // The saved model does not care which file is in front of it.
    expect(valueLead(lead, frozen).value).toBe(valueLead(lead, june).value);
  });
});

// ---------------------------------------------------------------------------
// Loading is a trust boundary too
// ---------------------------------------------------------------------------

describe("loadSavedModel", () => {
  const good = saveValueModel(fit(STRONG), { deals: STRONG, now: NOW, modelId: "m1" });

  it("refuses something that is not a model", () => {
    expect(loadSavedModel("nope").error).toMatch(/isn't a saved model/);
    expect(loadSavedModel(null).error).toBeTruthy();
    expect(loadSavedModel({ hello: 1 }).error).toMatch(/format version/);
  });

  it("refuses a model saved in a format this build cannot read", () => {
    const r = loadSavedModel({ ...good, formatVersion: 99 });
    expect(r.model).toBeNull();
    expect(r.error).toMatch(/v99/);
  });

  it("refuses a model with no base value rather than pricing everything at zero", () => {
    expect(loadSavedModel({ ...good, baseValue: 0 }).error).toMatch(/base value/);
  });

  it("drops a factor whose levels are unusable rather than applying a broken rule", () => {
    const r = loadSavedModel({
      ...good,
      factors: [{ key: "domainType", label: "Email domain", levels: [{ level: "corp", multiplier: -1 }] }],
    });
    expect(r.error).toBeNull();
    expect(r.model!.factors).toEqual([]);
  });

  it("loads a model with no factors as a flat model, not an error", () => {
    const r = loadSavedModel({ ...good, factors: [] });
    expect(r.error).toBeNull();
    expect(savedModelToValueModel(r.model!).isFlat).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Applicability — a rule whose column is missing is inert, and must say so
// ---------------------------------------------------------------------------

describe("checkApplicability", () => {
  it("reports how much of the file each saved rule covers", () => {
    const saved = saveValueModel(fit(STRONG), { deals: STRONG, now: NOW });
    const a = checkApplicability(saved, STRONG);
    expect(a.factors.find((f) => f.key === "domainType")!.coverage).toBe(1);
    expect(a.inert).toEqual([]);
  });

  it("flags a rule that cannot fire because its column is not in this file", () => {
    const saved = saveValueModel(fit(STRONG), { deals: STRONG, now: NOW });
    const noEmails = STRONG.map((d) => ({ ...d, email: null }));
    const a = checkApplicability(saved, noEmails);
    expect(a.inert.map((f) => f.key)).toContain("domainType");
  });
});

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

describe("compareToFresh", () => {
  const saved = saveValueModel(fit(STRONG), { deals: STRONG, now: NOW });

  it("holds when the data has not moved", () => {
    const drift = compareToFresh(saved, fit(STRONG));
    expect(drift.verdict).toBe("HOLD");
    expect(drift.largestChange).toBeLessThanOrEqual(DRIFT_THRESHOLD);
    expect(drift.reasons).toEqual([]);
    expect(drift.factors.every((f) => f.status === "held")).toBe(true);
  });

  it("calls for a refit when the average lead is worth much less", () => {
    const drift = compareToFresh(saved, fit(HALVED));
    expect(drift.verdict).toBe("REFIT");
    expect(drift.baseValueChange).toBeLessThan(-DRIFT_THRESHOLD);
    expect(drift.reasons.join(" ")).toMatch(/worth \d+% less/);
  });

  it("calls for a refit when a rule stops holding up", () => {
    // Domain no longer separates the two groups at all.
    const flat = [
      ...cohort("corp", 80, 24, 10_000, { email: "a@acme.com" }),
      ...cohort("free", 80, 24, 10_000, { email: "a@gmail.com" }),
    ];
    const drift = compareToFresh(saved, fit(flat));
    expect(drift.verdict).toBe("REFIT");
    expect(drift.factors.find((f) => f.key === "domainType")!.status).toBe("removed");
    expect(drift.reasons.join(" ")).toMatch(/no longer clears the threshold/);
  });

  it("calls for a refit when a new rule starts holding up", () => {
    const withTitles = STRONG.map((d, i) => ({
      ...d,
      contactTitle: i % 2 === 0 ? "VP of Operations" : "Analyst",
      outcome: i % 2 === 0 ? ("won" as const) : ("lost" as const),
      amount: i % 2 === 0 ? 20_000 : null,
    }));
    const drift = compareToFresh(saved, fit(withTitles));
    expect(drift.verdict).toBe("REFIT");
    expect(drift.factors.some((f) => f.status === "added")).toBe(true);
  });

  it("reports the direction and size of each level's move", () => {
    const drift = compareToFresh(saved, fit(HALVED));
    const domain = drift.factors.find((f) => f.key === "domainType")!;
    const corp = domain.levels.find((l) => l.level === "Corporate email")!;
    expect(corp.savedMultiplier).toBeGreaterThan(0);
    expect(corp.freshMultiplier).toBeGreaterThan(0);
    expect(typeof corp.change).toBe("number");
  });
});

describe("currency", () => {
  it("refuses to let a model fitted in one currency price a file in another", () => {
    const saved = saveValueModel(fit(STRONG), { deals: STRONG, now: NOW });
    expect(checkApplicability(saved, STRONG, "USD").currencyMismatch).toBeNull();
    expect(checkApplicability(saved, STRONG, "EUR").currencyMismatch).toMatch(/USD.*EUR/);
  });
});
