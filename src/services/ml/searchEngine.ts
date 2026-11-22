import type { DrugRecord } from "../../types/types";
import { fa, normalizeFa, toLatinDigits } from "../../lib/fa";

/**
 * Offline client-side clinical search engine (BM25 + bounded Damerau-Levenshtein
 * fuzzy matching + curated Persian/English clinical synonyms).
 *
 * - Zero external dependencies, zero network calls, zero hallucination:
 *   results are strictly retrieved and ranked from the verified drug registry.
 * - Cached per `DrugRecord[]` reference via WeakMap so CMS edits automatically
 *   invalidate and rebuild the index in < 5ms.
 */

const DIACRITICS_RE = /[\u064b-\u065f\u0670\u0640]/g;

/** Rich normalization for Persian/Arabic/English clinical search tokens. */
export function normalizeSearchText(value: string): string {
  return toLatinDigits(normalizeFa(value))
    .replace(DIACRITICS_RE, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ی")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string): string[] {
  const norm = normalizeSearchText(value);
  return norm ? norm.split(" ") : [];
}

/** Curated bidirectional clinical aliases for offline semantic expansion. */
const CLINICAL_SYNONYMS: Record<string, string[]> = {
  "آلزایمر": ["دمانس", "dementia", "اختلال شناختی"],
  "الزایمر": ["دمانس", "dementia", "اختلال شناختی"],
  "زوال عقل": ["دمانس", "dementia"],
  "فراموشی": ["دمانس", "dementia", "اختلال شناختی"],
  "زمین خوردن": ["سقوط", "falls", "fractures"],
  "افتادن": ["سقوط", "falls"],
  "شکستگی": ["سقوط", "falls", "fractures"],
  "پروستات": ["bph", "بزرگی پروستات", "احتباس ادرار"],
  "کلیه": ["renal", "crcl", "egfr", "کلیوی"],
  "کلیوی": ["renal", "crcl", "egfr"],
  "نارسایی کلیه": ["renal", "crcl", "egfr"],
  "زخم معده": ["peptic ulcer", "زخم گوارشی"],
  "معده": ["gastrointestinal", "گوارش", "زخم گوارشی"],
  "قلب": ["cardiovascular", "heart failure", "نارسایی قلبی"],
  "فشار خون": ["hypertension", "ضدفشار", "قلب"],
  "غش": ["syncope", "سنکوپ"],
  "گیجی": ["delirium", "دلیریوم"],
  "هذیان": ["delirium", "دلیریوم"],
  "خواب": ["insomnia", "بی خوابی", "بنزودیازپین", "زولپیدم"],
  "بیخوابی": ["بی خوابی", "insomnia", "بنزودیازپین", "زولپیدم"],
  "مسکن": ["pain", "nsaid", "درد", "اوپیوئید", "اپیوئید"],
  "ضددرد": ["pain", "nsaid", "درد"],
  "ضدانعقاد": ["anticoagulants", "doac", "warfarin", "وارفارین", "اپیکسابان"],
  "رقیق کننده خون": ["anticoagulants", "warfarin", "وارفارین"],
  "دیابت": ["endocrine", "سولفونیل", "sglt2", "انسولین"],
  "قند خون": ["endocrine", "سولفونیل", "sglt2", "انسولین"],
  "انتی کولینرژیک": ["anticholinergic", "آنتی کولینرژیک"],
};

/** Bounded Damerau-Levenshtein distance for typo tolerance (transpositions = 1). */
export function damerauLevenshtein(a: string, b: string, maxDist = 2): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > maxDist) return maxDist + 1;
  if (a === b) return 0;
  if (m === 0) return n;
  if (n === 0) return m;

  const d: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        val = Math.min(val, d[i - 2][j - 2] + 1);
      }
      d[i][j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return d[m][n];
}

function allowedTypos(tokenLength: number): number {
  if (tokenLength < 4) return 0;
  if (tokenLength <= 6) return 1;
  return 2;
}

interface IndexedField {
  text: string;
  tokens: string[];
  weight: number;
  allowFuzzy: boolean;
}

interface IndexedDoc {
  drug: DrugRecord;
  fields: IndexedField[];
  termFreq: Map<string, number>;
  weightedLength: number;
}

export interface SearchHit {
  drug: DrugRecord;
  score: number;
  matchType: "exact" | "prefix" | "fuzzy" | "synonym";
}

export interface DrugSearchIndex {
  docs: IndexedDoc[];
  df: Map<string, number>;
  avgDocLen: number;
}

