import { describe, it, expect } from "vitest";
import { evaluateAdverseDrugReactionRisk } from "./riskModel";
import { cockcroftGault } from "../checker";
import { seedData } from "../../data/seedData";

const getDrug = (id: string) => {
  const found = seedData.find((d) => d.id === id);
  if (!found) throw new Error(`Drug ${id} not found`);
  return found;
};

describe("riskModel renal metric separation and unified Cockcroft-Gault", () => {
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
});
