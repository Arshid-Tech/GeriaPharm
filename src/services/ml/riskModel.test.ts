import { describe, it, expect } from "vitest";
import { evaluateAdverseDrugReactionRisk } from "./riskModel";
import { cockcroftGault } from "../checker";
import { seedData } from "../../data/seedData";

const getDrug = (id: string) => {
  const found = seedData.find((d) => d.id === id);
  if (!found) throw new Error(`Drug ${id} not found`);
  return found;
};

describe("riskModel calibrated logistic regression, renal separation and unified Cockcroft-Gault", () => {
  it("does not conflate CrCl with eGFR thresholds in risk scoring", () => {
    const baclofen = getDrug("baclofen"); // eGFR < 60 mL/min
    const onlyCrCl = evaluateAdverseDrugReactionRisk([baclofen], [], {
      CrCl: 20,
    });
    expect(onlyCrCl.rawBreakdown.renalMismatchPenalty).toBe(0);

    const withLowEgfr = evaluateAdverseDrugReactionRisk([baclofen], [], {
      eGFR: 45,
    });
    expect(withLowEgfr.rawBreakdown.renalMismatchPenalty).toBe(15);
    expect(withLowEgfr.probability).toBeGreaterThan(onlyCrCl.probability);
  });

  it("applies IBW/AdjBW via calculateRenalMetrics when height is provided", () => {
    const crcl = cockcroftGault({
      sex: "female",
      height: 152.4,
      weight: 80,
      age: 75,
      serumCreatinine: 1.2,
    });
    expect(crcl).toBeCloseTo(37.9, 0.5);
  });

  it("outputs calibrated probability in [0, 1] and additive feature attributions", () => {
    const res = evaluateAdverseDrugReactionRisk(
      [getDrug("amitriptyline"), getDrug("alprazolam"), getDrug("tramadol")],
      ["Dementia"],
      { age: 82, CrCl: 25 },
    );
    expect(res.probability).toBeGreaterThan(0);
    expect(res.probability).toBeLessThanOrEqual(1);
    expect(res.modelVersion).toContain("geriapharm-adr-logreg");
    expect(res.attributions.length).toBeGreaterThanOrEqual(3);
    const totalShare = res.attributions.reduce((s, a) => s + a.sharePercent, 0);
    expect(totalShare).toBeGreaterThanOrEqual(95);
    expect(totalShare).toBeLessThanOrEqual(105);
  });

  it("returns zero probability for an empty regimen", () => {
    const res = evaluateAdverseDrugReactionRisk([], [], {});
    expect(res.score).toBe(0);
    expect(res.probability).toBe(0);
    expect(res.attributions).toEqual([]);
  });
});
