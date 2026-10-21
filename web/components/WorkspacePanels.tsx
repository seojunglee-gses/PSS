import { Children, useCallback, useEffect, useId, useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { constrainPanelRatio, DEFAULT_PANEL_RATIO, PANEL_DIVIDER_WIDTH, panelRatioBounds, workspaceLayoutMode } from "../lib/workspace-layout";
import type { WorkspacePanelView } from "../lib/workspace-layout";

export default function WorkspacePanels({ children, ratio, onRatioChange, view, onViewChange }: {
  children: ReactNode; ratio: number; onRatioChange: (ratio: number) => void;
  view: WorkspacePanelView; onViewChange: (view: WorkspacePanelView) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const divider = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(ratio);
  const drag = useRef<{ id: number; x: number; moved: boolean } | null>(null);
  const tap = useRef<{ time: number; x: number } | null>(null);
  const dragFrame = useRef(0);
  const panels = Children.toArray(children);

  const applyRatio = useCallback((value: number) => {
    const node = root.current;
    if (!node) return value;
    const next = constrainPanelRatio(value, node.clientWidth);
    node.style.setProperty("--information-track", `${next}fr`);
    node.style.setProperty("--chat-track", `${100 - next}fr`);
    const limits = panelRatioBounds(node.clientWidth);
    if (limits.min <= limits.max) {
      divider.current?.setAttribute("aria-valuemin", String(Math.round(limits.min)));
      divider.current?.setAttribute("aria-valuemax", String(Math.round(limits.max)));
    }
    divider.current?.setAttribute("aria-valuenow", String(Math.round(next)));
    divider.current?.setAttribute("aria-valuetext", `${t("workspace.informationView")} ${Math.round(next)}% · ${t("workspace.chatView")} ${Math.round(100 - next)}%`);
    return next;
  }, [t]);
  useEffect(() => {
    ratioRef.current = ratio;
    applyRatio(ratio);
  }, [ratio, applyRatio]); // Resize and pointer events apply the same constraints without rendering each move.

  useEffect(() => {
    const node = root.current;
    const shell = node?.closest<HTMLElement>(".workspace-shell");
    if (!node || !shell) return;
    const viewport = window.visualViewport;
    let frame = 0;
    let previousWidth = window.innerWidth;
    let baselineHeight = Math.max(window.innerHeight, viewport?.height ?? 0);
    let landscape = window.matchMedia("(orientation: landscape)").matches;
    let keyboardOpen = false;
    const measure = () => {
      frame = 0;
      const height = viewport?.height ?? window.innerHeight;
      const width = window.innerWidth;
      const editable = shell.contains(document.activeElement) && document.activeElement?.matches("input, textarea, [contenteditable='plaintext-only'], [contenteditable='true']");
      // Keep physical orientation stable when Android resizes its layout viewport for the keyboard.
      const rotated = Math.abs(width - previousWidth) > 80;
      if (rotated && (keyboardOpen || editable)) {
        baselineHeight = Math.max(window.innerHeight, previousWidth);
      }
      if (!editable && !keyboardOpen) baselineHeight = Math.max(window.innerHeight, height);
      const nextKeyboardOpen = Boolean((editable || keyboardOpen) && baselineHeight - height > 120 && (window.matchMedia("(any-pointer: coarse)").matches || window.innerHeight - height > 120));
      if (rotated && keyboardOpen) landscape = width > previousWidth;
      else if (!keyboardOpen && !nextKeyboardOpen) landscape = window.matchMedia("(orientation: landscape)").matches;
      previousWidth = width;
      keyboardOpen = nextKeyboardOpen;
      const desktopPointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia("(any-pointer: coarse)").matches;
      const mode = workspaceLayoutMode(node.clientWidth, width, landscape, desktopPointer);
      node.dataset.layout = mode;
      shell.dataset.chatView = String(mode === "toggle" && node.dataset.view === "chat");
      shell.dataset.keyboardOpen = String(keyboardOpen);
      // Fixed shell uses visual, not layout, viewport bounds; iPad Safari may pan offsetTop.
      shell.style.setProperty("--workspace-visible-height", `${height}px`);
      shell.style.setProperty("--workspace-visible-top", `${viewport?.offsetTop ?? 0}px`);
      applyRatio(ratioRef.current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const focus = () => {
      if (!keyboardOpen) baselineHeight = Math.max(window.innerHeight, viewport?.height ?? 0);
      schedule();
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(node);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    shell.addEventListener("focusin", focus);
    shell.addEventListener("focusout", schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      shell.removeEventListener("focusin", focus);
      shell.removeEventListener("focusout", schedule);
    };
  }, [applyRatio]);

  useEffect(() => {
    const node = root.current;
    const shell = node?.closest<HTMLElement>(".workspace-shell");
    if (shell && node) shell.dataset.chatView = String(node.dataset.layout === "toggle" && view === "chat");
  }, [view]);

  useEffect(() => () => cancelAnimationFrame(dragFrame.current), []);
  const commit = (value: number) => {
    ratioRef.current = applyRatio(value);
    onRatioChange(ratioRef.current);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    cancelAnimationFrame(dragFrame.current);
    dragFrame.current = 0;
    drag.current = null;
    if (root.current) delete root.current.dataset.resizing;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    commit(ratioRef.current);
    if (event.type === "pointerup" && event.pointerType !== "mouse" && !current.moved) {
      const previous = tap.current;
      const now = performance.now();
      if (previous && now - previous.time < 350 && Math.abs(event.clientX - previous.x) < 24) {
        commit(DEFAULT_PANEL_RATIO);
        tap.current = null;
      } else tap.current = { time: now, x: event.clientX };
    }
  };
  const keyResize = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault();
    commit(event.key === "Home" ? DEFAULT_PANEL_RATIO : ratioRef.current + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 2));
  };
  return <section ref={root} className="workspace-panels" data-layout="toggle" data-view={view}>
    <div className="workspace-view-switch" role="group" aria-label={t("workspace.panelView")}>
      <button type="button" aria-pressed={view === "information"} aria-controls={`${id}-information`} onClick={() => onViewChange("information")}>{t("workspace.informationView")}</button>
      <button type="button" aria-pressed={view === "chat"} aria-controls={`${id}-chat`} onClick={() => onViewChange("chat")}>{t("workspace.chatView")}</button>
    </div>
    <div className="workspace-panel-body">
      <div id={`${id}-information`} className="workspace-information" role="region" aria-label={t("workspace.informationView")}>{panels.slice(0, -1)}</div>
      <div ref={divider} className="workspace-divider" role="separator" tabIndex={0} aria-orientation="vertical"
        aria-label={t("workspace.resizePanels")} aria-controls={`${id}-information ${id}-chat`}
        aria-valuemin={35} aria-valuemax={70} aria-valuenow={Math.round(ratio)} title={t("workspace.resizeHelp")}
        onKeyDown={keyResize} onDoubleClick={() => commit(DEFAULT_PANEL_RATIO)}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, moved: false };
          if (root.current) root.current.dataset.resizing = "true";
        }}
        onPointerMove={(event) => {
          if (!drag.current || drag.current.id !== event.pointerId || !root.current) return;
          if (Math.abs(event.clientX - drag.current.x) < 3 && !drag.current.moved) return;
          drag.current.moved = true;
          const bounds = root.current.getBoundingClientRect();
          const limits = panelRatioBounds(bounds.width);
          ratioRef.current = Math.max(limits.min, Math.min(limits.max, (event.clientX - bounds.left - PANEL_DIVIDER_WIDTH / 2) / (bounds.width - PANEL_DIVIDER_WIDTH) * 100));
          if (!dragFrame.current) dragFrame.current = requestAnimationFrame(() => { dragFrame.current = 0; applyRatio(ratioRef.current); });
        }}
        onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
        <span aria-hidden="true" />
      </div>
      <div id={`${id}-chat`} className="workspace-chat-slot" role="region" aria-label={t("workspace.chatView")}>{panels[panels.length - 1]}</div>
    </div>
  </section>;
}
