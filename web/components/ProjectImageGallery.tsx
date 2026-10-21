import { useRef, useState } from "react";
import { getApps } from "firebase/app";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { imageList } from "../lib/content-format";

export default function ProjectImageGallery({ value, editable, projectId, onChange, onBusyChange }: {
  value: string; editable: boolean; projectId: string; onChange: (value: string) => void; onBusyChange: (busy: boolean) => void;
}) {
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
      setError("JPG, PNG, WebP, GIF 이미지를 선택해주세요. 파일당 최대 10MB까지 올릴 수 있습니다."); return;
    }
    setBusy(true); onBusyChange(true); setError("");
    const added: string[] = [];
    try {
      const app = getApps()[0];
      if (!app) throw new Error();
      for (const file of files) {
        // Reuse the existing project site-image folder without changing its current-image pointer.
        const target = ref(getStorage(app), `ppss-site-image/${projectId}/${crypto.randomUUID()}.${file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "png"}`);
        await uploadBytes(target, file, { contentType: file.type });
        added.push(await getDownloadURL(target));
      }
    } catch { setError("이미지를 올리지 못했습니다. 잠시 후 다시 시도해주세요."); }
    finally {
      if (added.length) { onChange([...images, ...added].join("\n")); setIndex(images.length); }
      setBusy(false); onBusyChange(false);
    }
  };
  return <div className="mt-4 space-y-2">
    <div style={{ touchAction: "pan-y pinch-zoom" }} className="flex min-h-40 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
      onTouchStart={(event) => { const touch = event.touches[0]; start.current = { x: touch.clientX, y: touch.clientY }; }}
      onTouchEnd={(event) => { const touch = event.changedTouches[0]; if (start.current && images.length > 1 && Math.abs(touch.clientX - start.current.x) > 50 && Math.abs(touch.clientY - start.current.y) < 50) move(touch.clientX < start.current.x ? 1 : -1); start.current = null; }}>
      {images[current] ? <img src={images[current]} alt={`사업 이미지 ${current + 1}`} className="max-h-[420px] w-full object-contain" /> : <p className="p-4 text-sm text-slate-500">등록된 이미지가 없습니다.</p>}
    </div>
    {images.length > 1 && <div className="flex items-center justify-center gap-4">
      <button type="button" aria-label="이전 이미지" className="min-h-11 min-w-11 rounded-full border" onClick={() => move(-1)}>‹</button>
      <span aria-live="polite" className="text-sm text-slate-500">{current + 1} / {images.length}</span>
      <button type="button" aria-label="다음 이미지" className="min-h-11 min-w-11 rounded-full border" onClick={() => move(1)}>›</button>
    </div>}
    {editable && <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4">
        {busy ? "이미지 업로드 중…" : "이미지 업로드"}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={busy} className="sr-only"
          onChange={(event) => { void upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      </label>
      <button type="button" disabled={busy} className="min-h-11 rounded-full border px-4" onClick={() => {
        const url = window.prompt("이미지 주소를 입력해주세요."); if (!url) return;
        if (!imageList(url).length || /\s/.test(url)) { setError("http 또는 https로 시작하는 이미지 주소를 입력해주세요."); return; }
        onChange([...images, url.trim()].join("\n")); setIndex(images.length); setError("");
      }}>이미지 주소 추가</button>
      {!!images.length && <button type="button" disabled={busy} className="min-h-11 rounded-full border px-4" onClick={() => onChange(images.filter((_, i) => i !== current).join("\n"))}>현재 이미지 삭제</button>}
    </div>}
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
  </div>;
}
