import ProjectBoundarySettings from "./ProjectBoundarySettings";
import SpatialMap from "./SpatialMap";
import { spatialSettings, type SpatialSettings } from "../../lib/spatial/boundary";
import { useI18n } from "../../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../lib/auth";
import { projectRequest } from "../../lib/membership/client";
import { DATASET_TYPES, MAX_DATASET_BYTES, type DatasetType, type SpatialDataset } from "../../lib/spatial/datasets";
import type { UploadAnalysis } from "../../lib/spatial/upload-analysis";
import type { LoadedLayer } from "../../lib/spatial/types";

export default function SpatialDatasetManager({ projectId }: { projectId: string }) {
  const { t, localize } = useI18n(), { user } = useAuth();
  const [datasets, setDatasets] = useState<SpatialDataset[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [settings, setSettings] = useState<SpatialSettings>(spatialSettings(undefined));
  const [open, setOpen] = useState(false), [sourceCrs, setSourceCrs] = useState("");
  const [name, setName] = useState(""), [type, setType] = useState<DatasetType | "">("");
  const [replacement, setReplacement] = useState<SpatialDataset | null>(null);
  const [file, setFile] = useState<File | null>(null), [encoded, setEncoded] = useState("");
  const [analysis, setAnalysis] = useState<UploadAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const lock = useRef(false), version = useRef(0), automaticName = useRef("");
  const fileInput = useRef<HTMLInputElement>(null);
  const scope = `${projectId}/${user?.uid ?? ""}`, scopeRef = useRef(scope); scopeRef.current = scope;
  const path = `/api/projects/spatial-datasets?${new URLSearchParams({ projectId })}`;
  useEffect(() => {
    let cancelled = false;
    const invalidateAnalysis = () => { version.current++; };
    version.current++; lock.current = false;
    setDatasets([]); setCanManage(false); setLoading(true); setOpen(false); setFile(null); setAnalysis(null); setEncoded(""); setAnalyzing(false); setBusy(false); setMessage("");
    if (!user) { setLoading(false); return; }
    projectRequest(user, path).then(data => {
      if (!cancelled) { setDatasets(data.datasets); setSettings(spatialSettings(data.spatialSettings)); setCanManage(data.canManage === true); }
    }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : "dataset.loadFailed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; invalidateAnalysis(); };
  }, [user, path]);

  async function refresh() {
    if (!user) return;
    const requestScope = scope;
    const data = await projectRequest(user, path);
    if (scopeRef.current !== requestScope) return;
    setDatasets(data.datasets); setSettings(spatialSettings(data.spatialSettings)); setCanManage(data.canManage === true);
  }
  function begin(kind: DatasetType | "", dataset: SpatialDataset | null = null) {
    version.current++; setOpen(true); setFile(null); setEncoded(""); setAnalysis(null); setAnalyzing(false); setSourceCrs(""); setMessage("");
    setReplacement(dataset); setType(dataset?.type ?? kind); setName(dataset?.name ?? (kind ? t(`dataset.${kind}`) : ""));
    automaticName.current = kind ? t(`dataset.${kind}`) : "";
    if (fileInput.current) fileInput.current.value = "";
    fileInput.current?.click();
  }
  async function inspect(selected: File | null, crs = "") {
    const attempt = ++version.current, requestScope = scope;
    setFile(selected); setAnalysis(null); setEncoded(""); setSourceCrs(crs); setMessage("");
    if (!selected || !user) { setAnalyzing(false); return; }
    setAnalyzing(true);
    try {
      if (!selected.size || selected.size > MAX_DATASET_BYTES) throw new Error("dataset.fileSize");
      if (!/\.(geojson|json|csv|zip)$/i.test(selected.name)) throw new Error("dataset.fileType");
      const bytes = new Uint8Array(await selected.arrayBuffer());
      let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const data = btoa(binary);
      const result = await projectRequest(user, "/api/projects/spatial-datasets", { action: "inspect", projectId, fileName: selected.name, data, ...(crs ? { sourceCrs: crs } : {}) });
      if (version.current !== attempt || scopeRef.current !== requestScope) return;
      setAnalysis(result.analysis); setEncoded(data);
    } catch (error) { if (version.current === attempt && scopeRef.current === requestScope) setMessage(error instanceof Error ? error.message : "upload.invalidFile"); }
    finally { if (version.current === attempt && scopeRef.current === requestScope) setAnalyzing(false); }
  }
  async function mutate(action: "upload" | "replace" | "delete", dataset?: SpatialDataset) {
    if (!user || !canManage || lock.current) return;
    const boundaryChange = action !== "delete" && type === "project_boundary" && !!settings.activeBoundaryDatasetId;
    if (boundaryChange && !window.confirm(t("boundary.confirmChange"))) return;
    const requestScope = scope;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const body: Record<string, unknown> = { action, projectId, confirmBoundaryChange: true, ...(dataset ? { datasetId: dataset.datasetId, expectedRevisionId: dataset.revisionId } : {}) };
      if (action !== "delete") {
        if (!file || !analysis || analysis.needsCrs || !type || !encoded) return;
        Object.assign(body, { name, type, fileName: file.name, data: encoded, ...(sourceCrs ? { sourceCrs } : {}), ...(type === "project_boundary" ? { activateBoundary: true, expectedBoundaryId: settings.activeBoundaryDatasetId } : {}) });
      }
      await projectRequest(user, "/api/projects/spatial-datasets", body);
      if (scopeRef.current !== requestScope) return;
      await refresh();
      if (action !== "delete") { setOpen(false); setFile(null); setAnalysis(null); setEncoded(""); }
      setMessage(action === "delete" ? "dataset.deleted" : !analysis?.geometryType ? "dataset.archived" : action === "replace" ? "dataset.replaced" : "dataset.uploaded");
    } catch (error) { if (scopeRef.current === requestScope) setMessage(error instanceof Error ? error.message : "dataset.saveFailed"); }
    finally { if (scopeRef.current === requestScope) { lock.current = false; setBusy(false); } }
  }
  const preview: LoadedLayer | null = analysis?.data && analysis.geometryType ? {
    config: { id: "upload-preview", label: name || file?.name || t("dataset.file"), type: analysis.geometryType, source: "", color: "#2563eb" }, data: analysis.data,
  } : null;
  function compatible(kind: DatasetType) {
    if (!analysis) return true;
    if (["project_boundary", "buildings", "parcels", "green"].includes(kind)) return analysis.geometryType === "polygon";
    if (kind === "roads") return analysis.geometryType === "line";
    return kind !== "population" || analysis.geometryType !== "line";
  }
  const active = datasets.find(d => d.datasetId === settings.activeBoundaryDatasetId);
  if (!loading && !canManage) return null;
  return <section className="rounded-3xl border border-[var(--border)] bg-white p-4 shadow-sm sm:p-6" aria-label={t("setting.spatialSettings")}>
    <h3 className="text-lg font-semibold">{t("setting.spatialSettings")}</h3>
    <p className="mt-2 text-sm text-slate-500">{t("upload.intro")}</p>
    {loading && <p className="mt-3 text-sm text-slate-500" role="status">{t("dataset.loading")}</p>}
    {canManage && <>
      <ProjectBoundarySettings projectId={projectId} datasets={datasets} settings={settings} disabled={busy || analyzing} onSaved={refresh} onChooseFile={() => begin("project_boundary", active ?? null)} onDelete={() => { if (active && window.confirm(t("boundary.deleteActive"))) void mutate("delete", active); }} />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">{t("upload.materials")}</h4><button type="button" className="spatial-button" disabled={busy || analyzing} onClick={() => begin("")}>{t("upload.add")}</button></div>
      <input ref={fileInput} type="file" accept=".geojson,.json,.csv,.zip" aria-label={t("dataset.file")} disabled={busy || analyzing} className="sr-only" onChange={e => void inspect(e.target.files?.[0] ?? null)} />
      {open && <form aria-label={t("upload.form")} className="mt-4 min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-blue-50/30 p-4" onSubmit={event => { event.preventDefault(); void mutate(replacement ? "replace" : "upload", replacement ?? undefined); }}>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{t("upload.flow")}</p><button type="button" className="spatial-button" disabled={busy || analyzing} onClick={() => { if (fileInput.current) { fileInput.current.value = ""; fileInput.current.click(); } }}>{t("upload.chooseFile")}</button></div>
        <p className="text-xs text-slate-500">{t("upload.formats")}</p>
        {analyzing && <p role="status" className="text-sm">{t("upload.analyzing")}</p>}
        {analysis?.needsCrs && <label className="grid gap-2 text-sm">{t("upload.manualHint")}<span>{t("upload.manualCrs")}</span><select aria-label={t("upload.manualCrs")} value={sourceCrs} disabled={busy || analyzing} onChange={e => void inspect(file, e.target.value)} className="min-h-11 w-full rounded-lg border p-2"><option value="">{t("boundary.selectCrs")}</option>{["EPSG:4326", "EPSG:3857", "EPSG:5179", "EPSG:5186"].map(crs => <option key={crs}>{crs}</option>)}</select></label>}
        {analysis && !analysis.needsCrs && <>
          <div role="status" className="space-y-1 text-sm"><p className="font-semibold">{t("upload.checked")}</p><p className="break-all">{file?.name}</p><p>{t("upload.count", { count: analysis.featureCount })} · {analysis.geometryType ? t(`upload.geometry.${analysis.geometryType}`) : t("dataset.noCoordinates")}</p><p>{t("upload.crs")}: {analysis.sourceCrs?.startsWith("EPSG:") ? analysis.sourceCrs : analysis.sourceCrs ? t("upload.prjCrs") : t("upload.noCrs")}{analysis.sourceCrs && analysis.sourceCrs !== "EPSG:4326" ? " → EPSG:4326" : ""}</p></div>
          {preview && <SpatialMap key={version.current} layers={[preview]} visible={[preview.config.id]} overlay={{ type: "FeatureCollection", features: [] }} extent={analysis.extent ?? undefined} onSelect={() => {}} />}
          {analysis.extent && <p className="text-xs text-slate-500">{t("upload.location", { lon: ((analysis.extent[0] + analysis.extent[2]) / 2).toFixed(5), lat: ((analysis.extent[1] + analysis.extent[3]) / 2).toFixed(5) })}</p>}
          {!analysis.data && <p className="text-sm text-amber-700">{t("dataset.archived")}</p>}
          <label className="grid gap-1 text-sm font-semibold">{t("upload.whichType")}<select required aria-label={t("dataset.type")} value={type} disabled={busy || !!replacement} onChange={e => { const next = e.target.value as DatasetType; setType(next); const suggested = next ? t(`dataset.${next}`) : ""; if (!name || name === automaticName.current) setName(suggested); automaticName.current = suggested; }} className="min-h-11 w-full rounded-lg border bg-white p-2 font-normal"><option value="">{t("upload.chooseType")}</option>{DATASET_TYPES.map(kind => <option key={kind} value={kind} disabled={!compatible(kind)}>{t(`dataset.${kind}`)}</option>)}</select></label>
          {!!type && !compatible(type) && <p role="alert" className="text-sm text-rose-700">{t("upload.typeMismatch")}</p>}
          <label className="grid gap-1 text-sm">{t("dataset.name")}<input required maxLength={100} value={name} disabled={busy} onChange={e => setName(e.target.value)} className="min-h-11 w-full rounded-lg border p-2" /></label>
        </>}
        <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || analyzing || !analysis || analysis.needsCrs || !type || !compatible(type) || !name.trim()} className="spatial-button bg-[var(--primary)] text-white disabled:opacity-50">{busy ? t("dataset.busy") : t("workspace.save")}</button><button type="button" className="spatial-button" disabled={busy} onClick={() => { version.current++; setOpen(false); setAnalysis(null); setFile(null); setAnalyzing(false); }}>{t("workspace.cancel")}</button></div>
      </form>}
    </>}
    {!loading && !datasets.some(d => d.datasetId !== settings.activeBoundaryDatasetId) && <p className="mt-4 text-sm text-slate-500">{t("dataset.empty")}</p>}
    <div className="spatial-dataset-grid mt-4 grid gap-3">{datasets.filter(d => d.datasetId !== settings.activeBoundaryDatasetId).map(dataset => <article key={dataset.datasetId} className="min-w-0 rounded-2xl border border-slate-200 p-3">
      <h4 className="truncate text-sm font-semibold" title={dataset.name}>{dataset.name}</h4><p className="mt-1 text-sm text-slate-500">{t(`dataset.${dataset.type}`)}</p><p className="mt-1 truncate text-xs text-slate-600" title={dataset.fileName}>{dataset.fileName}</p>
      {!dataset.geometryType && <p className="mt-2 text-xs text-amber-700">{t("dataset.noCoordinates")}</p>}
      {canManage && <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="spatial-button" disabled={busy || analyzing} aria-label={t("dataset.replaceNamed", { name: dataset.name })} onClick={() => begin(dataset.type, dataset)}>{t("dataset.replace")}</button><button type="button" disabled={busy || analyzing} className="spatial-button text-red-600" aria-label={t("cases.deleteNamed", { name: dataset.name })} onClick={() => { if (window.confirm(t("dataset.deleteConfirm", { name: dataset.name }))) void mutate("delete", dataset); }}>{t("common.delete")}</button></div>}
    </article>)}</div>
    {message && <p role="status" className="mt-4 text-sm text-slate-700">{localize(message, "dataset.saveFailed")}</p>}
  </section>;
}
