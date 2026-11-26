import type { Alert } from "../checker";

export type AlertPriority = "CRITICAL" | "HIGH" | "MODERATE" | "CAUTION";

export interface PrioritizedAlert extends Alert {
  priority: AlertPriority;
  priorityWeight: number;
  priorityBadge: {
    labelFa: string;
    bgClass: string;
    textClass: string;
    borderClass: string;
  };
}

/**
 * Context-Aware Alert Prioritizer.
 * Classifies alerts into 4 clinical priority weights to eliminate Alert Fatigue:
 * - CRITICAL (Weight 4): Fatal interactions (Opioid + Benzo, Warfarin + Amiodarone, CrCl < 15 strict avoid).
 * - HIGH (Weight 3): Core Table 2 & 3 PIMs, avoid-level Interactions/Renal/Disease/Cumulative load.
 * - MODERATE (Weight 2): Dose adjustment required, PPI > 8 weeks, strong anticholinergic monotherapy.
 * - CAUTION (Weight 1): Table 4 items (SGLT2 inhibitors monitoring, Ticagrelor in >= 75yo).
 */
export function prioritizeAlerts(rawAlerts: Alert[]): PrioritizedAlert[] {
  return rawAlerts
    .map((alert) => {
      const title = (alert.title || "").toLowerCase();
      const detail = (alert.detail || "").toLowerCase();
      const action = (alert.action || "").toLowerCase();
      const full = `${title} ${detail} ${action}`;

      let priority: AlertPriority = "MODERATE";
      let priorityWeight = 2;

      // 1. CRITICAL
      if (
        (full.includes("opioid") && full.includes("benzo")) ||
        (full.includes("اوپیوئید") && full.includes("بنزودیازپین")) ||
        (full.includes("اپیوئید") && full.includes("بنزودیازپین")) ||
        (full.includes("warfarin") && full.includes("amiodarone")) ||
        (full.includes("وارفارین") && full.includes("آمیودارون")) ||
        full.includes("crcl < 15") ||
        full.includes("کلیرانس کمتر از ۱۵") ||
        full.includes("ایست قلبی") ||
        full.includes("تنگی نفس و مرگ") ||
        full.includes("سرکوب شدید تنفس و مرگ") ||
        full.includes("خونریزی کشنده")
      ) {
        priority = "CRITICAL";
        priorityWeight = 4;
      }
      // 2. HIGH (structured severity/type first so CMS copy edits stay resilient)
      else if (
        alert.severity === "avoid" ||
        alert.type === "Cumulative load" ||
        (full.includes("dementia") && full.includes("antipsychotic")) ||
        (full.includes("دمانس") && full.includes("آنتی‌پسیکوتیک")) ||
        (full.includes("سقوط") && full.includes("cns")) ||
        (full.includes("fall") && full.includes("cns")) ||
        full.includes("پرهیز قطعی") ||
        full.includes("جدول ۲") ||
        full.includes("جدول ۳")
      ) {
        priority = "HIGH";
        priorityWeight = 3;
      }
      // 3. CAUTION
      else if (
        alert.severity === "caution" ||
        full.includes("sglt2") ||
        full.includes("ticagrelor") ||
        full.includes("تیکاگرلور") ||
        full.includes("جدول ۴") ||
        full.includes("احتیاط")
      ) {
        priority = "CAUTION";
        priorityWeight = 1;
      }
      // 4. MODERATE (Default for info / review notices)
      else {
        priority = "MODERATE";
        priorityWeight = 2;
      }

      const badgeMap: Record<
        AlertPriority,
        PrioritizedAlert["priorityBadge"]
      > = {
        CRITICAL: {
          labelFa: "بحرانی / خطرناک",
          bgClass: "bg-red-100 dark:bg-red-950/70",
          textClass: "text-red-800 dark:text-red-300",
          borderClass: "border-red-300 dark:border-red-800",
        },
        HIGH: {
          labelFa: "اولویت بالا (PIM)",
          bgClass: "bg-rose-50 dark:bg-rose-950/60",
          textClass: "text-rose-800 dark:text-rose-300",
          borderClass: "border-rose-200 dark:border-rose-900",
        },
        MODERATE: {
          labelFa: "اولویت متوسط",
          bgClass: "bg-amber-50 dark:bg-amber-950/60",
          textClass: "text-amber-800 dark:text-amber-300",
          borderClass: "border-amber-200 dark:border-amber-900",
        },
        CAUTION: {
          labelFa: "احتیاط بالینی",
          bgClass: "bg-blue-50 dark:bg-blue-950/60",
          textClass: "text-blue-800 dark:text-blue-300",
          borderClass: "border-blue-200 dark:border-blue-900",
        },
      };

      return {
        ...alert,
        priority,
        priorityWeight,
        priorityBadge: badgeMap[priority],
      };
    })
    .sort((a, b) => b.priorityWeight - a.priorityWeight);
}
