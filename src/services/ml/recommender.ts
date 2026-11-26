import type { DrugRecord } from "../../types/types";
import {
  type PatientProfile,
  acbScoreFor,
  classesFor,
  cockcroftGault,
  parseThreshold,
} from "../checker";
import { stoppFallClassesFor } from "./geriatricRiskPanel";
import { drugName, fa } from "../../lib/fa";

export type RecommendationSource =
  | "curated_beers"
  | "cms_record"
  | "vector_knn";

export interface RecommendedAlternative {
  genericName: string;
  genericNameFa: string;
  category: string;
  evidenceRationale: string;
  clinicalDosingNotes?: string;
  source?: RecommendationSource;
  similarityScore?: number;
}

export interface DrugSubstitutionRecommendation {
  flaggedDrugId: string;
  flaggedDrugName: string;
  flaggedDrugFa: string;
  recommendedAlternatives: RecommendedAlternative[];
}

export interface RecommendationOptions {
  /** Verified drug registry to search for safer pharmacologic neighbors. */
  registry?: DrugRecord[];
  /** Active patient conditions used as a hard safety filter (zero contraindicated suggestions). */
  selectedConditions?: string[];
  /** Patient renal/demographic profile used to exclude renally unsafe candidates. */
  profile?: PatientProfile;
}

/**
 * Builds a sparse pharmacologic feature vector for a medication from its
 * ATC hierarchy (levels 1–4), therapeutic category, and pharmacologic classes.
 */
export function buildDrugFeatureVector(med: DrugRecord): Map<string, number> {
  const vec = new Map<string, number>();
  const add = (key: string, weight: number) => {
    if (!key) return;
    vec.set(key, (vec.get(key) ?? 0) + weight);
  };

  const atc = (med.atcCode ?? "").trim().toUpperCase();
  if (atc.length >= 1) add(`atc1:${atc.slice(0, 1)}`, 0.8);
  if (atc.length >= 3) add(`atc2:${atc.slice(0, 3)}`, 1.8);
  if (atc.length >= 4) add(`atc3:${atc.slice(0, 4)}`, 2.6);
  if (atc.length >= 5) add(`atc4:${atc.slice(0, 5)}`, 3.2);

  if (med.therapeuticCategory) {
    add(`cat:${med.therapeuticCategory.toLowerCase().trim()}`, 1.5);
  }
  for (const cls of classesFor(med)) {
    add(`cls:${cls}`, 2.4);
  }
  return vec;
}

/** Cosine similarity between two sparse pharmacologic feature vectors in [0, 1]. */
export function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [k, v] of a) {
    normA += v * v;
    const bv = b.get(k);
    if (bv !== undefined) dot += v * bv;
  }
  for (const v of b.values()) normB += v * v;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function hasConditionConflict(
  candidate: DrugRecord,
  selectedConditions: string[],
  sex?: "male" | "female",
): boolean {
  if (!selectedConditions.length) return false;
  const normalizedSelected = selectedConditions.map((c) =>
    c.toLowerCase().trim(),
  );
  for (const ddi of candidate.drugDiseaseInteractions || []) {
    const cond = ddi.condition.toLowerCase();
    if ((cond.includes("bph") || cond.includes("prostatic")) && sex === "female")
      continue;
    if (
      normalizedSelected.some(
        (sc) => sc.includes(cond) || cond.includes(sc),
      )
    ) {
      return true;
    }
  }
  return false;
}

function hasRenalViolation(
  candidate: DrugRecord,
  profile: PatientProfile,
): boolean {
  if (!candidate.renalConsiderations) return false;
  const rule = parseThreshold(candidate.renalConsiderations.threshold);
  if (!rule) return false;
  const crcl = profile.CrCl ?? cockcroftGault(profile);
  const val = rule.metric === "CrCl" ? crcl : profile.eGFR;
  if (val === undefined || !Number.isFinite(val) || val < 0) return false;
  return rule.test(val);
}

/**
 * Curated Beers 2023 evidence-based substitutions (highest clinical priority).
 * Preserves all existing clinical content verbatim.
 */