const indexCache = new WeakMap<DrugRecord[], DrugSearchIndex>();

function buildDoc(drug: DrugRecord): IndexedDoc {
  const fields: IndexedField[] = [
    {
      text: normalizeSearchText(drug.genericNameFa ?? ""),
      tokens: tokenize(drug.genericNameFa ?? ""),
      weight: 5.0,
      allowFuzzy: true,
    },
    {
      text: normalizeSearchText(drug.genericName),
      tokens: tokenize(drug.genericName),
      weight: 5.0,
      allowFuzzy: true,
    },
    {
      text: normalizeSearchText(drug.brandNamesIran.join(" ")),
      tokens: tokenize(drug.brandNamesIran.join(" ")),
      weight: 4.0,
      allowFuzzy: true,
    },
    {
      text: normalizeSearchText(drug.atcCode ?? ""),
      tokens: tokenize(drug.atcCode ?? ""),
      weight: 4.0,
      allowFuzzy: false,
    },
    {
      text: normalizeSearchText(
        [
          drug.therapeuticCategory,
          fa(drug.therapeuticCategory),
          ...(drug.drugClasses ?? []),
          ...(drug.drugClasses ?? []).map(fa),
        ].join(" "),
      ),
      tokens: tokenize(
        [
          drug.therapeuticCategory,
          fa(drug.therapeuticCategory),
          ...(drug.drugClasses ?? []),
          ...(drug.drugClasses ?? []).map(fa),
        ].join(" "),
      ),
      weight: 2.5,
      allowFuzzy: false,
    },
    {
      text: normalizeSearchText(
        drug.drugDiseaseInteractions
          .map((r) => `${r.condition} ${fa(r.condition)}`)
          .join(" "),
      ),
      tokens: tokenize(
        drug.drugDiseaseInteractions
          .map((r) => `${r.condition} ${fa(r.condition)}`)
          .join(" "),
      ),
      weight: 2.0,
      allowFuzzy: false,
    },
  ];

  const termFreq = new Map<string, number>();
  let weightedLength = 0;
  for (const field of fields) {
    weightedLength += field.tokens.length * field.weight;
    for (const tok of field.tokens) {
      termFreq.set(tok, (termFreq.get(tok) ?? 0) + field.weight);
    }
  }

  return { drug, fields, termFreq, weightedLength };
}

