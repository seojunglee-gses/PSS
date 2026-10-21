import { useI18n } from "../../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../lib/auth";
import { projectRequest } from "../../lib/membership/client";
import { DATASET_TYPES, MAX_DATASET_BYTES, type DatasetType, type SpatialDataset } from "../../lib/spatial/datasets";

export default function SpatialDatasetManager({ projectId }: { projectId: string }) {
  const { t, localize } = useI18n();
  const { user } = useAuth();
  const [datasets, setDatasets] = useState<SpatialDataset[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<DatasetType>("project_boundary");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uidRef = useRef(user?.uid); uidRef.current = user?.uid;
  const path = `/api/projects/spatial-datasets?${new URLSearchParams({ projectId })}`;
  useEffect(() => {
    let cancelled = false;
    setDatasets([]); setCanManage(false); setLoading(true);
    if (!user) { setLoading(false); return; }
    projectRequest(user, path).then((data) => {
      if (!cancelled) { setDatasets(data.datasets); setCanManage(data.canManage === true); }
    }).catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "dataset.loadFailed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, path]);

  async function mutate(action: "upload" | "replace" | "delete", replacement?: File, dataset?: SpatialDataset) {
    if (!user || !canManage || lock.current) return;
    const uid = user.uid;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const selected = replacement ?? file;
      const body: Record<string, unknown> = { action, projectId, ...(dataset ? { datasetId: dataset.datasetId, expectedRevisionId: dataset.revisionId } : {}) };
      if (action !== "delete") {
        if (!selected || !selected.size || selected.size > MAX_DATASET_BYTES) throw new Error(t("dataset.fileSize"));
        if (!/\.(geojson|json|csv)$/i.test(selected.name)) throw new Error(t("dataset.fileType"));
        const bytes = new Uint8Array(await selected.arrayBuffer());
        let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        Object.assign(body, { name: dataset?.name ?? name, type: dataset?.type ?? type, fileName: selected.name, data: btoa(binary) });
      }
      const result = await projectRequest(user, "/api/projects/spatial-datasets", body);
      const data = await projectRequest(user, path);
      if (uidRef.current !== uid) return;
      setDatasets(data.datasets); setCanManage(data.canManage === true);
      if (action === "upload") { setName(""); setFile(null); if (fileInput.current) fileInput.current.value = ""; }
      const stored = (data.datasets as SpatialDataset[]).find((d) => d.datasetId === result.datasetId);
      setMessage(action === "delete" ? t("dataset.deleted") : !stored?.geometryType ? t("dataset.archived") : action === "replace" ? t("dataset.replaced") : t("dataset.uploaded"));
    } catch (error) { if (uidRef.current === uid) setMessage(error instanceof Error ? error.message : t("dataset.saveFailed")); }
    finally { if (uidRef.current === uid) { lock.current = false; setBusy(false); } }
  }
  if (!loading && !canManage) return null;
  return <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-label={t("dataset.title")}>
    <h3 className="text-lg font-semibold">{t("dataset.title")}</h3>
    <p className="mt-2 text-sm text-slate-500">{t("dataset.hint")}</p>
    {loading && <p className="mt-3 text-sm text-slate-500" role="status">{t("dataset.loading")}</p>}
    {canManage && <form className="mt-4 grid gap-3" onSubmit={(event) => { event.preventDefault(); void mutate("upload"); }}>
      <label className="grid gap-1 text-sm">{t("dataset.name")}<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className="rounded-xl border border-slate-200 px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">{t("dataset.type")}<select aria-label={t("dataset.type")} value={type} onChange={(e) => setType(e.target.value as DatasetType)} disabled={busy} className="rounded-xl border border-slate-200 px-3 py-2">{DATASET_TYPES.map((kind) => <option key={kind} value={kind}>{t(`dataset.${kind}`)}</option>)}</select></label>
      <label className="grid gap-1 text-sm">{t("dataset.file")}<input ref={fileInput} required type="file" accept=".geojson,.json,.csv" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="min-w-0 max-w-full text-sm" /></label>
      <p className="text-xs leading-relaxed text-slate-500">{t("dataset.formatHint")}</p>
      <button type="submit" disabled={busy || !file || !name.trim()} className="justify-self-start rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? t("dataset.busy") : t("dataset.upload")}</button>
    </form>}
    {!loading && !datasets.length && <p className="mt-4 text-sm text-slate-500">{t("dataset.empty")}</p>}
    <div className="mt-4 space-y-3">{datasets.map((dataset) => <article key={dataset.datasetId} className="min-w-0 rounded-2xl border border-slate-200 p-4">
      <h4 className="break-words font-semibold">{dataset.name}</h4>
      <p className="mt-1 text-sm text-slate-500">{t(`dataset.${dataset.type}`)}</p>
      <p className="mt-1 break-all text-sm text-slate-600">{dataset.fileName}</p>
      {!dataset.geometryType && <p className="mt-2 text-xs text-amber-700">{t("dataset.noCoordinates")}</p>}
      {canManage && <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className={`rounded-full border border-slate-200 px-3 py-1 text-sm ${busy ? "opacity-50" : "cursor-pointer"}`}>
          {t("dataset.replace")}<input type="file" accept=".geojson,.json,.csv" aria-label={t("dataset.replaceNamed", { name: dataset.name })} disabled={busy} className="sr-only" onChange={(e) => { const next = e.target.files?.[0]; e.target.value = ""; if (next) void mutate("replace", next, dataset); }} />
        </label>
        <button type="button" disabled={busy} aria-label={t("cases.deleteNamed", { name: dataset.name })} className="rounded-full border border-red-200 px-3 py-1 text-sm text-red-600 disabled:opacity-50" onClick={() => { if (window.confirm(t("dataset.deleteConfirm", { name: dataset.name }))) void mutate("delete", undefined, dataset); }}>{t("common.delete")}</button>
      </div>}
    </article>)}</div>
    {message && <p role="status" className="mt-4 text-sm text-slate-700">{localize(message, "dataset.saveFailed")}</p>}
  </section>;
}