function curatedBeersAlternatives(med: DrugRecord): RecommendedAlternative[] {
  const name = med.genericName.toLowerCase();

  // 1. Rivaroxaban / Warfarin -> Apixaban
  if (name.includes("rivaroxaban") || name.includes("warfarin")) {
    return [
      {
        genericName: "Apixaban",
        genericNameFa: "آپیکسابان (Eliquis)",
        category: "ضدانعقاد خوراکی مستقیم (DOAC)",
        evidenceRationale:
          "بر اساس معیارهای ۲۰۲۳ بیرز، آپیکسابان نسبت به وارفارین و ریواروکسابان ایمنی بالاتری دارد و نرخ خونریزی گوارشی و عمده در سالمندان با آن کمتر است.",
        clinicalDosingNotes:
          "دوز ۵ میلی‌گرم دوبار در روز؛ در صورت ۲ معیار از ۳ معیار (سن ≥ ۸۰، وزن ≤ ۶۰، کراتینین ≥ ۱.۵) دوز به ۲.۵ میلی‌گرم تعدیل گردد.",
        source: "curated_beers",
      },
    ];
  }

  // 2. Glibenclamide / Glimepiride -> Glipizide or DPP-4i
  if (
    name.includes("glibenclamide") ||
    name.includes("glyburide") ||
    name.includes("glimepiride")
  ) {
    return [
      {
        genericName: "Linagliptin / Sitagliptin",
        genericNameFa: "لیناگلیپتین یا سیتاگلیپتین (DPP-4i)",
        category: "ضددیابت مدرن بدون خطر افت قند خون",
        evidenceRationale:
          "مهارکننده‌های DPP-4 ریسک هیپوگلیسمی ندارند و لیناگلیپتین حتی در نارسایی شدید کلیوی نیاز به تعدیل دوز ندارد.",
        clinicalDosingNotes: "لیناگلیپتین ۵ میلی‌گرم روزانه خوراکی.",
        source: "curated_beers",
      },
      {
        genericName: "Glipizide",
        genericNameFa: "گلی‌پیزید",
        category: "سولفونیل‌اوره کوتاه‌اثر",
        evidenceRationale:
          "در صورت الزام به سولفونیل‌اوره، گلی‌پیزید به دلیل نیمه‌عمر کوتاه‌تر نسبت به گلی‌بن‌کلامید ترجیح داده می‌شود.",
        clinicalDosingNotes: "شروع با ۲.۵ تا ۵ میلی‌گرم قبل از صبحانه.",
        source: "curated_beers",
      },
    ];
  }

  // 3. Amitriptyline / Doxepin / Paroxetine -> Sertraline / Escitalopram
  if (
    name.includes("amitriptyline") ||
    name.includes("doxepin") ||
    name.includes("paroxetine") ||
    name.includes("imipramine") ||
    name.includes("clomipramine")
  ) {
    return [
      {
        genericName: "Sertraline",
        genericNameFa: "سرترالین (Zoloft)",
        category: "مهارکننده بازجذب سروتونین (SSRI)",
        evidenceRationale:
          "حداقل بار آنتی‌کولینرژیک، کمترین افت فشار خون وضعیتی و ایمنی قلبی اثبات‌شده در سالمندان در مقایسه با ضد‌افسردگی‌های سه‌حلقه‌ای.",
        clinicalDosingNotes:
          "شروع با ۲۵ میلی‌گرم روزانه و افزایش تدریجی تا ۵۰ الی ۱۰۰ میلی‌گرم.",
        source: "curated_beers",
      },
      {
        genericName: "Escitalopram",
        genericNameFa: "اس‌سیتالوپرام (Cipralex)",
        category: "مهارکننده بازجذب سروتونین (SSRI)",
        evidenceRationale:
          "پروفایل تداخل دارویی ناچیز و فقدان اثرات آنتی‌کولینرژیک تضعیف‌کننده حافظه.",
        clinicalDosingNotes:
          "شروع با ۵ میلی‌گرم روزانه در سالمندان (حداکثر ۱۰ میلی‌گرم).",
        source: "curated_beers",
      },
    ];
  }

  // 4. Oral Indomethacin / Ketorolac / High-dose NSAIDs -> Topical NSAIDs / Acetaminophen
  if (
    name.includes("indomethacin") ||
    name.includes("ketorolac") ||
    name.includes("piroxicam") ||
    name.includes("naproxen") ||
    name.includes("ibuprofen") ||
    name.includes("diclofenac")
  ) {
    return [
      {
        genericName: "Topical Diclofenac",
        genericNameFa: "ژل موضعی دیکلوفناک (Voltaren)",
        category: "ضدالتهاب غیرکورتونی موضعی",
        evidenceRationale:
          "اثربخشی موضعی معادل NSAID خوراکی با جذب سیستمیک کمتر از ۵٪ و حفظ ایمنی گوارشی و کلیوی.",
        clinicalDosingNotes: "مالیدن ۲ تا ۴ گرم روی موضع روزانه ۳ تا ۴ بار.",
        source: "curated_beers",
      },
      {
        genericName: "Acetaminophen",
        genericNameFa: "استامینوفن خوراکی",
        category: "مسکن غیراپیوئیدی",
        evidenceRationale:
          "خط اول تسکین دردهای آرتروز بدون سمیت کلیوی، بدون زخم معده و بدون افزایش فشار خون.",
        clinicalDosingNotes:
          "۵۰۰ تا ۱۰۰۰ میلی‌گرم هر ۶ تا ۸ ساعت (سقف روزانه سالمندان حداکثر ۲ تا ۳ گرم).",
        source: "curated_beers",
      },
    ];
  }

  // 5. Oxybutynin -> Mirabegron / Bladder training
  if (name.includes("oxybutynin") || name.includes("tolterodine")) {
    return [
      {
        genericName: "Mirabegron",
        genericNameFa: "میرابگرون (Betmiga)",
        category: "آگونیست گیرنده بتا-۳ آدرنرژیک",
        evidenceRationale:
          "فاقد هرگونه اثر آنتی‌کولینرژیک؛ عدم ایجاد خشکی دهان، احتباس ادرار، یبوست یا تضعیف حافظه.",
        clinicalDosingNotes: "۲۵ تا ۵۰ میلی‌گرم روزانه؛ پایش دوره‌ای فشار خون توصیه می‌شود.",
        source: "curated_beers",
      },
      {
        genericName: "Behavioral Bladder Training",
        genericNameFa: "تمرینات کگل و بازآموزی رفتاری مثانه",
        category: "مداخله غیردارویی",
        evidenceRationale:
          "خط اول درمان بی‌اختیاری فوریتی ادرار در طب سالمندان با اثربخشی پایدار و بدون عوارض جانبی.",
        source: "curated_beers",
      },
    ];
  }

  // 6. Zolpidem / Diazepam -> Melatonin / CBT-I
  if (
    name.includes("zolpidem") ||
    name.includes("eszopiclone") ||
    name.includes("zopiclone") ||
    name.includes("temazepam") ||
    name.includes("triazolam")
  ) {
    return [
      {
        genericName: "Melatonin (Low-Dose)",
        genericNameFa: "ملاتونین خوراکی دوز پایین (۱ تا ۳ میلی‌گرم)",
        category: "تنظیم‌کننده چرخه خواب",
        evidenceRationale:
          "جایگزین فیزیولوژیک بدون افت تعادل، بدون فراموشی و بدون وابستگی جسمی.",
        clinicalDosingNotes: "۱ تا ۳ میلی‌گرم ۳۰ تا ۶۰ دقیقه قبل از خواب.",
        source: "curated_beers",
      },
      {
        genericName: "CBT-I",
        genericNameFa: "مشاوره شناختی-رفتاری بی‌خوابی و بهداشت خواب",
        category: "درمان استاندارد طلایی غیردارویی",
        evidenceRationale:
          "استاندارد طلایی خط اول درمان بی‌خوابی با اثربخشی ماندگار بدون تداخلات دارویی.",
        source: "curated_beers",
      },
    ];
  }

  return [];
}

