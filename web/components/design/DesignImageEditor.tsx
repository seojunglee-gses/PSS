import { useI18n } from "../../lib/i18n";
import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { imagePoint } from "../../lib/design-alternatives";
export default function DesignImageEditor({ image, busy, readOnly, onClose, onEdit }: {
  image: { id: string; imageUrl?: string; label: string }; busy: boolean; readOnly?: boolean;
  onClose: () => void; onEdit: (id: string, mask: string, request: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const previous = useRef<{ x: number; y: number } | null>(null);
  const activePointer = useRef<number | null>(null);
  const [brush, setBrush] = useState(32), [erase, setErase] = useState(false), [zoom, setZoom] = useState(100);
  const [request, setRequest] = useState(""), [error, setError] = useState(""), [selected, setSelected] = useState(false);
  const paint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const target = canvas.current, ctx = target?.getContext("2d");
    if (!target || !ctx || busy || readOnly) return;
    const rect = target.getBoundingClientRect(), point = imagePoint(event.clientX, event.clientY, rect, target.width, target.height);
    ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    ctx.strokeStyle = "rgba(37,99,235,0.5)"; ctx.fillStyle = "rgba(37,99,235,0.5)";
    ctx.lineWidth = brush * target.width / rect.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(previous.current?.x ?? point.x, previous.current?.y ?? point.y); ctx.lineTo(point.x, point.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(point.x, point.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
    previous.current = point; setSelected(true);
  };
  const submit = async () => {
    const target = canvas.current; if (!target || busy || !request.trim()) return;
    const ctx = target.getContext("2d")!;
    const pixels = ctx.getImageData(0, 0, target.width, target.height).data;
    if (!pixels.some((value, index) => index % 4 === 3 && value > 0)) { setError(t("design.maskEmpty")); return; }
    const mask = document.createElement("canvas"); mask.width = target.width; mask.height = target.height;
    const maskCtx = mask.getContext("2d")!, data = maskCtx.createImageData(mask.width, mask.height);
    // Official mask: selected pixels transparent, all unselected pixels opaque.
    for (let i = 0; i < pixels.length; i += 4) { data.data[i] = data.data[i + 1] = data.data[i + 2] = 255; data.data[i + 3] = pixels[i + 3] ? 0 : 255; }
    maskCtx.putImageData(data, 0, 0);
    setError("");
    try { await onEdit(image.id, mask.toDataURL("image/png"), request.trim()); } catch (error) { setError(error instanceof Error ? error.message : t("design.editFailed")); }
  };
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-3" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label={t("design.editorTitle")} className="max-h-[94dvh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-4 sm:p-6" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <header className="mb-3 flex items-center justify-between gap-3"><h3 className="text-lg font-bold text-blue-950">{t("design.editorTitle")}</h3><button autoFocus type="button" className="min-h-11 min-w-11 rounded-lg border px-3" onClick={onClose}>{t("common.close")}</button></header>
      {!readOnly && <p className="mb-3 text-sm text-slate-600">{t("design.editGuide")}</p>}
      <div className="max-h-[55dvh] overflow-auto rounded-xl bg-slate-100" aria-label={t("design.selectionArea")}>
        <div className="relative" style={{ width: `${zoom}%` }}>
          <img src={image.imageUrl} alt={image.label} className="block h-auto w-full" draggable={false} onLoad={event => { const target = canvas.current; if (target) { target.width = event.currentTarget.naturalWidth; target.height = event.currentTarget.naturalHeight; } }} />
          <canvas ref={canvas} aria-label={t("design.paintArea")} className="absolute inset-0 h-full w-full" style={{ touchAction: readOnly || busy ? "auto" : "none", cursor: readOnly ? "default" : "crosshair" }} onPointerDown={event => { if (busy || readOnly || activePointer.current !== null) return; activePointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); previous.current = null; paint(event); }} onPointerMove={event => { if (activePointer.current === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) paint(event); }} onPointerUp={event => { if (activePointer.current !== event.pointerId) return; activePointer.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); previous.current = null; }} onPointerCancel={() => { activePointer.current = null; previous.current = null; }} />
        </div>
      </div>
      <div className="my-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex min-h-11 items-center gap-2">{t("design.zoom")}<input aria-label={t("design.imageZoom")} type="range" min="100" max="200" step="25" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label>
        {!readOnly && <><label className="flex min-h-11 items-center gap-2">{t("design.brush")}<input aria-label={t("design.brushSize")} type="range" min="8" max="80" value={brush} disabled={busy} onChange={event => setBrush(Number(event.target.value))} /></label>
          <button type="button" aria-pressed={erase} disabled={busy} className={`min-h-11 rounded-lg border px-3 ${erase ? "bg-blue-100 text-blue-900" : ""}`} onClick={() => setErase(value => !value)}>{t(erase ? "design.paint" : "design.erase")}</button>
          <button type="button" disabled={busy} className="min-h-11 rounded-lg border px-3" onClick={() => { const target = canvas.current; if (target) target.getContext("2d")!.clearRect(0, 0, target.width, target.height); setSelected(false); }}>{t("design.clear")}</button></>}
      </div>
      {!readOnly && <><textarea aria-label={t("design.editRequest")} rows={2} maxLength={4000} className="w-full rounded-xl border p-3" value={request} disabled={busy} onChange={event => setRequest(event.target.value)} placeholder={t("design.editPlaceholder")} />
        <p className="my-2 text-xs text-slate-500">{t("design.maskWarning")}</p>
        {error && <p role="alert" className="my-2 text-sm text-red-700">{error}</p>}
        <button type="button" disabled={busy || !selected || !request.trim()} className="min-h-11 rounded-full bg-[var(--primary)] px-5 py-2 font-semibold text-white disabled:opacity-50" onClick={() => void submit()}>{t(busy ? "design.editing" : "design.editButton")}</button></>}
    </section>
  </div>, document.body);
}
