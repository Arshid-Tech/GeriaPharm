import type { DrugRecord } from "../../types/types";
import {
  type PatientProfile,
  acbScoreFor,
  cockcroftGault,
  parseThreshold,
} from "../checker";
import { fridMetrics } from "./geriatricRiskPanel";
import modelConfig from "../../data/adrModelWeights.json";

export type RiskTier = "کم‌خطر" | "متوسط" | "پرخطر" | "بحرانی";
export type RiskColor = "emerald" | "amber" | "rose" | "purple";

export interface RiskFeatureAttribution {
  feature: string;
  labelFa: string;
  logOddsDelta: number;
  sharePercent: number;
}

export interface RiskEvaluationResult {
  score: number;
  /** Calibrated logistic regression probability P(ADR) in [0, 1]. */
  probability: number;
  modelVersion: string;
  tier: RiskTier;
  color: RiskColor;
  drivers: string[];
  /** Additive feature attributions (linear SHAP) summing to 100% of positive risk lift. */
  attributions: RiskFeatureAttribution[];
  rawBreakdown: {
    polypharmacyPenalty: number;
    pimBurdenPenalty: number;
    anticholinergicPenalty: number;
    cnsPolypharmacyPenalty: number;
    drugDiseasePenalty: number;
    renalMismatchPenalty: number;
    ageModifier: number;
  };
}

const cnsDrugClasses = [
  "antipsychotics",
  "anticonvulsants",
  "benzodiazepines",
  "zdrugs",
  "opioids",
  "antidepressants",
  "ssris",
  "snris",
  "muscle relaxants",
  "tricyclic antidepressants",
];

