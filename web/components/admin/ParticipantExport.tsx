import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { useI18n } from "../../lib/i18n";
import { exportFileName, participantExportFiles, type ExportFiles } from "../../lib/participant-export";
import type { ParticipantExport as ExportData } from "../../lib/participant-export-server";

type Participant = { userId: string; participantId: string };
const LIMIT = 150 * 1024 * 1024;
export default function ParticipantExport({ projectId, user }: { projectId: string; user: Pick<User, "uid" | "getIdToken"> }) {
  const { t } = useI18n();
  const [participants, setParticipants] = useState<Participant[]>([]), [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [progress, setProgress] = useState("");
  const operation = useRef<AbortController | null>(null);
  const request = async (parameters: Record<string, string>, signal: AbortSignal) => {
    const token = await user.getIdToken();
    return fetch(`/api/admin/participant-export?${new URLSearchParams({ projectId, ...parameters })}`, { headers: { Authorization: `Bearer ${token}` }, signal, cache: "no-store" });
  };
  useEffect(() => {
    const controller = new AbortController();
    void request({}, controller.signal).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!controller.signal.aborted) setParticipants(data.participants);
    }).catch(() => { if (!controller.signal.aborted) setNotice("setting.exportLoadFailed"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); operation.current?.abort(); };
    // The settings parent remounts this component for each project/account scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, user.uid]);
  const download = async () => {
    if (operation.current || !participants.length) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setNotice("");
    const timeout = setTimeout(() => controller.abort("timeout"), 10 * 60_000);
    try {
      const files: ExportFiles = {}, targets = selected ? participants.filter(row => row.userId === selected) : participants;
      let total = 0, failedImages = 0;
      const add = (path: string, content: Uint8Array) => {
        total += content.byteLength;
        if (total > LIMIT) throw new Error("setting.exportTooLarge");
        files[path] = content;
      };
      for (let i = 0; i < targets.length; i++) {
        if (controller.signal.aborted) return;
        setProgress(t("setting.exportProgress", { current: i + 1, total: targets.length }));
        const response = await request({ userId: targets[i].userId }, controller.signal);
        if (!response.ok) throw new Error("setting.exportFailed");
        const data: ExportData = await response.json();
        const folder = `${String(i + 1).padStart(3, "0")}-${exportFileName(data.participantId)}`;
        for (const [path, content] of Object.entries(participantExportFiles(data))) add(`${folder}/${path}`, content);
        const downloads = [];
        for (let j = 0; j < data.generatedImages.length; j++) {
          const image = data.generatedImages[j], base = `images/${String(j + 1).padStart(3, "0")}-${exportFileName(image.id)}`;
          try {
            const res = await request({ userId: data.userId, imageId: image.id }, controller.signal);
            if (!res.ok) {
              if ([401, 403].includes(res.status)) throw new Error("setting.exportFailed");
              failedImages++; downloads.push({ documentId: image.id, status: "unavailable", httpStatus: res.status }); continue;
            }
            const raw = new Uint8Array(await res.arrayBuffer());
            const extension = res.headers.get("X-PPSS-Image-Extension") ?? /\.(png|jpe?g|webp|gif)(?:\?|$)/i.exec(String(image.data.storagePath ?? ""))?.[1] ?? "image";
            const path = `${base}.${extension}`;
            add(`${folder}/${path}`, raw); downloads.push({ documentId: image.id, status: "downloaded", file: path });
          } catch (error) {
            if (controller.signal.aborted || error instanceof Error && ["setting.exportTooLarge", "setting.exportFailed"].includes(error.message)) throw error;
            failedImages++; downloads.push({ documentId: image.id, status: "unavailable", reason: "network" });
          }
        }
        add(`${folder}/image-downloads.json`, new TextEncoder().encode(JSON.stringify(downloads, null, 2)));
      }
      if (controller.signal.aborted) return;
      const { zip } = await import("fflate");
      const zipped = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 0 }, (error, result) => error ? reject(error) : resolve(result)));
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([new Uint8Array(zipped)], { type: "application/zip" }));
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `PPSS-${exportFileName(projectId)}-${selected ? exportFileName(targets[0].participantId) : "participants"}.zip`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice(failedImages ? "setting.exportPartial" : "setting.exportSaved");
    } catch (error) {
      if (!controller.signal.aborted || controller.signal.reason === "timeout") setNotice(error instanceof Error && error.message === "setting.exportTooLarge" ? "setting.exportTooLarge" : "setting.exportFailed");
    } finally {
      clearTimeout(timeout); operation.current = null;
      if (controller.signal.reason === "timeout") setNotice("setting.exportFailed");
      if (!controller.signal.aborted || controller.signal.reason === "timeout") { setBusy(false); setProgress(""); }
    }
  };
  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4" aria-label={t("setting.exportTitle")}>
    <h4 className="font-semibold text-slate-700">{t("setting.exportTitle")}</h4>
    <p className="mt-2 text-sm text-slate-500">{t("setting.exportDescription")}</p>
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="grid min-w-0 max-w-full gap-1 text-sm">{t("setting.exportParticipant")}<select className="min-h-11 max-w-full rounded-lg border bg-white p-2" value={selected} onChange={event => setSelected(event.target.value)} disabled={loading || busy}>
        <option value="">{t("setting.exportAll")}</option>{participants.map(row => <option key={row.userId} value={row.userId}>{row.participantId}</option>)}
      </select></label>
      <button type="button" onClick={() => void download()} disabled={loading || busy || !participants.length} className="min-h-11 rounded-full bg-[var(--primary)] px-4 text-sm font-semibold text-white disabled:opacity-50">{t(busy ? "setting.exportBusy" : "setting.exportDownload")}</button>
    </div>
    <p className="mt-2 text-xs text-slate-500">{t("setting.exportCoverage")}</p>
    <p role="status" className="mt-2 text-sm text-slate-600">{progress || (notice ? t(notice) : !loading && !participants.length ? t("setting.noParticipants") : "")}</p>
  </section>;
}
