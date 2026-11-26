import { Checkbox } from "./ui/Checkbox";
import { useState, useRef } from "react";
import {
  Plus,
  ShieldCheck,
  Trash2,
  AlertTriangle,
  Info,
  Pill,
  ChevronDown,
  ChevronUp,
  Stethoscope,
  ArrowRightLeft,
  CalendarCheck,
} from "lucide-react";
import type { DrugRecord } from "../types/types";
import {
  conditions,
  evaluateRegimen,
  cockcroftGault,
  type PatientProfile,
} from "../services/checker";
import { calculateRenalMetrics } from "../services/calculators/cockcroftGault";
import { evaluateAdverseDrugReactionRisk } from "../services/ml/riskModel";
import { generateDeprescribingProtocols } from "../services/ml/deprescribingModel";
import { recommendDrugSubstitutions } from "../services/ml/recommender";
import { prioritizeAlerts } from "../services/ml/alertRanking";
import {
  groupAlerts,
  BEERS_GROUPS,
  type BeersGroupId,
} from "../services/ml/alertGrouping";
import {
  evaluatePanel,
  type PanelEvaluation,
} from "../services/ml/geriatricRiskPanel";
import { fa, number, drugName, matchesSearch } from "../lib/fa";
import {
  Button,
  IconButton,
  SearchField,
  Notice,
  EmptyState,
} from "./ui/Primitives";
import { GeriatricPanel } from "./GeriatricPanel";

const profileKey = "gp-profile";
function loadProfile(): PatientProfile {
  try {
    const raw = JSON.parse(localStorage.getItem(profileKey) || "{}");
    const p: PatientProfile = {};
    if (typeof raw.age === "number" && raw.age >= 0) p.age = raw.age;
    if (raw.sex === "male" || raw.sex === "female") p.sex = raw.sex;
    if (typeof raw.weight === "number" && raw.weight >= 0)
      p.weight = raw.weight;
    if (typeof raw.height === "number" && raw.height >= 0)
      p.height = raw.height;
    if (typeof raw.serumCreatinine === "number" && raw.serumCreatinine >= 0)
      p.serumCreatinine = raw.serumCreatinine;
    if (typeof raw.CrCl === "number" && raw.CrCl >= 0) p.CrCl = raw.CrCl;
    if (typeof raw.eGFR === "number" && raw.eGFR >= 0) p.eGFR = raw.eGFR;
    if (typeof raw.preferActualWeightOverIbw === "boolean")
      p.preferActualWeightOverIbw = raw.preferActualWeightOverIbw;
    return p;
  } catch {
    return {};
  }
}

