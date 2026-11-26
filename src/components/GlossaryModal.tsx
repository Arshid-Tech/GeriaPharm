import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, X, ChevronDown, ChevronUp, Info } from "lucide-react";
import { glossaryEntries, type GlossaryEntry } from "./glossaryData";

export { glossaryEntries, type GlossaryEntry };

export function AbbrTooltip({
  term,
  children,
}: {
  term: string;
  children: ReactNode;
}) {
  const [show, setShow] = useState(false);
  const entry = glossaryEntries.find(
    (g) => g.term.toLowerCase() === term.toLowerCase(),
  );

  return (
    <span
      className="relative inline-flex items-center gap-1 cursor-help group"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow(!show)}
    >
      <span className="underline decoration-dotted decoration-[#0f4c5c] dark:decoration-[#67c5d4] underline-offset-4">
        {children}
      </span>
      <Info
        size={14}
        className="text-[#0f4c5c] dark:text-[#67c5d4] inline opacity-75 group-hover:opacity-100 transition"
      />
      {show && entry && (
        <span className="absolute bottom-full right-0 mb-2 w-64 p-3 bg-slate-900 text-white dark:bg-slate-800 border border-slate-700 rounded-xl shadow-lg text-xs z-50 pointer-events-none leading-relaxed">
          <strong className="block text-[#67c5d4] font-bold mb-1">
            {entry.term} — {entry.persianTitle}
          </strong>
          {entry.shortDescription}
        </span>
      )}
    </span>
  );
}

export function GlossaryModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("همه");
  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      prev?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const categories = ["همه", "مخفف‌های بالینی", "دسته‌بندی‌های بیرز"];

  const filtered = glossaryEntries.filter((item) => {
    const matchesCat = activeCategory === "همه" || item.category === activeCategory;
    const q = searchTerm.trim().toLowerCase();
    const matchesQuery =
      item.term.toLowerCase().includes(q) ||
      item.persianTitle.toLowerCase().includes(q) ||
      item.shortDescription.toLowerCase().includes(q);
    return matchesCat && matchesQuery;
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="glossary-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-[#131d2b] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden transition-all text-slate-800 dark:text-slate-100">
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0f1723]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#0f4c5c]/10 dark:bg-[#3898a8]/15 text-[#0f4c5c] dark:text-[#67c5d4] flex items-center justify-center">
              <BookOpen size={22} />
            </div>
            <div>
              <h2 id="glossary-modal-title" className="text-lg sm:text-xl font-bold tracking-tight">
                راهنمای اصطلاحات و اختصارات بالینی
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                مفاهیم کلیدی معیارهای بیرز ۲۰۲۳ و اختصارات دارودرمانی سالمندان
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            aria-label="بستن"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="جست‌وجوی اختصار یا عنوان…"
            className="flex-1 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0c131d] text-sm focus:outline-hidden focus:ring-2 focus:ring-[#0f4c5c] dark:focus:ring-[#3898a8] transition"
          />
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {categories.map((cat) => (
              <button
                type="button"
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                  activeCategory === cat
                    ? "bg-[#0f4c5c] dark:bg-[#228096] text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5 divide-y divide-slate-100 dark:divide-slate-800/80">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              موردی مطابق با عبارت جست‌وجو شده یافت نشد.
            </div>
          ) : (
            filtered.map((item) => (
              <div key={item.term} className="pt-2.5 first:pt-0 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/30">
                <div
                  className="flex items-start justify-between cursor-pointer select-none"
                  onClick={() => setExpandedTerm(expandedTerm === item.term ? null : item.term)}
                >
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-xs sm:text-sm font-bold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-[#0f4c5c] dark:text-[#67c5d4] border border-slate-200 dark:border-slate-700">
                      {item.term}
                    </span>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{item.persianTitle}</h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{item.shortDescription}</p>
                    </div>
                  </div>
                  <button type="button" className="text-slate-400 mt-1" aria-label={expandedTerm === item.term ? "بستن جزئیات" : "نمایش جزئیات"}>
                    {expandedTerm === item.term ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                </div>
                {expandedTerm === item.term && (
                  <div className="mt-3 p-3 rounded-lg bg-slate-100/80 dark:bg-[#0f1723] border border-slate-200/70 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
                    <strong className="text-[#0f4c5c] dark:text-[#67c5d4] block mb-1">نکات بالینی:</strong>
                    {item.detailedClinicalNotes}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="p-4 sm:p-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0f1723] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-[#0f4c5c] hover:bg-[#0b3b48] dark:bg-[#228096] dark:hover:bg-[#1b697c] text-white text-sm font-medium transition"
          >
            متوجه شدم
          </button>
        </div>
      </div>
    </div>
  );
}
