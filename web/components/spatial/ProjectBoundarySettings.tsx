import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import { projectRequest } from "../../lib/membership/client";
import { datasetLayer, type SpatialDataset } from "../../lib/spatial/datasets";
import { loadLayer } from "../../lib/spatial/loader";
import { boundaryGeoJSON, deriveBoundary, type SpatialSettings } from "../../lib/spatial/boundary";
import type { LoadedLayer } from "../../lib/spatial/types";
import SpatialMap from "./SpatialMap";

export default function ProjectBoundarySettings({ projectId, datasets, settings, onSaved, onChooseFile, onDelete, disabled }: {
  projectId: string; datasets: SpatialDataset[]; settings: SpatialSettings;
  onSaved: () => Promise<void>; onChooseFile: () => void; onDelete: () => void; disabled: boolean;
}) {
  const { t, localize } = useI18n(), { user } = useAuth();
  const [id, setId] = useState(settings.activeBoundaryDatasetId ?? "");
  const [meters, setMeters] = useState<number>(settings.defaultNearbyMeters);
  const [preview, setPreview] = useState<LoadedLayer | null>(null), [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const active = datasets.find(d => d.datasetId === settings.activeBoundaryDatasetId);
  const dataset = datasets.find(d => d.datasetId === id);
  const scopeRef = useRef(projectId); scopeRef.current = projectId;
  useEffect(() => { setId(settings.activeBoundaryDatasetId ?? ""); setMeters(settings.defaultNearbyMeters); }, [projectId, settings.activeBoundaryDatasetId, settings.defaultNearbyMeters]);
  useEffect(() => { setError(""); }, [projectId, user?.uid]);
  useEffect(() => {
    let cancelled = false;
    setPreview(null); setPreviewError("");
    if (!user || !dataset) { setLoading(false); return; }
    const config = datasetLayer(dataset);
    if (!config) return;
    setLoading(true);
    user.getIdToken().then(token => loadLayer(config, token)).then(layer => {
      deriveBoundary(boundaryGeoJSON(layer.data));
      if (!cancelled) setPreview(layer);
    }).catch(e => { if (!cancelled) setPreviewError(e instanceof Error ? e.message : "boundary.invalid"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, user, dataset]);
  let derived;
  try { if (preview) derived = deriveBoundary(boundaryGeoJSON(preview.data)); } catch { /* A failed geometry is reported by the loading effect. */ }
  async function save() {
    if (!user || busy || disabled || loading || dataset && !preview) return;
    if (settings.activeBoundaryDatasetId !== (id || null) && settings.activeBoundaryDatasetId && !window.confirm(t("boundary.confirmChange"))) return;
    const requestProject = projectId;
    setBusy(true); setError("");
    try {
      await projectRequest(user, "/api/projects/spatial-datasets", { action: "boundary-settings", projectId, activeBoundaryDatasetId: id || null, defaultNearbyMeters: meters, expectedBoundaryId: settings.activeBoundaryDatasetId, ...(dataset ? { expectedBoundaryRevisionId: dataset.revisionId } : {}), confirmBoundaryChange: true, ...(dataset && !dataset.sourceCrs ? { sourceCrs: "EPSG:4326" } : {}) });
      if (scopeRef.current !== requestProject) return;
      await onSaved(); setError("boundary.saved");
    } catch (e) { if (scopeRef.current === requestProject) setError(e instanceof Error ? e.message : "dataset.saveFailed"); }
    finally { if (scopeRef.current === requestProject) setBusy(false); }
  }
  return <section className="mt-5 min-w-0 space-y-3 border-b border-slate-200 pb-5" aria-label={t("upload.boundary")}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">{t("upload.boundary")}</h4><button type="button" className="spatial-button" disabled={disabled || busy} onClick={onChooseFile}>{t(active ? "upload.changeBoundary" : "upload.addBoundary")}</button></div>
    <p className="break-words text-sm text-slate-600">{active ? t("upload.boundaryRegistered", { name: active.name }) : t("upload.boundaryEmpty")}</p>
    {loading && <p role="status" className="text-sm text-slate-500">{t("dataset.loading")}</p>}
    {preview && <><SpatialMap layers={[preview]} visible={[preview.config.id]} overlay={{ type: "FeatureCollection", features: [] }} extent={derived?.bbox} onSelect={() => {}} /><p className="break-all text-xs text-slate-500">{dataset?.fileName}</p></>}
    <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold">{t("upload.analysisSettings")}</summary><div className="mt-3 space-y-3">
      <label className="grid gap-1 text-sm">{t("boundary.defaultDistance")}<select aria-label={t("boundary.defaultDistance")} className="min-h-11 w-full rounded-lg border p-2" disabled={busy || disabled} value={meters} onChange={e => setMeters(Number(e.target.value))}>{[0, 500, 1000].map(n => <option key={n} value={n}>{t(`boundary.scope.${n}`)}</option>)}</select></label>
      {datasets.some(d => d.type === "project_boundary") && <label className="grid gap-1 text-sm">{t("upload.existingBoundary")}<select aria-label={t("upload.existingBoundary")} className="min-h-11 w-full rounded-lg border p-2" disabled={busy || disabled} value={id} onChange={e => setId(e.target.value)}><option value="">{t("boundary.none")}</option>{datasets.filter(d => d.type === "project_boundary").map(d => <option key={d.datasetId} value={d.datasetId}>{d.name}</option>)}</select></label>}
      <div className="flex flex-wrap gap-3"><button className="spatial-button" type="button" disabled={busy || disabled || loading || !!dataset && !preview} onClick={() => void save()}>{t("workspace.save")}</button>{active && <button className="spatial-button text-red-600" type="button" disabled={busy || disabled} onClick={onDelete}>{t("upload.deleteBoundary")}</button>}</div>
    </div></details>
    {(error || previewError) && <p role="status" className="text-sm text-slate-700">{localize(error || previewError, "dataset.saveFailed")}</p>}
  </section>;
}
