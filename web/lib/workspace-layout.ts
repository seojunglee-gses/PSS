export const DEFAULT_PANEL_RATIO = 60;
export const PANEL_DIVIDER_WIDTH = 44;
export type WorkspacePanelView = "information" | "chat";

export function workspaceLayoutMode(availableWidth: number, viewportWidth: number, landscape: boolean, finePointer: boolean) {
  return availableWidth >= 640 && ((viewportWidth >= 960 && landscape) || (viewportWidth >= 1280 && finePointer)) ? "split" : "toggle";
}

export function panelRatioBounds(width: number) {
  const available = Math.max(1, width - PANEL_DIVIDER_WIDTH);
  return { min: Math.max(35, 280 / available * 100), max: Math.min(70, 100 - 300 / available * 100) };
}

export function constrainPanelRatio(ratio: number, width: number) {
  const { min, max } = panelRatioBounds(width);
  const value = Number.isFinite(ratio) ? ratio : DEFAULT_PANEL_RATIO;
  return min <= max ? Math.min(max, Math.max(min, value)) : DEFAULT_PANEL_RATIO;
}

// visualViewport dimensions shrink during browser zoom as well as keyboard use.
// Only the keyboard should resize the workspace's layout in CSS pixels.
export function workspaceViewportMetrics(viewport: {height:number;offsetTop:number;scale:number} | null, fallbackHeight:number) {
  const scale = viewport && Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
  return { height: viewport ? viewport.height * scale : fallbackHeight, top: viewport && Math.abs(scale - 1) < 0.01 ? viewport.offsetTop : 0 };
}
