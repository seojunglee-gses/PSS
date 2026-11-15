import { useI18n } from "../../lib/i18n";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { imagePoint, needsDesignEditClarification } from "../../lib/design-alternatives";
export default function DesignImageEditor({ image, busy, readOnly, onClose, onEdit }: {
  image: { id: string; imageUrl?: string; label: string }; busy: boolean; readOnly?: boolean;
  onClose: () => void; onEdit: (id: string, mask: string, request: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const stage = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 1, height: 1 });
  const [natural, setNatural] = useState({ width: 1, height: 1 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const submitting = useRef(false);
  const requestInput = useRef<HTMLTextAreaElement>(null);
  const [viewport, setViewport] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    // This portal is outside WorkspacePanels, so it must follow the keyboard viewport itself.
    const visual = window.visualViewport;
    const measure = () => setViewport({ left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0, width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    visual?.addEventListener("resize", measure); visual?.addEventListener("scroll", measure);
    return () => { window.removeEventListener("resize", measure); visual?.removeEventListener("resize", measure); visual?.removeEventListener("scroll", measure); };
  }, []);
  useEffect(() => {
    const element = stage.current; if (!element) return;
    const observer = new ResizeObserver(() => { const rect = element.getBoundingClientRect(); setArea({ width: rect.width, height: rect.height }); });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const fit = Math.min(area.width / natural.width, area.height / natural.height);
  const canvas = useRef<HTMLCanvasElement>(null);
  const previous = useRef<{ x: number; y: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const view = useRef({ zoom: 100, x: 0, y: 0 });
  const gesture = useRef<{ view: typeof view.current; center: { x: number; y: number }; distance: number } | null>(null);
  const pinching = useRef(false);
  const stroke = useRef<{ pixels: ImageData; selected: boolean } | null>(null);
  const [brush, setBrush] = useState(32), [tool, setTool] = useState<"select" | "erase" | "pan">("pan"), [zoom, setZoom] = useState(100);
  const [request, setRequest] = useState(""), [error, setError] = useState(""), [selected, setSelected] = useState(false);
  useEffect(() => {
    const current = view.current;
    const maxX = Math.max(0, (natural.width * fit * current.zoom / 100 - area.width) / 2);
    const maxY = Math.max(0, (natural.height * fit * current.zoom / 100 - area.height) / 2);
    view.current = { ...current, x: Math.max(-maxX, Math.min(maxX, current.x)), y: Math.max(-maxY, Math.min(maxY, current.y)) };
    setPan({ x: view.current.x, y: view.current.y });
  }, [fit, natural.width, natural.height, area.width, area.height]);
  const applyView = (next: typeof view.current) => {
    const zoom = Math.max(100, Math.min(200, next.zoom));
    const maxX = Math.max(0, (natural.width * fit * zoom / 100 - area.width) / 2);
    const maxY = Math.max(0, (natural.height * fit * zoom / 100 - area.height) / 2);
    view.current = { zoom, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
    setZoom(zoom); setPan({ x: view.current.x, y: view.current.y });
  };
  const beginGesture = () => {
    const points = [...pointers.current.values()];
    gesture.current = points.length ? { view: { ...view.current }, center: points.length > 1 ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } : points[0], distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0 } : null;
    previous.current = null;
  };
  const rollbackStroke = () => {
    if (stroke.current) { canvas.current?.getContext("2d")?.putImageData(stroke.current.pixels, 0, 0); setSelected(stroke.current.selected); stroke.current = null; }
    previous.current = null;
  };
  const paint = (event: { clientX: number; clientY: number }) => {
    const target = canvas.current, ctx = target?.getContext("2d");
    if (!target || !ctx || busy || readOnly) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) { previous.current = null; return; }
    const point = imagePoint(event.clientX, event.clientY, rect, target.width, target.height);
    ctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = "rgba(37,99,235,0.5)"; ctx.fillStyle = "rgba(37,99,235,0.5)";
    ctx.lineWidth = brush * target.width / rect.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(previous.current?.x ?? point.x, previous.current?.y ?? point.y); ctx.lineTo(point.x, point.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(point.x, point.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
    previous.current = point; setSelected(true);
  };
  const submit = async () => {
    const text = (requestInput.current?.value ?? request).trim();
    const target = canvas.current; if (!target || busy || submitting.current || !text) return;
    if (needsDesignEditClarification(text)) { setError(t("design.editClarify")); return; }
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
    try { await onEdit(image.id, mask.toDataURL("image/png"), text); } catch (error) { setError(error instanceof Error ? error.message : t("design.editFailed")); } finally { submitting.current = false; }
  };
  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    if (event.type !== "pointerup") rollbackStroke(); else stroke.current = null;
    pointers.current.delete(event.pointerId);
    if (!pointers.current.size) pinching.current = false;
    beginGesture();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return createPortal(<div className="fixed z-[100] flex items-center justify-center bg-slate-950/75 p-2" style={viewport ?? { inset: 0 }} onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label={t("design.editorTitle")} className="relative flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white p-2" style={{ maxHeight: viewport ? Math.max(0, viewport.height - 16) : "94dvh", height: `min(${viewport ? Math.max(0, viewport.height - 16) + "px" : "94dvh"}, calc(min(calc(100vw - 32px), 1136px) * ${natural.height / natural.width} + ${readOnly ? 16 : 112}px))` }} onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <button autoFocus type="button" aria-label={t("common.close")} className="absolute right-3 top-3 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-2xl text-slate-600 shadow-sm" onClick={onClose}>×</button>
      <div ref={stage} className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-slate-100" aria-label={t("design.selectionArea")} style={{ touchAction: "none" }}
        onPointerDown={event => {
          if (event.button !== 0 || pointers.current.size >= 2 || (event.target as HTMLElement).closest('[role="toolbar"]')) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          beginGesture();
          if (pointers.current.size > 1) { rollbackStroke(); pinching.current = true; }
          else if (!busy && !readOnly && tool !== "pan" && event.target === canvas.current && natural.width > 1) {
            const target = canvas.current!;
            stroke.current = { pixels: target.getContext("2d")!.getImageData(0, 0, target.width, target.height), selected };
            paint(event);
          }
        }} onPointerMove={event => {
          if (!pointers.current.has(event.pointerId) || !gesture.current) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size === 1 && stroke.current && !pinching.current && tool !== "pan" && !readOnly && !busy) { paint(event); return; }
          const points = [...pointers.current.values()], start = gesture.current, bounds = event.currentTarget.getBoundingClientRect();
          const center = points.length > 1 ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } : points[0];
          const zoom = points.length > 1 && start.distance > 0 ? Math.max(100, Math.min(200, start.view.zoom * Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / start.distance)) : start.view.zoom;
          applyView({ zoom, x: center.x - bounds.left - bounds.width / 2 - (start.center.x - bounds.left - bounds.width / 2 - start.view.x) * zoom / start.view.zoom, y: center.y - bounds.top - bounds.height / 2 - (start.center.y - bounds.top - bounds.height / 2 - start.view.y) * zoom / start.view.zoom });
        }} onPointerUp={endPointer} onPointerCancel={endPointer} onLostPointerCapture={endPointer}>
        <div className="absolute left-1/2 top-1/2" style={{ width: natural.width * fit, height: natural.height * fit, transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})` }}>
          <img src={image.imageUrl} alt={image.label} className="block h-full w-full max-w-none" draggable={false} onLoad={event => { const target = canvas.current; if (target) { target.width = event.currentTarget.naturalWidth; target.height = event.currentTarget.naturalHeight; setNatural({ width: target.width, height: target.height }); } }} />
          <canvas ref={canvas} aria-label={t("design.paintArea")} className="absolute inset-0 h-full w-full" style={{ cursor: tool === "pan" || readOnly ? "grab" : "crosshair" }} />
        </div>
        <div role="toolbar" aria-label={t("design.tools")} className="absolute left-2 top-2 z-20 flex max-w-[calc(100%_-_64px)] items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xl border border-slate-200 bg-white/90 p-1 shadow-sm backdrop-blur-sm">
          {!readOnly && <><button type="button" disabled={busy} aria-pressed={tool === "select"} className={`min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold ${tool === "select" ? "bg-blue-100 text-blue-900" : "text-slate-600"}`} onClick={() => setTool("select")}>{t("design.select")}</button>
          <button type="button" disabled={busy} aria-pressed={tool === "erase"} className={`min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold ${tool === "erase" ? "bg-blue-100 text-blue-900" : "text-slate-600"}`} onClick={() => setTool("erase")}>{t("design.eraser")}</button></>}
          <button type="button" aria-label={t("design.pan")} aria-pressed={tool === "pan"} className={`min-h-11 min-w-11 shrink-0 rounded-lg text-lg ${tool === "pan" ? "bg-blue-100 text-blue-900" : "text-slate-600"}`} onClick={() => setTool("pan")}>✥</button>
          {!readOnly && <><input className="min-h-11 w-16 shrink-0 accent-blue-700" aria-label={t("design.brushSize")} title={t("design.brushSize")} type="range" min="8" max="80" value={brush} disabled={busy} onChange={event => setBrush(Number(event.target.value))} />
          <button type="button" disabled={busy} aria-label={t("design.clear")} title={t("design.clear")} className="min-h-11 min-w-11 shrink-0 rounded-lg text-lg text-slate-600" onClick={() => { const target = canvas.current; if (target) target.getContext("2d")!.clearRect(0, 0, target.width, target.height); setSelected(false); }}>↺</button></>}
          <input className="min-h-11 w-24 shrink-0 accent-blue-700" aria-label={t("design.imageZoom")} title={t("design.imageZoom")} type="range" min="100" max="200" step="1" value={zoom} onChange={event => applyView({ zoom: Number(event.target.value), x: 0, y: 0 })} />
        </div>
      </div>
      {!readOnly && <div className="shrink-0 pt-2">
        <p className="mb-1 px-2 text-xs text-slate-500">{t("design.maskScope")}</p>
        {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
        <div className="flex items-center gap-2"><textarea ref={requestInput} aria-label={t("design.editRequest")} rows={2} inputMode="text" maxLength={4000} className="min-h-12 min-w-0 flex-1 resize-none rounded-2xl border border-slate-200 px-4 py-2 text-base" value={request} disabled={busy} onInput={event => setRequest(event.currentTarget.value)} onChange={event => setRequest(event.target.value)} onCompositionEnd={event => setRequest(event.currentTarget.value)} placeholder={t("design.editPlaceholder")} />
          <button type="button" title={t("design.maskWarning")} disabled={busy || !selected || !request.trim()} className="min-h-12 shrink-0 rounded-full bg-[var(--primary)] px-4 py-3 font-semibold text-white disabled:opacity-50" onClick={() => void submit()}>{t(busy ? "design.editing" : "design.editAction")}</button></div>
      </div>}
    </section>
  </div>, document.body);
}