export function isCnsActiveDrug(med: DrugRecord): boolean {
  if (med.isCnsActive) return true;
  const cat = med.therapeuticCategory?.toLowerCase() || "";
  const name = med.genericName.toLowerCase();
  const classes = (med.drugClasses || []).map((c) => c.toLowerCase());
  return (
    cat.includes("central nervous system") ||
    cat.includes("cns") ||
    cat.includes("psychiatric") ||
    classes.some((c) => cnsDrugClasses.some((target) => c.includes(target))) ||
    name.includes("tramadol") ||
    name.includes("morphine") ||
    name.includes("gabapentin") ||
    name.includes("pregabalin") ||
    name.includes("baclofen")
  );
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function evaluateAdverseDrugReactionRisk(
  medications: DrugRecord[],
  selectedConditions: string[] = [],
  profile: PatientProfile = {},
): RiskEvaluationResult {
  const { intercept, weights, caps, modelId, version } = modelConfig;
  const modelVersion = `${modelId}@${version}`;

  if (medications.length === 0) {
    return {
      score: 0,
      probability: 0,
      modelVersion,
      tier: "کم‌خطر",
      color: "emerald",
      drivers: ["رژیم دارویی فعلی منطبق بر معیارهای پایه‌ای احتیاط بیرز است."],
      attributions: [],
      rawBreakdown: {
        polypharmacyPenalty: 0,
        pimBurdenPenalty: 0,
        anticholinergicPenalty: 0,
        cnsPolypharmacyPenalty: 0,
        drugDiseasePenalty: 0,
        renalMismatchPenalty: 0,
        ageModifier: 0,
      },
    };
  }

  const drivers: string[] = [];
  const rawContributions: {
    feature: string;
    labelFa: string;
    logOddsDelta: number;
  }[] = [];

  // 1. Polypharmacy
  let polypharmacyPenalty = 0;
  let polyLogOdds = 0;
  const drugCount = medications.length;
  if (drugCount > 4) {
    const excess = drugCount - 4;
    polypharmacyPenalty += excess * 5;
    polyLogOdds += excess * weights.polypharmacyPerExcessDrug;
    if (drugCount >= 10) {
      polypharmacyPenalty += 15;
      polyLogOdds += weights.hyperpolypharmacyBonus;
      drivers.push(
        `پلی‌فارماسی حاد و شدید (${drugCount} دارو) ریسک عوارض و تداخلات را تشدید می‌کند.`,
      );
    } else {
      drivers.push(
        `تعداد داروها (${drugCount} قلم) فراتر از آستانه استاندارد سالمندی است.`,
      );
    }
    polyLogOdds = Math.min(caps.polypharmacy, polyLogOdds);
    rawContributions.push({
      feature: "polypharmacy",
      labelFa: `پلی‌فارمسی (${drugCount} دارو)`,
      logOddsDelta: polyLogOdds,
    });
  }

  // 2. Beers Table 2 PIM burden
  let pimBurdenPenalty = 0;
  let pimAvoidCount = 0;
  let pimConditionalCount = 0;
  for (const med of medications) {
    if (med.beersCategories.includes("PIM_GENERAL")) {
      const rec = (med.recommendation || "").toLowerCase();
      const isConditional =
        rec.includes("duration") ||
        rec.includes("weeks") ||
        rec.includes("h2-receptor") ||
        rec.includes("exception") ||
        rec.includes("if ");
      if (isConditional) {
        pimBurdenPenalty += 6;
        pimConditionalCount++;
      } else {
        pimBurdenPenalty += 12;
        pimAvoidCount++;
      }
    }
  }
  const pimLogOdds = Math.min(
    caps.pimBurden,
    pimAvoidCount * weights.pimAvoidPerDrug +
      pimConditionalCount * weights.pimConditionalPerDrug,
  );
  if (pimAvoidCount > 0 || pimConditionalCount > 0) {
    drivers.push(
      `داروهای نامناسب بیرز (PIM جدول ۲): ${pimAvoidCount} پرهیز و ${pimConditionalCount} مشروط.`,
    );
    rawContributions.push({
      feature: "pim_burden",
      labelFa: `داروهای نامناسب بیرز (${pimAvoidCount + pimConditionalCount})`,
      logOddsDelta: pimLogOdds,
    });
  }

  // 3. Anticholinergic Cognitive Burden (ACB) & Table 7 synergy
  let anticholinergicPenalty = 0;
  const strongAnticholinergics = medications.filter(
    (m) => m.isStrongAnticholinergic,
  );
  const totalAcb = medications.reduce((sum, m) => sum + acbScoreFor(m), 0);
  if (strongAnticholinergics.length > 0) {
    anticholinergicPenalty += strongAnticholinergics.length * 10;
    if (strongAnticholinergics.length >= 2) {
      anticholinergicPenalty += 20;
      drivers.push(
        `هم‌افزایی آنتی‌کولینرژیک (جدول ۷ / ACB=${totalAcb}): مصرف همزمان ${strongAnticholinergics.length} داروی قوی با خطر هذیان و یبوست.`,
      );
    } else {
      drivers.push(
        `داروی آنتی‌کولینرژیک قوی (${strongAnticholinergics[0].genericNameFa || strongAnticholinergics[0].genericName}) (ACB=${totalAcb}).`,
      );
    }
  }
  const acbLogOdds = Math.min(
    caps.anticholinergic,
    totalAcb * weights.acbPerPoint +
      (strongAnticholinergics.length >= 2
        ? weights.anticholinergicSynergyBonus
        : 0),
  );
  if (acbLogOdds > 0) {
    rawContributions.push({
      feature: "anticholinergic_burden",
      labelFa: `بار آنتی‌کولینرژیک (ACB=${totalAcb})`,
      logOddsDelta: acbLogOdds,
    });
  }

  // 4. CNS Polypharmacy (Beers Table 5)
  let cnsPolypharmacyPenalty = 0;
  let cnsLogOdds = 0;
  const cnsMedList = medications.filter(isCnsActiveDrug);
  if (cnsMedList.length >= 3) {
    cnsPolypharmacyPenalty = 25;
    cnsLogOdds = weights.cnsPolypharmacyBonus;
    drivers.push(
      `پلی‌فارماسی CNS (جدول ۵): تجویز همزمان ${cnsMedList.length} داروی فعال بر اعصاب با خطر سقوط و شکستگی.`,
    );
    rawContributions.push({
      feature: "cns_polypharmacy",
      labelFa: `پلی‌فارمسی CNS (${cnsMedList.length} دارو)`,
      logOddsDelta: cnsLogOdds,
    });
  }

  // 5. Drug–Disease Conflicts (Beers Table 3)
  let drugDiseasePenalty = 0;
  let diseaseConflictCount = 0;
  const conflictDetails: string[] = [];
  const normalizedConditions = selectedConditions.map((c) =>
    c.toLowerCase().trim(),
  );

  for (const med of medications) {
    for (const ddi of med.drugDiseaseInteractions || []) {
      const condName = ddi.condition.toLowerCase();
      if (
        (condName.includes("bph") || condName.includes("prostatic")) &&
        profile.sex === "female"
      ) {
        continue;
      }
      const matched = normalizedConditions.some(
        (sc) =>
          sc.includes(condName) ||
          condName.includes(sc) ||
          (condName.includes("heart failure") && sc.includes("heart failure")) ||
          (condName.includes("delirium") && sc.includes("delirium")) ||
          (condName.includes("dementia") && sc.includes("dementia")) ||
          (condName.includes("fall") && sc.includes("fall")) ||
          (condName.includes("parkinson") && sc.includes("parkinson")) ||
          (condName.includes("syncope") && sc.includes("syncope")),
      );
      if (matched) {
        drugDiseasePenalty += 15;
        diseaseConflictCount++;
        conflictDetails.push(
          `${med.genericNameFa || med.genericName} در "${ddi.condition}"`,
        );
      }
    }
  }
  const diseaseLogOdds = Math.min(
    caps.drugDisease,
    diseaseConflictCount * weights.drugDiseasePerConflict,
  );
  if (drugDiseasePenalty > 0) {
    drivers.push(
      `تضاد دارویی با بیماری زمینه (جدول ۳): ${conflictDetails.join("، ")}.`,
    );
    rawContributions.push({
      feature: "drug_disease",
      labelFa: `تضاد با بیماری زمینه (${diseaseConflictCount})`,
      logOddsDelta: diseaseLogOdds,
    });
  }

  // 6. Renal Threshold Violations (Beers Table 6 — strict CrCl vs eGFR separation)
  let renalMismatchPenalty = 0;
  let renalViolationCount = 0;
  const calculatedCrCl = cockcroftGault(profile);
  const renalValues: Record<"CrCl" | "eGFR", number | undefined> = {
    CrCl: profile.CrCl ?? calculatedCrCl,
    eGFR: profile.eGFR,
  };

  for (const med of medications) {
    if (!med.renalConsiderations) continue;
    const rule = parseThreshold(med.renalConsiderations.threshold);
    if (!rule) continue;
    const metricValue = renalValues[rule.metric as "CrCl" | "eGFR"];
    if (
      metricValue !== undefined &&
      Number.isFinite(metricValue) &&
      metricValue >= 0 &&
      rule.test(metricValue)
    ) {
      renalMismatchPenalty += 15;
      renalViolationCount++;
      drivers.push(
        `نیاز به تعدیل دوز کلیوی (جدول ۶): داروی ${med.genericNameFa || med.genericName} برای ${rule.metric} برابر ${Math.round(metricValue)}.`,
      );
    }
  }
  const renalLogOdds = Math.min(
    caps.renalViolation,
    renalViolationCount * weights.renalViolationPerDrug,
  );
  if (renalViolationCount > 0) {
    rawContributions.push({
      feature: "renal_mismatch",
      labelFa: `عدم تطابق کلیوی (${renalViolationCount})`,
      logOddsDelta: renalLogOdds,
    });
  }

  // 7. STOPPFall FRID class diversity
  const frid = fridMetrics(medications);
  const fridLogOdds = Math.min(
    caps.fridClasses,
    frid.fridClassCount * weights.fridPerDistinctClass,
  );
  if (frid.fridClassCount > 0) {
    rawContributions.push({
      feature: "stoppfall_frid",
      labelFa: `کلاس‌های ریسک سقوط STOPPFall (${frid.fridClassCount})`,
      logOddsDelta: fridLogOdds,
    });
  }

  // 8. Advanced age modifier
  let ageModifier = 0;
  let ageLogOdds = 0;
  const age = profile.age ?? 0;
  if (age >= 85) {
    ageModifier = 10;
    ageLogOdds = weights.age85PlusBonus;
    drivers.push(`سالمندی بسیار پیشرفته (سن ${age} سال).`);
  } else if (age >= 75) {
    ageModifier = 5;
    ageLogOdds = weights.age75To84Bonus;
    drivers.push(`سن سالمندی (${age} سال) به عنوان عامل خطر.`);
  }
  if (ageLogOdds > 0) {
    rawContributions.push({
      feature: "advanced_age",
      labelFa: `سن سالمندی (${age} سال)`,
      logOddsDelta: ageLogOdds,
    });
  }

  // Calibrated Logistic Regression inference: P(ADR) = sigmoid(beta_0 + sum(beta_i * x_i))
  const totalPositiveLogOdds = rawContributions.reduce(
    (sum, item) => sum + item.logOddsDelta,
    0,
  );
  const z = intercept + totalPositiveLogOdds;
  const probability = Number(sigmoid(z).toFixed(4));
  const score = Math.min(100, Math.max(0, Math.round(probability * 100)));

  // Normalize positive feature attributions into percentage shares for explainability
  const attributions: RiskFeatureAttribution[] = rawContributions
    .map((item) => ({
      ...item,
      logOddsDelta: Number(item.logOddsDelta.toFixed(3)),
      sharePercent:
        totalPositiveLogOdds > 0
          ? Math.round((item.logOddsDelta / totalPositiveLogOdds) * 100)
          : 0,
    }))
    .sort((a, b) => b.logOddsDelta - a.logOddsDelta);

  if (drivers.length === 0) {
    drivers.push("رژیم دارویی فعلی منطبق بر معیارهای پایه‌ای احتیاط بیرز است.");
  }

  let tier: RiskTier = "کم‌خطر";
  let color: RiskColor = "emerald";

  if (score >= 75) {
    tier = "بحرانی";
    color = "purple";
  } else if (score >= 50) {
    tier = "پرخطر";
    color = "rose";
  } else if (score >= 25) {
    tier = "متوسط";
    color = "amber";
  } else {
    tier = "کم‌خطر";
    color = "emerald";
  }

  return {
    score,
    probability,
    modelVersion,
    tier,
    color,
    drivers,
    attributions,
    rawBreakdown: {
      polypharmacyPenalty,
      pimBurdenPenalty,
      anticholinergicPenalty,
      cnsPolypharmacyPenalty,
      drugDiseasePenalty,
      renalMismatchPenalty,
      ageModifier,
    },
  };
}
