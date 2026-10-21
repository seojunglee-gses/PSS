import { useI18n } from "../lib/i18n";
import { useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { uploadProjectFile } from "../lib/storage-upload";
import { logStorageFailure } from "../lib/storage-errors";
import { imageList } from "../lib/content-format";

export default function ProjectImageGallery({ value, editable, projectId, onChange, onBusyChange, purpose = "background" }: {
  value: string; editable: boolean; projectId: string; onChange: (value: string) => void; onBusyChange: (busy: boolean) => void; purpose?: "background" | "case";
}) {
  const { t, localize } = useI18n();
  const { user } = useAuth();
  const images = imageList(value);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = useRef<{ x: number; y: number } | null>(null);
  const current = Math.min(index, Math.max(0, images.length - 1));
  const move = (direction: number) => setIndex((current + direction + images.length) % images.length);
  const upload = async (files: File[]) => {
    if (!files.length || !editable) return;
    if (files.some((file) => !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || file.size > 10 * 1024 * 1024)) {
      setError(t("image.allowed")); return;
    }
    setBusy(true); onBusyChange(true); setError("");
    const added: string[] = [];
    try {
      if (!user) throw Object.assign(new Error(t("common.authRequired")), { code: "auth/unauthenticated" });
      const token = await user.getIdToken();
      for (const file of files) {
        const uploaded = await uploadProjectFile("/api/projects/content-image", file, projectId, token, { purpose });
        const response = await fetch("/api/projects/content-image", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ projectId, purpose, ...uploaded }) });
        const result = await response.json();
        if (!response.ok) throw Object.assign(new Error(result.error ?? t("image.saveFailed")), { code: result.code ?? `http/${response.status}`, storagePath: uploaded.storagePath });
        added.push(result.downloadUrl);
      }
    } catch (error) {
      const details = error as { code?: string; storagePath?: string };
      logStorageFailure(error, details.storagePath ?? `projects/${projectId}/${purpose === "case" ? "case-images" : "background-images"}/(pending)`, Boolean(user));
      setError(error instanceof Error ? error.message : t("image.uploadFailed"));
    }
    finally {
      if (added.length) { onChange([...images, ...added].join("\n")); setIndex(images.length); }
      setBusy(false); onBusyChange(false);
    }
  };
  return <div className="mt-4 space-y-2">
    <div style={{ touchAction: "pan-y pinch-zoom" }} className="flex min-h-40 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
      onTouchStart={(event) => { const touch = event.touches[0]; start.current = { x: touch.clientX, y: touch.clientY }; }}
      onTouchEnd={(event) => { const touch = event.changedTouches[0]; if (start.current && images.length > 1 && Math.abs(touch.clientX - start.current.x) > 50 && Math.abs(touch.clientY - start.current.y) < 50) move(touch.clientX < start.current.x ? 1 : -1); start.current = null; }}>
      {images[current] ? <img src={images[current]} alt={t("image.alt", { number: current + 1 })} className="max-h-[420px] w-full object-contain" /> : <p className="p-4 text-sm text-slate-500">{t("image.empty")}</p>}
    </div>
    {images.length > 1 && <div className="flex items-center justify-center gap-4">
      <button type="button" aria-label={t("image.previous")} className="min-h-11 min-w-11 rounded-full border" onClick={() => move(-1)}>‹</button>
      <span aria-live="polite" className="text-sm text-slate-500">{current + 1} / {images.length}</span>
      <button type="button" aria-label={t("image.next")} className="min-h-11 min-w-11 rounded-full border" onClick={() => move(1)}>›</button>
    </div>}
    {editable && <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4">
        {busy ? t("image.uploading") : t("image.upload")}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={busy} className="sr-only"
          onChange={(event) => { void upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      </label>
      <button type="button" disabled={busy} className="min-h-11 rounded-full border px-4" onClick={() => {
        const url = window.prompt(t("image.urlPrompt")); if (!url) return;
        if (!imageList(url).length || /\s/.test(url)) { setError(t("image.urlInvalid")); return; }
        onChange([...images, url.trim()].join("\n")); setIndex(images.length); setError("");
      }}>{t("image.addUrl")}</button>
      {!!images.length && <button type="button" disabled={busy} className="min-h-11 rounded-full border px-4" onClick={() => onChange(images.filter((_, i) => i !== current).join("\n"))}>{t("image.remove")}</button>}
    </div>}
    {error && <p role="alert" className="text-sm text-rose-600">{localize(error, "image.uploadFailed")}</p>}
  </div>;
}
