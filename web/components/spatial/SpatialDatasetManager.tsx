import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../lib/auth";
import { projectRequest } from "../../lib/membership/client";
import { DATASET_TYPES, datasetTypeLabels, MAX_DATASET_BYTES, type DatasetType, type SpatialDataset } from "../../lib/spatial/datasets";

export default function SpatialDatasetManager({ projectId }: { projectId: string }) {
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
    }).catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "목록을 불러오지 못했어요."); })
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
        if (!selected || !selected.size || selected.size > MAX_DATASET_BYTES) throw new Error("비어 있지 않은 3MB 이하 파일을 선택해주세요.");
        if (!/\.(geojson|json|csv)$/i.test(selected.name)) throw new Error("GeoJSON, JSON, CSV 파일만 업로드할 수 있습니다.");
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
      setMessage(action === "delete" ? "공간정보를 삭제했습니다." : !stored?.geometryType ? "파일을 보관했습니다. 좌표가 없는 CSV는 지도와 공간 계산에 사용할 수 없습니다." : action === "replace" ? "파일을 교체했습니다. 공간 분석을 다시 열어 새 자료를 확인해주세요." : "공간정보를 업로드했습니다. 공간 분석에서 사용할 수 있습니다.");
    } catch (error) { if (uidRef.current === uid) setMessage(error instanceof Error ? error.message : "공간정보를 저장하지 못했어요."); }
    finally { if (uidRef.current === uid) { lock.current = false; setBusy(false); } }
  }
  if (!loading && !canManage) return null;
  return <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-label="공간정보">
    <h3 className="text-lg font-semibold">공간정보</h3>
    <p className="mt-2 text-sm text-slate-500">이 사업의 공간 자료를 등록하고 자료 분석에서 활용하세요. 배경 문서와 별도로 보관합니다.</p>
    {loading && <p className="mt-3 text-sm text-slate-500" role="status">공간정보를 불러오는 중입니다.</p>}
    {canManage && <form className="mt-4 grid gap-3" onSubmit={(event) => { event.preventDefault(); void mutate("upload"); }}>
      <label className="grid gap-1 text-sm">자료 이름<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className="rounded-xl border border-slate-200 px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">자료 유형<select aria-label="자료 유형" value={type} onChange={(e) => setType(e.target.value as DatasetType)} disabled={busy} className="rounded-xl border border-slate-200 px-3 py-2">{DATASET_TYPES.map((t) => <option key={t} value={t}>{datasetTypeLabels[t]}</option>)}</select></label>
      <label className="grid gap-1 text-sm">공간정보 파일<input ref={fileInput} required type="file" accept=".geojson,.json,.csv" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="min-w-0 max-w-full text-sm" /></label>
      <p className="text-xs leading-relaxed text-slate-500">GeoJSON·JSON·CSV, 파일당 최대 3MB. GeoJSON과 JSON은 EPSG:4326 좌표를 사용해주세요. CSV의 경도·위도 열(longitude/latitude, lon/lat, lng/lat, 경도/위도)은 점으로 표시합니다. 좌표 없는 CSV는 보관만 가능합니다.</p>
      <button type="submit" disabled={busy || !file || !name.trim()} className="justify-self-start rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "처리 중…" : "공간정보 업로드"}</button>
    </form>}
    {!loading && !datasets.length && <p className="mt-4 text-sm text-slate-500">등록된 공간정보가 없습니다.</p>}
    <div className="mt-4 space-y-3">{datasets.map((dataset) => <article key={dataset.datasetId} className="min-w-0 rounded-2xl border border-slate-200 p-4">
      <h4 className="break-words font-semibold">{dataset.name}</h4>
      <p className="mt-1 text-sm text-slate-500">{datasetTypeLabels[dataset.type]}</p>
      <p className="mt-1 break-all text-sm text-slate-600">{dataset.fileName}</p>
      {!dataset.geometryType && <p className="mt-2 text-xs text-amber-700">좌표 없음 · 지도와 공간 계산에는 사용할 수 없습니다.</p>}
      {canManage && <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className={`rounded-full border border-slate-200 px-3 py-1 text-sm ${busy ? "opacity-50" : "cursor-pointer"}`}>
          파일 교체<input type="file" accept=".geojson,.json,.csv" aria-label={`${dataset.name} 파일 교체`} disabled={busy} className="sr-only" onChange={(e) => { const next = e.target.files?.[0]; e.target.value = ""; if (next) void mutate("replace", next, dataset); }} />
        </label>
        <button type="button" disabled={busy} aria-label={`${dataset.name} 삭제`} className="rounded-full border border-red-200 px-3 py-1 text-sm text-red-600 disabled:opacity-50" onClick={() => { if (window.confirm(`‘${dataset.name}’ 공간정보를 삭제할까요?`)) void mutate("delete", undefined, dataset); }}>삭제</button>
      </div>}
    </article>)}</div>
    {message && <p role="status" className="mt-4 text-sm text-slate-700">{message}</p>}
  </section>;
}
