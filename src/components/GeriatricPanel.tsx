import { useEffect, useState } from "react";
import { ShieldAlert, Info, X, AlertTriangle } from "lucide-react";
import { Button } from "./ui/Primitives";
import { number } from "../lib/fa";
import {
  STOPPFALL_CLASSES,
  PANEL_REFERENCES,
  type PanelEvaluation,
  type BreakdownRow,
} from "../services/ml/geriatricRiskPanel";

interface GeriatricPanelProps {
  panel: PanelEvaluation;
  breakdown?: BreakdownRow[];
}

/**
 * Multi-dimensional geriatric risk panel: STOPPFall FRIDs, anticholinergic
 * cognitive burden, polypharmacy and Beers PIM — each dimension is reported
 * on its own scale (no composite score is computed).
 */
export function GeriatricPanel({ panel }: GeriatricPanelProps) {
  const [showDetails, setShowDetails] = useState(false);
  const { frid, acb, polypharmacy, beers } = panel;

  useEffect(() => {
    if (!showDetails) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowDetails(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      prev?.focus?.();
    };
  }, [showDetails]);

  return (
    <section
      className="geriatric-panel mb-5 w-full min-w-0"
      aria-labelledby="geriatric-panel-title"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* FRID — STOPPFall */}
        <div className="p-4 rounded-xl bg-white dark:bg-[#131d2b] border border-slate-200 dark:border-slate-800 border-r-4 border-r-red-600 dark:border-r-red-500 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-semibold text-xs text-slate-700 dark:text-slate-200">
              داروهای افزایش‌دهنده ریسک سقوط (FRID)
            </h3>
            <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-300 border border-red-200/70 dark:border-red-900 font-medium">
              STOPPFall
            </span>
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">
            {number(frid.fridCount)}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {number(frid.fridCount)} دارو در {number(frid.fridClassCount)} کلاس
            متمایز
          </p>
          {frid.highRiskCount > 0 && (
            <p className="mt-2 text-[11px] font-medium text-red-700 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle size={13} className="shrink-0" />
              {number(frid.highRiskCount)} داروی زیرکلاس پرخطر
            </p>
          )}
          {frid.classesPresent.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {frid.classesPresent.map((n) => (
                <span
                  key={n}
                  className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px]"
                >
                  {STOPPFALL_CLASSES.find((c) => c.n === n)?.fa ?? number(n)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Anticholinergic Cognitive Burden */}
        <div
          className={`p-4 rounded-xl min-w-0 bg-white dark:bg-[#131d2b] border border-slate-200 dark:border-slate-800 border-r-4 ${
            acb.severity === "danger"
              ? "border-r-red-600 dark:border-r-red-500"
              : "border-r-emerald-600 dark:border-r-emerald-500"
          }`}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-semibold text-xs text-slate-700 dark:text-slate-200">
              بار آنتی‌کولینرژیک شناختی (ACB)
            </h3>
            <span
              className={`shrink-0 text-[10px] px-2 py-0.5 rounded-md font-medium border ${
                acb.elevated
                  ? "bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-300 border-red-200/70 dark:border-red-900"
                  : "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-900"
              }`}
            >
              {acb.elevated ? "بالا" : "عادی"}
            </span>
          </div>
          <div
            className={`text-3xl font-bold ${
              acb.severity === "danger"
                ? "text-red-700 dark:text-red-400"
                : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {number(acb.total)}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {acb.label} · {number(acb.contributors.length)} دارو مشارکت‌کننده
          </p>
        </div>

        {/* Polypharmacy */}
        <div
          className={`p-4 rounded-xl min-w-0 bg-white dark:bg-[#131d2b] border border-slate-200 dark:border-slate-800 border-r-4 ${
            polypharmacy.severity === "danger"
              ? "border-r-red-600 dark:border-r-red-500"
              : polypharmacy.severity === "warn"
                ? "border-r-amber-500 dark:border-r-amber-400"
                : "border-r-emerald-600 dark:border-r-emerald-500"
          }`}
        >
          <h3 className="font-semibold text-xs text-slate-700 dark:text-slate-200 mb-2">
            پلی‌فارمسی
          </h3>
          <div
            className={`text-3xl font-bold ${
              polypharmacy.severity === "danger"
                ? "text-red-700 dark:text-red-400"
                : polypharmacy.severity === "warn"
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {number(polypharmacy.count)}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {polypharmacy.label}
          </p>
        </div>

        {/* Beers PIM */}
        <div className="p-4 rounded-xl bg-white dark:bg-[#131d2b] border border-slate-200 dark:border-slate-800 border-r-4 border-r-[#0f4c5c] dark:border-r-[#3898a8] min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-semibold text-xs text-slate-700 dark:text-slate-200">
              داروهای نامناسب بیرز (PIM)
            </h3>
            <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[#0f4c5c] dark:text-[#67c5d4] border border-slate-200 dark:border-slate-700 font-medium">
              Beers 2023
            </span>
          </div>
          <div className="text-3xl font-bold text-[#0f4c5c] dark:text-[#67c5d4]">
            {number(beers.alertCount)}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 flex flex-wrap gap-x-3">
            <span>{number(beers.avoidCount)} پرهیز</span>
            <span>{number(beers.cautionCount)} احتیاط</span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-2.5 mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setShowDetails(true)}
            className="flex items-center gap-1.5 text-xs"
          >
            <Info size={15} />
            نحوه محاسبه و مستندات علمی
          </Button>
        </div>
      </div>

      {/* How-it-is-calculated & scientific references modal */}
      {showDetails && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="geriatric-panel-details-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDetails(false);
          }}
        >
          <div className="bg-white dark:bg-[#131d2b] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0f1723]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 shrink-0 rounded-lg bg-[#0f4c5c]/10 dark:bg-[#3898a8]/15 text-[#0f4c5c] dark:text-[#67c5d4] flex items-center justify-center">
                  <ShieldAlert size={22} />
                </div>
                <div>
                  <h2
                    id="geriatric-panel-details-title"
                    className="text-base sm:text-lg font-bold tracking-tight"
                  >
                    نحوه محاسبه پنل چندبعدی ریسک سالمندی
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    هر بُعد بر مقیاس مستقل گزارش می‌شود؛ هیچ امتیاز ترکیبی
                    محاسبه نمی‌شود.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDetails(false)}
                className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                aria-label="بستن"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-6 text-sm text-slate-700 dark:text-slate-300">
              <section>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                  ۱) داروهای افزایش‌دهنده ریسک سقوط (FRID) — معیار STOPPFall
                </h3>
                <ul className="list-disc pr-5 space-y-1.5">
                  <li>
                    هر دارویی که در یکی از ۱۴ کلاس STOPPFall (Seppala و همکاران،
                    ۲۰۲۱) باشد، یک FRID شمرده می‌شود؛ <b>fridCount</b> تعداد
                    چنین داروهاست.
                  </li>
                  <li>
                    <b>fridClassCount</b> تعداد کلاس‌های متمایزِ پوشش‌داده‌شده
                    است (نه تعداد دارو).
                  </li>
                  <li>
                    داروهایی که در زیرکلاس پرخطر (
                    <code>isHighRiskSubclass</code>) باشند — مانند
                    بنزودیازپین‌های طولانی‌اثر، آپیوئیدهای قوی، دیورتیک‌های لوپ
                    و آلفا-بلوکرها — جداگانه فهرست می‌شوند.
                  </li>
                  {frid.highRiskNames.length > 0 && (
                    <li className="list-none">
                      <span className="font-medium text-red-700 dark:text-red-400">
                        داروهای پرخطر انتخابی:{" "}
                      </span>
                      {frid.highRiskNames.join("، ")}
                    </li>
                  )}
                </ul>
              </section>

              <section>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                  ۲) بار آنتی‌کولینرژیک شناختی (ACB)
                </h3>
                <ul className="list-disc pr-5 space-y-1.5">
                  <li>
                    مجموع وزن‌های ۰ تا ۳ هر دارو بر اساس مقیاس ACB (Boustani و
                    همکاران، ۲۰۰۸؛ به‌روزرسانی Regenstrief ۲۰۱۲).
                  </li>
                  <li>
                    آستانه هشدار بالینی: مجموع <b>≥ ۳</b> ({acb.label}).
                  </li>
                  {acb.contributors.length > 0 && (
                    <li className="list-none">
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {acb.contributors.map((c) => (
                          <span
                            key={c.id}
                            className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-xs"
                          >
                            {c.name} <b>×{number(c.score)}</b>
                          </span>
                        ))}
                      </div>
                    </li>
                  )}
                </ul>
              </section>

              <section>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                  ۳) پلی‌فارمسی
                </h3>
                <ul className="list-disc pr-5 space-y-1.5">
                  <li>
                    تعریف بر اساس Masnoon و همکاران، ۲۰۱۷: <b>۰ تا ۴</b> دارو =
                    بدون پلی‌فارمسی؛ <b>۵ تا ۹</b> = پلی‌فارمسی؛ <b>≥ ۱۰</b> =
                    پلی‌فارمسی شدید / ابرپلی‌فارمسی.
                  </li>
                  <li>
                    تعداد داروهای انتخابی درمان‌های فعلی بیمار (نه کل سوابق
                    دارویی) شمرده می‌شود.
                  </li>
                </ul>
              </section>

              <section>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                  ۴) داروهای نامناسب بیرز (PIM)
                </h3>
                <ul className="list-disc pr-5 space-y-1.5">
                  <li>
                    تعداد هشدارهای سطح <b>دارو (Medication)</b> در گزارش بالینیِ
                    پایین‌تر، دقیقاً همان چیزی است که در این کارت شمرده می‌شود.
                  </li>
                  <li>
                    تفکیک به «پرهیز» (<code>avoid</code>) و «احتیاط» (
                    <code>caution</code>) بر اساس AGS Beers Criteria 2023.
                  </li>
                  <li>
                    جدول تفکیک (دکمهٔ «جدول تفکیک محاسبه») نشان می‌دهد هر دارو
                    در کدام کلاس STOPPFall است، وزن ACB چقدر دارد و آیا پرچم‌دار
                    شده است یا نه.
                  </li>
                </ul>
              </section>

              <section>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                  مراجع علمی
                </h3>
                <ol className="list-decimal pr-5 space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {PANEL_REFERENCES.map((ref, i) => (
                    <li key={i}>{ref}</li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
