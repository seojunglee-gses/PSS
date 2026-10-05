import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { researchLabels } from "../../lib/research/labels";
import { SOURCE_OPTIONS, type EvidenceSource } from "../../lib/research/types";

export default function SourceSelector({ selected, onChange, disabled }: {
  selected: EvidenceSource[]; onChange: (sources: EvidenceSource[]) => void; disabled: boolean;
}) {
  const { locale } = useI18n();
  const labels = researchLabels(locale);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    container.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={container} className="relative shrink-0">
    <button ref={trigger} type="button" aria-label={labels.choose} aria-expanded={open} aria-controls="analysis-source-options"
      disabled={disabled} onClick={() => setOpen(!open)}
      className="h-10 w-10 rounded-full border border-slate-200 text-xl text-slate-600 hover:border-blue-400 disabled:opacity-50">+</button>
    {open && <fieldset id="analysis-source-options" className="absolute bottom-12 left-0 z-40 w-64 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
      <legend className="sr-only">{labels.choose}</legend>
      <p className="mb-2 text-sm font-semibold text-slate-800">{labels.choose}</p>
      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-blue-50">
        <input type="checkbox" checked={!selected.length} disabled={disabled} onChange={() => onChange([])} />
        {labels.auto}
      </label>
      {SOURCE_OPTIONS.map((source) => <label key={source} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-blue-50">
        <input type="checkbox" checked={selected.includes(source)} disabled={disabled}
          onChange={() => onChange(selected.includes(source) ? selected.filter((s) => s !== source) : [...selected, source])} />
        {labels[source]}
      </label>)}
      <p className="mt-2 text-xs text-slate-500">{labels.sourceHelp}</p>
    </fieldset>}
  </div>;
}
