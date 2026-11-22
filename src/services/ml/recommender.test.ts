import { describe, it, expect } from "vitest";
import {
  buildDrugFeatureVector,
  cosineSimilarity,
  recommendDrugSubstitutions,
} from "./recommender";
import { seedData } from "../../data/seedData";

const getDrug = (id: string) => {
  const d = seedData.find((x) => x.id === id);
  if (!d) throw new Error(`Drug ${id} not found`);
  return d;
};

describe("Data-driven Vector Similarity Recommender (Phase 3)", () => {
  it("computes higher cosine similarity for same-ATC-family drugs than unrelated drugs", () => {
    const warfVec = buildDrugFeatureVector(getDrug("warfarin"));
    const apixVec = buildDrugFeatureVector(getDrug("apixaban"));
    const omepVec = buildDrugFeatureVector(getDrug("omeprazole"));

    expect(cosineSimilarity(warfVec, apixVec)).toBeGreaterThan(
      cosineSimilarity(warfVec, omepVec),
    );
  });

  it("preserves curated Beers 2023 recommendations first", () => {
    const recs = recommendDrugSubstitutions([getDrug("warfarin")]);
    expect(recs).toHaveLength(1);
    expect(recs[0].recommendedAlternatives[0].genericName).toBe("Apixaban");
    expect(recs[0].recommendedAlternatives[0].source).toBe("curated_beers");
  });

  it("automatically generates recommendations for CMS/registry PIM drugs without hardcoded rules", () => {
    const hydroxyzine = getDrug("hydroxyzine");
    const recs = recommendDrugSubstitutions([hydroxyzine]);
    expect(recs).toHaveLength(1);
    expect(recs[0].flaggedDrugId).toBe("hydroxyzine");
    expect(recs[0].recommendedAlternatives.length).toBeGreaterThan(0);
    expect(recs[0].recommendedAlternatives[0].source).toBe("cms_record");
  });

  it("never suggests a PIM_GENERAL or renally contraindicated neighbor via k-NN", () => {
    const customFlagged = {
      ...getDrug("warfarin"),
      id: "custom-anticoag-pim",
      genericName: "Phenprocoumon",
      genericNameFa: "فنپروکومون",
      saferAlternatives: [],
    };
    const recs = recommendDrugSubstitutions([customFlagged], {
      registry: seedData,
      profile: { CrCl: 80 },
    });
    expect(recs).toHaveLength(1);
    const knnAlts = recs[0].recommendedAlternatives.filter(
      (a) => a.source === "vector_knn",
    );
    expect(knnAlts.length).toBeGreaterThan(0);
    for (const alt of knnAlts) {
      const match = seedData.find((d) => d.genericName === alt.genericName);
      expect(match).toBeDefined();
      expect(match?.beersCategories.includes("PIM_GENERAL")).toBe(false);
    }
  });
});
