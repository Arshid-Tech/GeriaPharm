import { describe, it, expect } from "vitest";
import { generateDeprescribingProtocols } from "./deprescribingModel";
import { seedData } from "../../data/seedData";
import type { DrugRecord } from "../../types/types";

const getDrug = (id: string) => {
  const found = seedData.find((d) => d.id === id);
  if (!found) throw new Error(`Drug ${id} not found`);
  return found;
};

describe("Class- and ATC-aware Deprescribing Protocols (Phase 5)", () => {
  it("covers registry drugs via ATC/class/STOPPFall beyond hardcoded names", () => {
    const protocols = generateDeprescribingProtocols([
      getDrug("dexlansoprazole"),
      getDrug("triazolam"),
      getDrug("zaleplon"),
      getDrug("gliclazide"),
      getDrug("cyclobenzaprine"),
    ]);

    expect(protocols).toHaveLength(5);
    expect(protocols.map((p) => p.targetDrugId)).toEqual([
      "dexlansoprazole",
      "triazolam",
      "zaleplon",
      "gliclazide",
      "cyclobenzaprine",
    ]);
  });

  it("automatically activates deprescribing for CMS-added medications using ATC or drugClasses", () => {
    const cmsPpi: DrugRecord = {
      ...getDrug("omeprazole"),
      id: "ilaprazole",
      genericName: "Ilaprazole",
      genericNameFa: "ایلاپرازول",
      atcCode: "A02BC06",
      drugClasses: ["Proton-pump inhibitors"],
    };
    const cmsBenzo: DrugRecord = {
      ...getDrug("alprazolam"),
      id: "bromazepam",
      genericName: "Bromazepam",
      genericNameFa: "برومازپام",
      atcCode: "N05BA08",
      drugClasses: ["Benzodiazepines"],
    };

    const protocols = generateDeprescribingProtocols([cmsPpi, cmsBenzo]);
    expect(protocols).toHaveLength(2);
    expect(protocols[0].targetDrugId).toBe("ilaprazole");
    expect(protocols[1].targetDrugId).toBe("bromazepam");
  });

  it("deduplicates repeated medication entries", () => {
    const omep = getDrug("omeprazole");
    const protocols = generateDeprescribingProtocols([omep, omep]);
    expect(protocols).toHaveLength(1);
  });
});
