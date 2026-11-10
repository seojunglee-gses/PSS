import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { AnalysisRecord } from "../../lib/research/types";
import { answerEvidenceItems } from "../../lib/research/answer-evidence";
import { answerEvidenceLabels as copy } from "../../lib/research/labels";
import EvidencePanel from "./EvidencePanel";

// Native dialog preserves focus and the underlying conversation scroll position.
export default function AnswerEvidenceDialog({record, onClose, onViewCase, onViewPaper, onViewProject, availableCaseIds = []}: {
  record: AnalysisRecord; onClose: () => void; onViewCase: (id: string) => void; availableCaseIds?: string[];
  onViewPaper?: (paper: AnalysisRecord["evidence"]["papers"][number]) => void; onViewProject?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true}); };
  }, []);
  useEffect(() => { if (dialog.current) dialog.current.scrollTop = 0; }, [record]);
  if (typeof document === "undefined") return null;
  const count = answerEvidenceItems(record).length;
  return createPortal(<dialog ref={dialog} aria-labelledby="answer-evidence-title"
    className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_24px)] max-w-2xl overflow-y-auto overscroll-contain rounded-3xl border border-slate-200 bg-white p-0 text-slate-800 shadow-xl backdrop:bg-slate-900/40"
    onCancel={event => {event.preventDefault(); onClose();}} onClick={event => {if (event.target === event.currentTarget) {const rect = event.currentTarget.getBoundingClientRect(); if(event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();}}}>
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div><h3 id="answer-evidence-title" className="text-lg font-semibold">{copy.title}</h3><p className="text-sm text-slate-500">{copy.total(count)}</p></div>
      <button type="button" onClick={onClose} className="min-h-11 rounded-full border border-slate-200 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50">{copy.close}</button>
    </header>
    <EvidencePanel record={record} evidence={record.evidence} enabled={record.selectedSources} loading={false} highlighted={null} availableCaseIds={availableCaseIds} onViewCase={onViewCase} onViewPaper={onViewPaper} onViewProject={onViewProject}/>
  </dialog>, document.body);
}
