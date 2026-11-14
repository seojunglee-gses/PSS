import { useI18n } from "../../lib/i18n";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { imagePoint } from "../../lib/design-alternatives";
export default function DesignImageEditor({ image, busy, readOnly, onClose, onEdit }: {
  image: { id: string; imageUrl?: string; label: string }; busy: boolean; readOnly?: boolean;
  onClose: () => void; onEdit: (id: string, mask: string, request: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const stage = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 1, height: 1 });
  const [natural, setNatural] = useState({ width: 1, height: 1 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    const element = stage.current; if (!element) return;
    const observer = new ResizeObserver(() => { const rect = element.getBoundingClientRect(); setArea({ width: rect.width, height: rect.height }); });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const fit = Math.min(area.width / natural.width, area.height / natural.height);
  const canvas = useRef<HTMLCanvasElement>(null);
  const previous = useRef<{ x: number; y: number } | null>(null);
  const activePointer = useRef<number | null>(null);
  const [brush, setBrush] = useState(32), [tool, setTool] = useState<"select" | "erase" | "pan">("select"), [zoom, setZoom] = useState(100);
  const [request, setRequest] = useState(""), [error, setError] = useState(""), [selected, setSelected] = useState(false);
  const paint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const target = canvas.current, ctx = target?.getContext("2d");
    if (!target || !ctx || busy || readOnly) return;
    const rect = target.getBoundingClientRect(), point = imagePoint(event.clientX, event.clientY, rect, target.width, target.height);
    ctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = "rgba(37,99,235,0.5)"; ctx.fillStyle = "rgba(37,99,235,0.5)";
    ctx.lineWidth = brush * target.width / rect.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(previous.current?.x ?? point.x, previous.current?.y ?? point.y); ctx.lineTo(point.x, point.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(point.x, point.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
    previous.current = point; setSelected(true);
  };
  const submit = async () => {
    const target = canvas.current; if (!target || busy || submitting.current || !request.trim()) return;
    const ctx = target.getContext("2d")!;
    const pixels = ctx.getImageData(0, 0, target.width, target.height).data;
    if (!pixels.some((value, index) => index % 4 === 3 && value > 0)) { setError(t("design.maskEmpty")); return; }
    const mask = document.createElement("canvas"); mask.width = target.width; mask.height = target.height;
    const maskCtx = mask.getContext("2d")!, data = maskCtx.createImageData(mask.width, mask.height);
    // Official mask: selected pixels transparent, all unselected pixels opaque.
    for (let i = 0; i < pixels.length; i += 4) { data.data[i] = data.data[i + 1] = data.data[i + 2] = 255; data.data[i + 3] = pixels[i + 3] ? 0 : 255; }
    maskCtx.putImageData(data, 0, 0);
    setError("");
    submitting.current = true;
    try { await onEdit(image.id, mask.toDataURL("image/png"), request.trim()); } catch (error) { setError(error instanceof Error ? error.message : t("design.editFailed")); } finally { submitting.current = false; }
  };
  const endPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null; previous.current = null; panStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-2" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label={t("design.editorTitle")} className="relative flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white p-2" style={{ height: `min(94dvh, calc(min(calc(100vw - 32px), 1136px) * ${natural.height / natural.width} + ${readOnly ? 16 : 72}px))` }} onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <button autoFocus type="button" aria-label={t("common.close")} className="absolute right-3 top-3 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-2xl text-slate-600 shadow-sm" onClick={onClose}>×</button>
      <div ref={stage} className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-slate-100" aria-label={t("design.selectionArea")}>
        <div className="absolute left-1/2 top-1/2" style={{ width: natural.width * fit, height: natural.height * fit, transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})` }}>
          <img src={image.imageUrl} alt={image.label} className="block h-full w-full max-w-none" draggable={false} onLoad={event => { const target = canvas.current; if (target) { target.width = event.currentTarget.naturalWidth; target.height = event.currentTarget.naturalHeight; setNatural({ width: target.width, height: target.height }); } }} />
          <canvas ref={canvas} aria-label={t("design.paintArea")} className="absolute inset-0 h-full w-full" style={{ touchAction: "none", cursor: tool === "pan" || readOnly ? "grab" : "crosshair" }} onPointerDown={event => {
            if (activePointer.current !== null) return;
            if ((busy || readOnly) && tool !== "pan" && !readOnly) return;
            activePointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); previous.current = null;
            if (tool === "pan" || readOnly) panStart.current = { x: event.clientX, y: event.clientY, left: pan.x, top: pan.y }; else paint(event);
          }} onPointerMove={event => {
            if (activePointer.current !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            if (panStart.current) setPan({ x: panStart.current.left + event.clientX - panStart.current.x, y: panStart.current.top + event.clientY - panStart.current.y }); else paint(event);
          }} onPointerUp={endPointer} onPointerCancel={endPointer} />
        </div>
        <div role="toolbar" aria-label={t("design.tools")} className="absolute left-2 top-2 z-20 flex max-w-[calc(100%_-_64px)] items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xl border border-slate-200 bg-white/90 p-1 shadow-sm backdrop-blur-sm">
          {!readOnly && <><button type="button" disabled={busy} aria-pressed={tool === "select"} className={`min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold ${tool === "select" ? "bg-blue-100 text-blue-900" : "text-slate-600"}`} onClick={() => setTool("select")}>{t("design.select")}</button>
          <button type="button" disabled={busy} aria-pressed={tool === "erase"} className={`min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold ${tool === "erase" ? "bg-blue-100 text-blue-900" : "text-slate-600"}`} onClick={() => setTool("erase")}>{t("design.eraser")}</button></>}
          <button type="button" aria-label={t("design.pan")} aria-pressed={tool === "pan"} className={`min-h-11 min-w-11 shrink-0 rounded-lg text-lg ${tool === "pan" ? "bg-blue-100 text-blue-900" : "text-slate-600"}`} onClick={() => setTool("pan")}>✥</button>
          {!readOnly && <><input className="min-h-11 w-16 shrink-0 accent-blue-700" aria-label={t("design.brushSize")} title={t("design.brushSize")} type="range" min="8" max="80" value={brush} disabled={busy} onChange={event => setBrush(Number(event.target.value))} />
          <button type="button" disabled={busy} aria-label={t("design.clear")} title={t("design.clear")} className="min-h-11 min-w-11 shrink-0 rounded-lg text-lg text-slate-600" onClick={() => { const target = canvas.current; if (target) target.getContext("2d")!.clearRect(0, 0, target.width, target.height); setSelected(false); }}>↺</button></>}
          <input className="min-h-11 w-24 shrink-0 accent-blue-700" aria-label={t("design.imageZoom")} title={t("design.imageZoom")} type="range" min="100" max="200" step="25" value={zoom} onChange={event => { setZoom(Number(event.target.value)); setPan({ x: 0, y: 0 }); }} />
        </div>
      </div>
      {!readOnly && <div className="shrink-0 pt-2">
        {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
        <div className="flex items-center gap-2"><input aria-label={t("design.editRequest")} maxLength={4000} className="min-h-12 min-w-0 flex-1 rounded-full border border-slate-200 px-4 py-3 text-base" value={request} disabled={busy} onChange={event => setRequest(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void submit(); }} placeholder={t("design.editPlaceholder")} />
          <button type="button" title={t("design.maskWarning")} disabled={busy || !selected || !request.trim()} className="min-h-12 shrink-0 rounded-full bg-[var(--primary)] px-4 py-3 font-semibold text-white disabled:opacity-50" onClick={() => void submit()}>{t(busy ? "design.editing" : "design.editAction")}</button></div>
      </div>}
    </section>
  </div>, document.body);
}