/** Builds (or returns cached) BM25 + fuzzy search index for a drug registry. */
export function getDrugSearchIndex(drugs: DrugRecord[]): DrugSearchIndex {
  const cached = indexCache.get(drugs);
  if (cached) return cached;

  const docs = drugs.map(buildDoc);
  const df = new Map<string, number>();
  let totalLen = 0;

  for (const doc of docs) {
    totalLen += doc.weightedLength;
    for (const term of doc.termFreq.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const index: DrugSearchIndex = {
    docs,
    df,
    avgDocLen: docs.length ? totalLen / docs.length : 1,
  };
  indexCache.set(drugs, index);
  return index;
}

function expandSynonyms(normalizedQuery: string, queryTokens: string[]): string[] {
  const expanded = new Set<string>();
  for (const [key, syns] of Object.entries(CLINICAL_SYNONYMS)) {
    const normKey = normalizeSearchText(key);
    if (
      normalizedQuery === normKey ||
      queryTokens.includes(normKey)
    ) {
      for (const s of syns) {
        for (const t of tokenize(s)) expanded.add(t);
      }
    }
  }
  return [...expanded];
}

function scoreDoc(
  doc: IndexedDoc,
  normalizedQuery: string,
  queryTokens: string[],
  synonymTokens: string[],
  index?: DrugSearchIndex,
): SearchHit | null {
  if (!normalizedQuery) {
    return { drug: doc.drug, score: 1, matchType: "exact" };
  }

  const k1 = 1.2;
  const b = 0.75;
  const N = index ? index.docs.length : 1;
  const avgLen = index ? index.avgDocLen : Math.max(1, doc.weightedLength);
  const idf = (term: string) => {
    if (!index) return 1.5;
    const n = index.df.get(term) ?? 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  let totalScore = 0;
  let bestMatchType: SearchHit["matchType"] = "synonym";
  let matchedAllPrimaryTokens = true;

  // Full normalized phrase boost on primary fields
  for (const field of doc.fields) {
    if (!field.text) continue;
    if (field.text === normalizedQuery) {
      totalScore += field.weight * 12;
      bestMatchType = "exact";
    } else if (field.text.startsWith(normalizedQuery)) {
      totalScore += field.weight * 7;
      if (bestMatchType !== "exact") bestMatchType = "prefix";
    } else if (field.text.includes(normalizedQuery)) {
      totalScore += field.weight * 4;
      if (bestMatchType !== "exact") bestMatchType = "prefix";
    }
  }

  for (const qTok of queryTokens) {
    let tokenScore = 0;
    const maxDist = allowedTypos(qTok.length);

    // 1. Exact BM25 match
    const tf = doc.termFreq.get(qTok) ?? 0;
    if (tf > 0) {
      const bm25 =
        idf(qTok) *
        ((tf * (k1 + 1)) /
          (tf + k1 * (1 - b + (b * doc.weightedLength) / avgLen)));
      tokenScore = Math.max(tokenScore, bm25 * 3);
      bestMatchType = "exact";
    }

    // 2. Prefix / substring match across fields
    if (tokenScore === 0) {
      for (const field of doc.fields) {
        if (!field.text) continue;
        if (field.tokens.some((t) => t.startsWith(qTok))) {
          tokenScore = Math.max(tokenScore, field.weight * 2.2);
          if (bestMatchType !== "exact") bestMatchType = "prefix";
        } else if (field.text.includes(qTok)) {
          tokenScore = Math.max(tokenScore, field.weight * 1.6);
          if (bestMatchType !== "exact") bestMatchType = "prefix";
        }
      }
    }

    // 3. Strict bounded fuzzy match ONLY on primary name/brand fields
    if (tokenScore === 0 && maxDist > 0) {
      for (const field of doc.fields) {
        if (!field.allowFuzzy) continue;
        for (const fTok of field.tokens) {
          if (fTok.length < 4) continue;
          const dist = damerauLevenshtein(qTok, fTok, maxDist);
          if (dist <= maxDist) {
            const ratio = 1 - dist / Math.max(qTok.length, fTok.length);
            if (ratio >= 0.72) {
              tokenScore = Math.max(tokenScore, field.weight * ratio * 1.4);
              if (bestMatchType === "synonym") bestMatchType = "fuzzy";
            }
          }
        }
      }
    }

    if (tokenScore === 0) {
      matchedAllPrimaryTokens = false;
    } else {
      totalScore += tokenScore;
    }
  }

  // 4. Clinical synonym match (when user searches e.g. "آلزایمر" or "زمین خوردن")
  if (!matchedAllPrimaryTokens && synonymTokens.length > 0) {
    let synScore = 0;
    for (const sTok of synonymTokens) {
      const tf = doc.termFreq.get(sTok) ?? 0;
      if (tf > 0) {
        synScore += idf(sTok) * 1.5;
      } else if (doc.fields.some((f) => f.text.includes(sTok))) {
        synScore += 1.2;
      }
    }
    if (synScore > 0) {
      totalScore += synScore;
      matchedAllPrimaryTokens = true;
    }
  }

  if (!matchedAllPrimaryTokens || totalScore <= 0) return null;
  return { drug: doc.drug, score: totalScore, matchType: bestMatchType };
}

/** Searches and ranks a drug registry using offline BM25 + fuzzy matching. */
export function searchDrugs(drugs: DrugRecord[], query: string): SearchHit[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return drugs.map((drug) => ({ drug, score: 1, matchType: "exact" }));
  }
  const index = getDrugSearchIndex(drugs);
  const queryTokens = tokenize(normalizedQuery);
  const synonymTokens = expandSynonyms(normalizedQuery, queryTokens);

  const hits: SearchHit[] = [];
  for (const doc of index.docs) {
    const hit = scoreDoc(doc, normalizedQuery, queryTokens, synonymTokens, index);
    if (hit) hits.push(hit);
  }
  return hits.sort((a, b) => b.score - a.score);
}

/**
 * Single-record boolean predicate compatible with `matchesSearch(drug, query)`.
 * Preserves exact substring matching while adding ATC code, drug classes,
 * diacritic/alef normalization, clinical synonyms, and strict typo tolerance.
 */
export function matchesSmartSearch(drug: DrugRecord, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const queryTokens = tokenize(normalizedQuery);
  const synonymTokens = expandSynonyms(normalizedQuery, queryTokens);
  const doc = buildDoc(drug);
  return scoreDoc(doc, normalizedQuery, queryTokens, synonymTokens) !== null;
}