/**
 * Finds strictly safer pharmacologic neighbors from the verified drug registry
 * using Cosine Similarity over ATC / class / category vectors.
 */
function findVectorSafeNeighbors(
  flagged: DrugRecord,
  registry: DrugRecord[],
  regimenIds: Set<string>,
  selectedConditions: string[],
  profile: PatientProfile,
  existingNames: Set<string>,
): RecommendedAlternative[] {
  const flaggedVec = buildDrugFeatureVector(flagged);
  const flaggedAcb = acbScoreFor(flagged);
  const flaggedFridCount = stoppFallClassesFor(flagged).length;

  const scored: {
    candidate: DrugRecord;
    similarity: number;
    rankScore: number;
  }[] = [];

  for (const candidate of registry) {
    if (candidate.id === flagged.id || regimenIds.has(candidate.id)) continue;
    // Hard safety guardrails (zero unsafe/hallucinated suggestions):
    if (candidate.beersCategories.includes("PIM_GENERAL")) continue;
    if (candidate.isStrongAnticholinergic) continue;
    const candAcb = acbScoreFor(candidate);
    if (candAcb >= 3 || candAcb > flaggedAcb) continue;
    if (hasConditionConflict(candidate, selectedConditions, profile.sex)) continue;
    if (hasRenalViolation(candidate, profile)) continue;

    const candNameLower = candidate.genericName.toLowerCase();
    if (
      [...existingNames].some(
        (ex) => ex.includes(candNameLower) || candNameLower.includes(ex),
      )
    ) {
      continue;
    }

    const sim = cosineSimilarity(flaggedVec, buildDrugFeatureVector(candidate));
    if (sim < 0.35) continue;

    const candFridCount = stoppFallClassesFor(candidate).length;
    const acbGain = Math.max(0, flaggedAcb - candAcb) * 0.08;
    const fridGain = Math.max(0, flaggedFridCount - candFridCount) * 0.06;
    const iranBonus = candidate.isAvailableInIran !== false ? 0.05 : 0;
    const rankScore = sim + acbGain + fridGain + iranBonus;

    scored.push({ candidate, similarity: sim, rankScore });
  }

  return scored
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, 2)
    .map(({ candidate, similarity }) => ({
      genericName: candidate.genericName,
      genericNameFa: drugName(candidate),
      category: `${fa(candidate.therapeuticCategory)} · مشابهت ${Math.round(similarity * 100)}٪`,
      evidenceRationale: candidate.recommendation,
      clinicalDosingNotes:
        candidate.isAvailableInIran === false
          ? "توجه: دسترسی این دارو در بازار ایران محدود است."
          : undefined,
      source: "vector_knn" as const,
      similarityScore: Number(similarity.toFixed(2)),
    }));
}