export function Checker({
  drugs,
  ids,
  setIds,
  onOpen,
}: {
  drugs: DrugRecord[];
  ids: string[];
  setIds: (ids: string[]) => void;
  onOpen: (d: DrugRecord) => void;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [profile, setProfile] = useState<PatientProfile>(loadProfile),
    [clear, setClear] = useState(false),
    [filter, setFilter] = useState("All");

  const meds = ids
      .map((id) => drugs.find((d) => d.id === id))
      .filter((d): d is DrugRecord => !!d),
    missing = ids.length - meds.length;

  const { alerts } = evaluateRegimen(meds, selected, profile);
  const matches = drugs.filter(
    (d) => !ids.includes(d.id) && matchesSearch(d, query),
  );
  const searchRef = useRef<HTMLDivElement>(null);

  function update(patch: Partial<PatientProfile>) {
    const next = { ...profile, ...patch };
    for (const k of Object.keys(next) as (keyof PatientProfile)[])
      if (next[k] === undefined) delete next[k];
    setProfile(next);
    try {
      localStorage.setItem(profileKey, JSON.stringify(next));
    } catch {
      /* keep session-only */
    }
  }
  const num = (k: keyof PatientProfile) =>
    profile[k] === undefined ? "" : String(profile[k]);
  const onNum = (k: keyof PatientProfile) => (v: string) =>
    update({
      [k]: v === "" ? undefined : Number(v),
    } as Partial<PatientProfile>);
  const cg = cockcroftGault(profile);

  // Module 1 & 2 ML + Pharmacokinetic engines
  const renalCalculations = calculateRenalMetrics({
    sex: profile.sex,
    age: profile.age,
    weight: profile.weight,
    height: profile.height,
    serumCreatinine: profile.serumCreatinine,
    preferActualWeightOverIbw: profile.preferActualWeightOverIbw,
  });

  const adrRisk = evaluateAdverseDrugReactionRisk(meds, selected, profile);
  const deprescribingProtocols = generateDeprescribingProtocols(meds, selected);
  const drugSubstitutions = recommendDrugSubstitutions(meds, {
    registry: drugs,
    selectedConditions: selected,
    profile,
  });
  const prioritizedAlertList = prioritizeAlerts(alerts);
  const beersAlertGroups = groupAlerts(prioritizedAlertList, meds);
  const panel: PanelEvaluation = evaluatePanel(meds, alerts);
  const [openBeersGroups, setOpenBeersGroups] = useState<
    Record<string, boolean>
  >({});
  // Groups start expanded so the clinical summary is readable without extra
  // clicks; an explicit entry in the map always wins over the default.
  const isBeersGroupOpen = (id: BeersGroupId) => openBeersGroups[id] ?? true;
  const toggleBeersGroup = (id: BeersGroupId) => {
    setOpenBeersGroups((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  };

  const activeBeersGroups = BEERS_GROUPS.filter((meta) => {
    const list = (beersAlertGroups[meta.id] || []).filter(
      (a) => filter === "All" || a.severity === filter,
    );
    return list.length > 0;
  });

  const areAllOpen =
    activeBeersGroups.length > 0 &&
    activeBeersGroups.every((meta) => isBeersGroupOpen(meta.id));

  const toggleAllGroups = () => {
    const nextState = !areAllOpen;
    const updated: Record<string, boolean> = {};
    activeBeersGroups.forEach((g) => {
      updated[g.id] = nextState;
    });
    setOpenBeersGroups(updated);
  };

  return (
    <div className="checker-container">
      {/* Intake row. In RTL the columns read: prescription → conditions → demographics. */}
      <div className="checker-top-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>
              داروهای نسخه <span className="count">{number(meds.length)}</span>
            </h2>
            {ids.length > 0 && (
              <Button variant="ghost" onClick={() => setClear(true)}>
                پاک کردن
              </Button>
            )}
          </div>
          <p className="help">داروهای بیمار را از فهرست مرجع انتخاب کنید.</p>
          <div ref={searchRef}>
            <SearchField
              value={query}
              onChange={setQuery}
              label="جست‌وجوی دارو برای نسخه"
              placeholder="نام دارو را جست‌وجو کنید…"
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  searchRef.current
                    ?.querySelector<HTMLButtonElement>(".picker-results button")
                    ?.focus();
                }
              }}
            />
            {query && (
              <div className="picker-results" aria-label="نتایج جست‌وجوی دارو">
                {matches.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setIds([...ids, d.id]);
                      setQuery("");
                      searchRef.current?.querySelector("input")?.focus();
                    }}
                  >
                    <span>
                      {drugName(d)}
                      <small dir="ltr">{d.genericName}</small>
                    </span>
                    <Plus size={19} />
                  </button>
                ))}
                {matches.length === 0 && (
                  <p className="help">
                    دارویی پیدا نشد. داروهای خارج از فهرست باید ابتدا توسط مدیر
                    ثبت شوند.
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="selected-meds">
            {meds.map((d, i) => (
              <div className="selected-med" key={d.id}>
                <span className="med-index">{number(i + 1)}</span>
                <button className="selected-name" onClick={() => onOpen(d)}>
                  {drugName(d)}
                  <small dir="ltr">{d.genericName}</small>
                </button>
                <IconButton
                  label={"حذف " + drugName(d) + " از نسخه"}
                  onClick={() => setIds(ids.filter((id) => id !== d.id))}
                >
                  <Trash2 size={17} />
                </IconButton>
              </div>
            ))}
            {!meds.length && (
              <div className="regimen-empty">
                <Pill size={23} />
                <p>اولین دارو را اضافه کنید.</p>
              </div>
            )}
          </div>
          {clear && (
            <Notice tone="warning">
              همه داروهای این نسخه پاک شوند؟
              <div className="actions">
                <Button
                  variant="danger"
                  onClick={() => {
                    setIds([]);
                    setClear(false);
                  }}
                >
                  پاک کردن نسخه
                </Button>
                <Button variant="ghost" onClick={() => setClear(false)}>
                  انصراف
                </Button>
              </div>
            </Notice>
          )}
          {missing > 0 && (
            <Notice tone="warning">
              {number(missing)} داروی ذخیره‌شده دیگر در فهرست وجود ندارد.
              <Button
                variant="ghost"
                onClick={() => setIds(meds.map((d) => d.id))}
              >
                حذف موارد ناموجود
              </Button>
            </Notice>
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>
              شرایط بالینی بیمار{" "}
              <span className="count">{number(selected.length)}</span>
            </h2>
            {selected.length > 0 && (
              <Button variant="ghost" onClick={() => setSelected([])}>
                پاک کردن
              </Button>
            )}
          </div>
          <p className="help">بیماری‌ها و عوامل خطر مرتبط را انتخاب کنید.</p>
          <div className="condition-list">
            {conditions.map((c) => (
              <label className={selected.includes(c) ? "checked" : ""} key={c}>
                <Checkbox
                  checked={selected.includes(c)}
                  onChange={() =>
                    setSelected(
                      selected.includes(c)
                        ? selected.filter((x) => x !== c)
                        : [...selected, c],
                    )
                  }
                />
                <span>{fa(c)}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>سن، جنسیت و عملکرد کلیه</h2>
            <span className="muted">اختیاری</span>
          </div>
          <p className="help">
            سن، قد، وزن، جنسیت و کراتینین، مبنای محاسبه CrCl و تعدیل دوز کلیوی
            است.
          </p>
          <div className="form-grid">
            <label className="field">
              سن (سال)
              <div dir="ltr" className="unit-input">
                <input
                  aria-label="سن بیمار"
                  type="number"
                  min="0"
                  max="130"
                  step="1"
                  dir="ltr"
                  placeholder="72"
                  value={num("age")}
                  onChange={(e) => onNum("age")(e.target.value)}
                />
                <span dir="ltr">yr</span>
              </div>
            </label>
            <div className="field">
              جنسیت
              <div
                className="theme-toggle gender-toggle"
                role="group"
                aria-label="جنسیت بیمار"
                style={{ marginTop: 6 }}
              >
                <button
                  type="button"
                  aria-pressed={profile.sex !== "female"}
                  onClick={() => update({ sex: "male" })}
                >
                  <span className="sr-only">مرد</span>
                  <span aria-hidden style={{ fontSize: 13, padding: "0 6px" }}>
                    مرد
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={profile.sex === "female"}
                  onClick={() => update({ sex: "female" })}
                >
                  <span className="sr-only">زن</span>
                  <span aria-hidden style={{ fontSize: 13, padding: "0 6px" }}>
                    زن
                  </span>
                </button>
              </div>
            </div>
            <label className="field">
              قد (سانتی‌متر)
              <div dir="ltr" className="unit-input">
                <input
                  aria-label="قد بیمار"
                  type="number"
                  min="0"
                  max="250"
                  step="any"
                  dir="ltr"
                  placeholder="170"
                  value={num("height")}
                  onChange={(e) => onNum("height")(e.target.value)}
                />
                <span dir="ltr">cm</span>
              </div>
            </label>

            <label className="field">
              وزن (کیلوگرم)
              <div dir="ltr" className="unit-input">
                <input
                  aria-label="وزن بیمار"
                  type="number"
                  min="0"
                  step="any"
                  dir="ltr"
                  placeholder="70"
                  value={num("weight")}
                  onChange={(e) => onNum("weight")(e.target.value)}
                />
                <span dir="ltr">kg</span>
              </div>
            </label>
            <label className="field">
              کراتینین سرم
              <div dir="ltr" className="unit-input">
                <input
                  aria-label="کراتینین سرم"
                  type="number"
                  min="0"
                  step="any"
                  dir="ltr"
                  placeholder="1.2"
                  value={num("serumCreatinine")}
                  onChange={(e) => onNum("serumCreatinine")(e.target.value)}
                />
                <span dir="ltr">mg/dL</span>
              </div>
            </label>
            <label className="field">
              کلیرانس کراتینین · CrCl
              <div dir="ltr" className="unit-input">
                <input
                  aria-label="کلیرانس کراتینین"
                  type="number"
                  min="0"
                  step="any"
                  dir="ltr"
                  placeholder="45"
                  value={num("CrCl")}
                  onChange={(e) => onNum("CrCl")(e.target.value)}
                />
                <span dir="ltr">mL/min</span>
              </div>
            </label>
            <label className="field">
              نرخ فیلتراسیون · eGFR
              <div dir="ltr" className="unit-input">
                <input
                  aria-label="نرخ فیلتراسیون کلیه"
                  type="number"
                  min="0"
                  step="any"
                  dir="ltr"
                  placeholder="60"
                  value={num("eGFR")}
                  onChange={(e) => onNum("eGFR")(e.target.value)}
                />
                <span dir="ltr">mL/min/1.73m²</span>
              </div>
            </label>
          </div>
          {cg !== undefined && (
            <Notice tone="info">
              CrCl برآوردی کوکرافت–گالت: mL/min{" "}
              <bdi dir="ltr">{cg.toFixed(1)}</bdi>{" "}
              {profile.CrCl !== undefined
                ? " (مقدار دستی شما اولویت دارد)"
                : " — محاسبه‌شده از سن، وزن، جنسیت و کراتینین"}
            </Notice>
          )}
          {/* Clinical Pharmacokinetic Calculator Summary Box */}
          {(renalCalculations.bmi !== undefined ||
            renalCalculations.ibw !== undefined ||
            renalCalculations.crcl !== undefined) && (
            <div className="mt-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/80 text-xs sm:text-sm">
              <div className="font-semibold text-slate-800 dark:text-slate-100 mb-2">
                <span>محاسبات فارماکوکینتیک بالینی</span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-2.5 text-xs">
                {renalCalculations.bmi !== undefined && (
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    شاخص توده بدنی (BMI): {renalCalculations.bmi} (
                    {renalCalculations.bmiCategory})
                  </span>
                )}
                {renalCalculations.ibw !== undefined && (
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    وزن ایده‌آل (IBW): {renalCalculations.ibw} kg
                  </span>
                )}
                {renalCalculations.adjBw !== undefined && (
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    وزن تعدیل‌شده (AdjBW): {renalCalculations.adjBw} kg
                  </span>
                )}
                {renalCalculations.weightUsedLabel && (
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    مبنای محاسبه CrCl: {renalCalculations.weightUsedLabel}
                  </span>
                )}
              </div>

              {renalCalculations.crcl !== undefined && (
                <div className="flex justify-center pt-2 border-t border-slate-200 dark:border-slate-800">
                  <span
                    dir="ltr"
                    className="font-mono text-sm font-semibold px-3 py-1 rounded-md bg-[#0f4c5c] dark:bg-[#1b697c] text-white"
                  >
                    CrCl: {renalCalculations.crcl} mL/min
                  </span>
                </div>
              )}
            </div>
          )}

          {((profile.CrCl ?? -1) < 0 ||
            (profile.eGFR ?? -1) < 0 ||
            (profile.age ?? -1) < 0 ||
            (profile.weight ?? -1) < 0 ||
            (profile.serumCreatinine ?? -1) < 0) && (
            <Notice tone="error">
              مقادیر سن، وزن، کراتینین و عملکرد کلیه نمی‌توانند منفی باشند.
            </Notice>
          )}
          <p className="help">
            اگر سن، وزن، جنسیت و کراتینین را وارد کنید، CrCl به‌طور خودکار
            محاسبه می‌شود.
            <br />
            CrCl و eGFR جایگزین یکدیگر نیستند.
            <br />
            اطلاعات بیمار فقط روی همین دستگاه ذخیره می‌شود.
          </p>
        </section>
      </div>

      <section className="audit checker-results">
        <div className="panel-heading">
          <h2>
            <ShieldCheck size={22} />
            گزارش ایمنی نسخه
          </h2>
        </div>
        <div className="print-header">
          <h1>خلاصه پرونده دارویی سالمند</h1>
          <p>
            GeriaPharm · معیارهای بیرز ۲۰۲۳ · تهیه‌شده در{" "}
            {new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(
              new Date(),
            )}
          </p>
        </div>

        {/* Geriatric Multi-Dimensional Risk Panel */}
        {meds.length > 0 && <GeriatricPanel panel={panel} />}

        {/* Clinical Decision Support (CDSS) Panel */}
        <div
          data-tour="ai-cdss"
          className="edge-ai-cdss-panel mb-6 w-full min-w-0 p-5 rounded-xl bg-white dark:bg-[#131d2b] border border-slate-200 dark:border-slate-800 space-y-5"
        >
          <div
            data-tour="mobile-ai-cdss"
            className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800 pb-3.5"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 shrink-0 rounded-lg bg-[#0f4c5c]/10 dark:bg-[#3898a8]/15 text-[#0f4c5c] dark:text-[#67c5d4] flex items-center justify-center">
                <Stethoscope size={20} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 break-words">
                  تحلیل ریسک و پیشنهاد بالینی (CDSS)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 break-words">
                  ارزیابی آفلاین بر پایه معیارهای بیرز ۲۰۲۳، STOPPFall و مقیاس ACB
                </p>
              </div>
            </div>
            <span
              dir="ltr"
              className="text-[11px] font-mono px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
              title="نسخه مدل رگرسیون لجستیک آفلاین"
            >
              {adrRisk.modelVersion}
            </span>
          </div>

          {/* 1.1 ADR Multi-Factor Risk Stratification */}
          <div className="w-full min-w-0 p-4 rounded-xl bg-slate-50 dark:bg-[#0f1723] border border-slate-200/80 dark:border-slate-800 flex flex-col md:flex-row gap-5 md:items-start items-center">
            <div className="flex flex-col items-center justify-center shrink-0 min-w-[136px] p-3 rounded-lg bg-white dark:bg-[#131d2b] border border-slate-200 dark:border-slate-800">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                شاخص ریسک ADR
              </span>
              <span
                dir="ltr"
                className={`text-3xl font-bold ${
                  adrRisk.tier === "بحرانی"
                    ? "text-red-700 dark:text-red-400"
                    : adrRisk.tier === "پرخطر"
                      ? "text-rose-700 dark:text-rose-400"
                      : adrRisk.tier === "متوسط"
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {number(adrRisk.score)} / ۱۰۰
              </span>
              <span
                className={`mt-1.5 text-xs px-2.5 py-0.5 rounded-md font-semibold ${
                  adrRisk.tier === "بحرانی"
                    ? "bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-900"
                    : adrRisk.tier === "پرخطر"
                      ? "bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-900"
                      : adrRisk.tier === "متوسط"
                        ? "bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900"
                        : "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900"
                }`}
              >
                سطح: {adrRisk.tier}
              </span>
            </div>
            <div className="flex-1 min-w-0 space-y-2.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              <strong className="text-slate-900 dark:text-slate-100 block font-semibold">
                عوامل کلیدی تشدیدکننده ریسک ناخواسته دارویی:
              </strong>
              <ul className="list-disc list-inside space-y-1 break-words">
                {adrRisk.drivers.map((d: string, idx: number) => (
                  <li key={idx}>{d}</li>
                ))}
              </ul>
              {adrRisk.attributions.length > 0 && (
                <div className="pt-2.5 border-t border-slate-200/80 dark:border-slate-800 space-y-1.5">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                    سهم نسبی هر عامل در برآورد ریسک:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {adrRisk.attributions.map((attr) => (
                      <span
                        key={attr.feature}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-[#131d2b] border border-slate-200 dark:border-slate-700 text-[11px]"
                      >
                        <span>{attr.labelFa}</span>
                        <b className="text-[#0f4c5c] dark:text-[#67c5d4]">
                          {number(attr.sharePercent)}٪
                        </b>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 1.2 Deprescribing & Tapering Protocols */}
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm font-bold text-slate-900 dark:text-slate-100 min-w-0">
              <CalendarCheck
                size={18}
                className="text-[#0f4c5c] dark:text-[#67c5d4] shrink-0 mt-0.5"
              />
              <span className="break-words">
                پروتکل‌های کاهش تدریجی و قطع دارو (Deprescribing Roadmap)
              </span>
            </div>
            {deprescribingProtocols.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 pr-1">
                برای داروهای موجود در نسخه، پروتکل قطع تدریجی با پایه شواهد
                شناسایی نشد.
              </p>
            ) : (
              <div className="grid gap-3">
                {deprescribingProtocols.map((proto) => (
                  <div
                    key={proto.targetDrugId}
                    className="min-w-0 p-4 rounded-xl bg-slate-50/80 dark:bg-[#0f1723] border border-slate-200 dark:border-slate-800 text-xs space-y-3"
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <strong className="min-w-0 text-sm font-bold text-[#0f4c5c] dark:text-[#67c5d4] break-words">
                        هدف قطع: {proto.targetDrugFa} (
                        {proto.targetDrugGeneric})
                      </strong>
                      <span className="text-[11px] px-2 py-0.5 rounded-md whitespace-nowrap bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                        {proto.tableSource}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed break-words">
                      {proto.clinicalRationale}
                    </p>

                    <div className="min-w-0 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131d2b]">
                      <table className="w-full text-right border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300">
                            <th className="p-2.5 font-semibold">زمان‌بندی</th>
                            <th className="p-2.5 font-semibold">دوز هدف</th>
                            <th className="p-2.5 font-semibold">اقدام بالینی</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {proto.taperSchedule.map((step, sIdx) => (
                            <tr
                              key={sIdx}
                              className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                            >
                              <td className="p-2.5 font-semibold text-[#0f4c5c] dark:text-[#67c5d4]">
                                {step.week}
                              </td>
                              <td className="p-2.5 font-medium text-slate-800 dark:text-slate-200">
                                {step.targetDose}
                              </td>
                              <td className="p-2.5 text-slate-600 dark:text-slate-400">
                                {step.clinicalAction}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-900/50 text-amber-900 dark:text-amber-200">
                      <strong>پارامترهای پایش بالینی:</strong>{" "}
                      {proto.monitoringParameters.join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 1.3 Evidence-Based & Vector Similarity Drug Substitutions */}
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm font-bold text-slate-900 dark:text-slate-100 min-w-0">
              <ArrowRightLeft
                size={18}
                className="text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5"
              />
              <span className="break-words">
                پیشنهادهای جایگزینی ایمن‌تر (Drug Substitutions)
              </span>
            </div>
            {drugSubstitutions.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 pr-1">
                برای داروهای وارد شده، جایگزین ایمن‌تر با پایه شواهد شناسایی
                نشد. وارد کردن داروهای مرتبط با شواهد بیرز ۲۰۲۳ (مثل وارفارین،
                دیازپام، آمیتریپتیلین و…) توصیه می‌شود.
              </p>
            ) : (
              <div className="grid gap-3">
                {drugSubstitutions.map((sub) => (
                  <div
                    key={sub.flaggedDrugId}
                    className="min-w-0 p-4 rounded-xl bg-slate-50/80 dark:bg-[#0f1723] border border-slate-200 dark:border-slate-800 text-xs space-y-2.5"
                  >
                    <div className="font-semibold text-slate-900 dark:text-slate-100 break-words">
                      داروی پرخطر شناسایی‌شده:{" "}
                      <span className="text-red-700 dark:text-red-400 font-mono">
                        {sub.flaggedDrugFa} ({sub.flaggedDrugName})
                      </span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2.5 mt-2">
                      {sub.recommendedAlternatives.map((alt, aIdx) => (
                        <div
                          key={aIdx}
                          className="min-w-0 p-3 rounded-lg bg-white dark:bg-[#131d2b] border border-slate-200 dark:border-slate-800 border-r-[3px] border-r-emerald-600 dark:border-r-emerald-500 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="font-bold text-emerald-800 dark:text-emerald-400 break-words">
                              ✓ {alt.genericNameFa}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-md whitespace-nowrap bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-900">
                              {alt.category}
                            </span>
                          </div>
                          <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed break-words">
                            {alt.evidenceRationale}
                          </p>
                          {alt.clinicalDosingNotes && (
                            <p className="text-[11px] text-[#0f4c5c] dark:text-[#67c5d4] font-medium pt-1.5 border-t border-slate-100 dark:border-slate-800 break-words">
                              نکته دوز: {alt.clinicalDosingNotes}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="audit-stats">
          <button
            className={filter === "avoid" ? "selected" : ""}
            onClick={() => setFilter(filter === "avoid" ? "All" : "avoid")}
          >
            <b>{number(alerts.filter((a) => a.severity === "avoid").length)}</b>
            <span>پرهیز / بازبینی</span>
          </button>
          <button
            className={filter === "caution" ? "selected" : ""}
            onClick={() => setFilter(filter === "caution" ? "All" : "caution")}
          >
            <b>
              {number(alerts.filter((a) => a.severity === "caution").length)}
            </b>
            <span>نیازمند احتیاط</span>
          </button>
          <button
            className={filter === "info" ? "selected" : ""}
            onClick={() => setFilter(filter === "info" ? "All" : "info")}
          >
            <b>{number(alerts.filter((a) => a.severity === "info").length)}</b>
            <span>بررسی ناکامل</span>
          </button>
        </div>
        {filter !== "All" && (
          <Button variant="ghost" onClick={() => setFilter("All")}>
            نمایش همه هشدارها
          </Button>
        )}
        {activeBeersGroups.length > 0 && (
          <Button variant="ghost" onClick={toggleAllGroups}>
            {areAllOpen ? (
              <ChevronUp size={16} />
            ) : (
              <ChevronDown size={16} />
            )}
            {areAllOpen ? "بستن همه گروه‌ها" : "باز کردن همه گروه‌ها"}
          </Button>
        )}
        {!meds.length ? (
          <EmptyState
            icon={<ShieldCheck size={34} />}
            heading="بررسی را با یک دارو شروع کنید"
          >
            با افزودن داروها و شرایط بیمار، نتیجه همین‌جا نمایش داده می‌شود.
          </EmptyState>
        ) : alerts.length === 0 ? (
          <Notice tone="success">
            هشداری در قواعد ثبت‌شده فعال نشد. این نتیجه تأیید ایمنی نسخه نیست؛
            داروهای ثبت‌نشده، دوز، مدت مصرف و اندیکاسیون را بررسی کنید.
          </Notice>
        ) : (
          <div className="space-y-3.5">
            {BEERS_GROUPS.map((meta) => {
              const groupAlertsList = (beersAlertGroups[meta.id] || []).filter(
                (a) => filter === "All" || a.severity === filter,
              );
              if (groupAlertsList.length === 0) return null;
              const isOpen = isBeersGroupOpen(meta.id);
              return (
                <div
                  key={meta.id}
                  data-testid={meta.testId}
                  className="audit-group rounded-xl bg-white dark:bg-[#131d2b] border border-slate-200 dark:border-slate-800 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggleBeersGroup(meta.id)}
                    className="w-full flex items-center justify-between p-3.5 bg-slate-50/90 dark:bg-[#0f1723] hover:bg-slate-100/80 dark:hover:bg-slate-800/50 transition-colors text-right cursor-pointer"
                    aria-expanded={isOpen}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-md font-semibold ${meta.accent}`}
                      >
                        {meta.subtitle.split(" · ")[0]}
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {meta.title}
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {meta.subtitle}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="count bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs px-2 py-0.5 rounded-md font-bold">
                        {number(groupAlertsList.length)}
                      </span>
                      {isOpen ? (
                        <ChevronUp size={18} className="text-slate-400" />
                      ) : (
                        <ChevronDown size={18} className="text-slate-400" />
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="p-3.5 space-y-2.5">
                      {groupAlertsList.map((a) => (
                        <article
                          className={"audit-alert " + a.severity}
                          key={a.id}
                        >
                          <div className="flex items-start justify-between gap-2 w-full flex-wrap">
                            <div className="flex items-center gap-2 min-w-0">
                              {a.severity === "info" ? (
                                <Info size={18} />
                              ) : (
                                <AlertTriangle size={18} />
                              )}
                              <h4 className="min-w-0 break-words">{a.title}</h4>
                            </div>
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-md font-semibold border whitespace-nowrap ${a.priorityBadge.bgClass} ${a.priorityBadge.textClass} ${a.priorityBadge.borderClass}`}
                            >
                              {a.priorityBadge.labelFa}
                            </span>
                          </div>
                          <p>{a.detail}</p>
                          {a.action && (
                            <p className="audit-action">{a.action}</p>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {meds.length > 0 &&
          alerts.length > 0 &&
          !alerts.some((a) => filter === "All" || a.severity === filter) && (
            <EmptyState heading="هشداری در این سطح وجود ندارد" />
          )}
      </section>
    </div>
  );
}
