import sharp from "sharp";
import { adminBucket } from "./firebaseAdmin";
import { AccessError } from "./membership/server";
import { designImageSize } from "./design-alternatives";
import { MODELS } from "./llm/openai";
// Provider parameters and mask contract: https://developers.openai.com/api/reference/resources/images/methods/edit
// GPT Image 2.6 complexity: https://developers.openai.com/api/docs/guides/image-generation#gpt-image-26
export function designImageSettings(width: number, height: number) {
  const level = (value: string | undefined): "low" | "medium" | "high" => ["low", "medium", "high"].includes(value ?? "") ? value as "low" | "medium" | "high" : "medium";
  return { model: MODELS.image, quality: level(process.env.PPSS_IMAGE_QUALITY), complexity: level(process.env.PPSS_IMAGE_COMPLEXITY), size: designImageSize(width, height), output_format: "png" as const, n: 1 };
}
export async function readDesignImage(projectId: string, record: { storagePath?: string; downloadUrl?: string }, generated = false) {
  const path = record.storagePath;
  const folders = generated ? [`projects/${projectId}/generated-images/`] : [`projects/${projectId}/site-images/`, `ppss-site-image/${projectId}/`];
  let buffer: Buffer;
  if (path && folders.some(folder => path.startsWith(folder)) && !path.includes("..")) {
    const file = adminBucket().file(path);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) > 20 * 1024 * 1024) throw new AccessError(400, "이미지는 20MB 이하여야 해요.");
    [buffer] = await file.download();
  } else {
    // Compatibility for old records without storagePath; never fetch a client-supplied URL.
    let url: URL;
    try { url = new URL(record.downloadUrl ?? ""); } catch { throw new AccessError(400, "이미지 주소를 확인하지 못했어요."); }
    const prefix = `/v0/b/${process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}/o/`;
    const storedPath = decodeURIComponent(url.pathname.slice(prefix.length));
    if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com" || !url.pathname.startsWith(prefix) || !folders.some(folder => storedPath.startsWith(folder))) throw new AccessError(400, "등록된 사업 이미지를 확인해주세요.");
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok) throw new AccessError(503, "이미지를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = response.body!.getReader();
    try { while (true) { const { value: chunk, done } = await reader.read(); if (done) break; size += chunk.byteLength; if (size > 20 * 1024 * 1024) throw new AccessError(400, "이미지가 너무 커요."); chunks.push(chunk); } }
    finally { await reader.cancel(); }
    buffer = Buffer.concat(chunks);
  }
  const png = await sharp(buffer, { limitInputPixels: 16_777_216 }).rotate().png().toBuffer({ resolveWithObject: true });
  return { buffer: png.data, width: png.info.width, height: png.info.height };
}
export async function validateDesignMask(data: unknown, width: number, height: number): Promise<Buffer> {
  if (typeof data !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > 7_000_000) throw new AccessError(400, "수정할 부분을 먼저 칠해주세요.");
  const buffer = Buffer.from(data.split(",")[1], "base64");
  const metadata = await sharp(buffer, { limitInputPixels: 16_777_216 }).metadata();
  if (metadata.format !== "png" || metadata.width !== width || metadata.height !== height || !metadata.hasAlpha) throw new AccessError(400, "이미지와 선택 영역의 크기가 달라요. 이미지를 다시 열고 선택해주세요.");
  const pixels = await sharp(buffer).toColourspace("srgb").ensureAlpha().raw().toBuffer();
  let selected = false, preserved = false;
  for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] === 0) selected = true; if (pixels[i] === 255) preserved = true; }
  if (!selected || !preserved) throw new AccessError(400, "바꾸고 싶은 부분만 칠해주세요.");
  return buffer;
}
export async function editDesignImage(base: { buffer: Buffer; width: number; height: number }, prompt: string, mask?: Buffer) {
  const settings = designImageSettings(base.width, base.height);
  const form = new FormData();
  Object.entries(settings).forEach(([key, value]) => form.append(key, String(value)));
  form.append("prompt", prompt);
  form.append("image", new Blob([new Uint8Array(base.buffer)], { type: "image/png" }), "base.png");
  if (mask) form.append("mask", new Blob([new Uint8Array(mask)], { type: "image/png" }), "mask.png");
  const response = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form, signal: AbortSignal.timeout(240_000) });
  console.info("[design-image]", { status: response.status, requestId: response.headers.get("x-request-id"), retryAfter: response.headers.get("retry-after") });
  if (!response.ok) throw new AccessError(response.status === 429 ? 429 : 503, response.status === 429 ? "이미지 요청이 많아 잠시 기다려야 해요. 기존 이미지는 그대로 있어요. 잠시 후 다시 시도해주세요." : "이미지를 만들지 못했어요. 기존 이미지는 그대로 있어요. 잠시 후 다시 시도해주세요.");
  const result = await response.json();
  const base64 = result.data?.[0]?.b64_json;
  if (typeof base64 !== "string" || !base64) throw new AccessError(502, "생성된 이미지를 받지 못했어요. 기존 이미지는 그대로 있어요.");
  return { base64, settings };
}