export function recommendDrugSubstitutions(
  medications: DrugRecord[],
  options: RecommendationOptions = {},
): DrugSubstitutionRecommendation[] {
  const registry = options.registry ?? [];
  const selectedConditions = options.selectedConditions ?? [];
  const profile = options.profile ?? {};
  const regimenIds = new Set(medications.map((m) => m.id));
  const recommendations: DrugSubstitutionRecommendation[] = [];

  for (const med of medications) {
    const nameFa = med.genericNameFa || med.genericName;
    const curated = curatedBeersAlternatives(med);
    const isFlagged =
      curated.length > 0 ||
      med.beersCategories.includes("PIM_GENERAL") ||
      med.isStrongAnticholinergic ||
      acbScoreFor(med) >= 3;

    if (!isFlagged) continue;

    const alts: RecommendedAlternative[] = [...curated];
    const existingNames = new Set(
      alts.map((a) => a.genericName.toLowerCase().split(" ")[0]),
    );

    // For CMS/registry medications without a hardcoded curated rule, surface
    // their own verified `saferAlternatives` first, then k-NN safe neighbors.
    if (alts.length === 0 && med.saferAlternatives.length > 0) {
      for (const altText of med.saferAlternatives.slice(0, 2)) {
        alts.push({
          genericName: altText,
          genericNameFa: altText,
          category: "جایگزین ثبت‌شده در مرجع بیرز ۲۰۲۳",
          evidenceRationale: med.recommendation,
          source: "cms_record",
        });
        existingNames.add(altText.toLowerCase());
      }
    }

    // Supplement with safe k-NN pharmacologic neighbors from the verified registry
    if (alts.length < 2 && registry.length > 0) {
      const neighbors = findVectorSafeNeighbors(
        med,
        registry,
        regimenIds,
        selectedConditions,
        profile,
        existingNames,
      );
      for (const n of neighbors) {
        if (alts.length >= 3) break;
        alts.push(n);
      }
    }

    if (alts.length > 0) {
      recommendations.push({
        flaggedDrugId: med.id,
        flaggedDrugName: med.genericName,
        flaggedDrugFa: nameFa,
        recommendedAlternatives: alts,
      });
    }
  }

  return recommendations;
}
