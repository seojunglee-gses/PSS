import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { estimatedImageProgress } from "../../lib/design-alternatives";
export default function ImageGenerationPlaceholder({ editing }: { editing: boolean }) {
  const { t } = useI18n();
  const [progress, setProgress] = useState(1);
  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(() => setProgress(estimatedImageProgress(Date.now() - start)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <div role="status" aria-label={t(editing ? "design.editing" : "design.generating")} className="relative col-span-full aspect-square max-h-96 min-h-48 overflow-hidden rounded-2xl border border-blue-100 bg-slate-50/50 p-5">
    <p className="relative z-10 text-sm text-slate-500">{t(editing ? "design.editing" : "design.generating")}</p>
    <div aria-hidden="true" className="absolute inset-9 animate-pulse" style={{ backgroundImage: "radial-gradient(circle, #60a5fa 1px, transparent 1.5px)", backgroundSize: "16px 16px", maskImage: "radial-gradient(ellipse, black 10%, transparent 72%)", WebkitMaskImage: "radial-gradient(ellipse, black 10%, transparent 72%)" }} />
    <span className="absolute bottom-4 left-4 rounded-full border border-blue-100 bg-white/95 px-3 py-1 text-xs text-blue-700" title={t("design.estimatedNotice")}>{t("design.estimatedProgress", { percent: progress })}</span>
  </div>;
}
