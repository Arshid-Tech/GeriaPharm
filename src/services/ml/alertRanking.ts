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
 * - CRITICAL (Weight 4 - Red): Fatal interactions (Opioid + Benzo, Warfarin + Amiodarone, CrCl < 15 strict avoid).
 * - HIGH (Weight 3 - Rose): Core Table 2 & 3 PIMs, avoid-level Interactions/Renal/Disease/Cumulative load.
 * - MODERATE (Weight 2 - Amber): Dose adjustment required, PPI > 8 weeks, strong anticholinergic monotherapy.
 * - CAUTION (Weight 1 - Blue/Violet): Table 4 items (SGLT2 inhibitors monitoring, Ticagrelor in >= 75yo).
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
          bgClass: "bg-red-500/15",
          textClass: "text-red-600 dark:text-red-400",
          borderClass: "border-red-500/30",
        },
        HIGH: {
          labelFa: "اولویت بالا (PIM)",
          bgClass: "bg-rose-500/15",
          textClass: "text-rose-600 dark:text-rose-400",
          borderClass: "border-rose-500/30",
        },
        MODERATE: {
          labelFa: "اولویت متوسط",
          bgClass: "bg-amber-500/15",
          textClass: "text-amber-600 dark:text-amber-400",
          borderClass: "border-amber-500/30",
        },
        CAUTION: {
          labelFa: "احتیاط بالینی",
          bgClass: "bg-blue-500/15",
          textClass: "text-blue-600 dark:text-blue-400",
          borderClass: "border-blue-500/30",
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
