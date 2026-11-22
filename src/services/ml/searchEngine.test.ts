import { describe, it, expect } from "vitest";
import {
  damerauLevenshtein,
  getDrugSearchIndex,
  matchesSmartSearch,
  normalizeSearchText,
  searchDrugs,
} from "./searchEngine";
import { seedData } from "../../data/seedData";

describe("Offline BM25 + Fuzzy Clinical Search Engine", () => {
  it("normalizes Persian alef variants, Arabic kaf/yeh, diacritics and digits", () => {
    expect(normalizeSearchText("آلپرازولام")).toBe("الپرازولام");
    expect(normalizeSearchText("هیدروکسی‌زین")).toBe("هیدروکسی زین");
    expect(normalizeSearchText("كِتورولاك ۳۲")).toBe("کتورولاک 32");
  });

  it("preserves exact single-hit precision for canonical Persian and brand searches", () => {
    expect(seedData.filter((d) => matchesSmartSearch(d, "وارفارین"))).toHaveLength(1);
    expect(seedData.filter((d) => matchesSmartSearch(d, "هیدروکسی‌زین"))).toHaveLength(1);
    const xanax = seedData.filter((d) => matchesSmartSearch(d, "Xanax"));
    expect(xanax).toHaveLength(1);
    expect(xanax[0].id).toBe("alprazolam");
  });

  it("tolerates common Persian and English spelling typos without false positives", () => {
    const warfarinTypo = searchDrugs(seedData, "وارفرین");
    expect(warfarinTypo[0]?.drug.id).toBe("warfarin");

    const omeprazoleTypo = searchDrugs(seedData, "امپرزول");
    expect(omeprazoleTypo.some((h) => h.drug.id === "omeprazole")).toBe(true);

    const englishTypo = searchDrugs(seedData, "alprazolom");
    expect(englishTypo[0]?.drug.id).toBe("alprazolam");
  });

  it("supports ATC code lookup and clinical synonym expansion", () => {
    const byAtc = searchDrugs(seedData, "B01AA03");
    expect(byAtc[0]?.drug.id).toBe("warfarin");

    const bySynonym = searchDrugs(seedData, "آلزایمر");
    expect(bySynonym.length).toBeGreaterThan(0);
    expect(
      bySynonym.some((h) =>
        h.drug.drugDiseaseInteractions.some((i) =>
          i.condition.toLowerCase().includes("dementia"),
        ),
      ),
    ).toBe(true);
  });

  it("computes bounded Damerau-Levenshtein distance with transpositions", () => {
    expect(damerauLevenshtein("warfarin", "wafrarin", 2)).toBe(1);
    expect(damerauLevenshtein("warfarin", "warfrin", 2)).toBe(1);
    expect(damerauLevenshtein("warfarin", "omeprazole", 2)).toBeGreaterThan(2);
  });

  it("caches the search index per registry array reference", () => {
    const idx1 = getDrugSearchIndex(seedData);
    const idx2 = getDrugSearchIndex(seedData);
    expect(idx1).toBe(idx2);
  });
});
