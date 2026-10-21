import { randomUUID } from "node:crypto";
import { adminBucket } from "./firebaseAdmin";
import { validProjectId } from "./membership/server";
import type { NextApiRequest } from "next";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export async function prepareStorageUpload(req: NextApiRequest, uid: string, prefix: string) {
  const projectId = validProjectId(req.body.projectId);
  const { name, type, size } = req.body;
  if (typeof name !== "string" || !name.trim() || name.length > 255 || typeof type !== "string" || type.length > 150 || !Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) throw new Error("파일을 확인해주세요. 파일당 최대 20MB까지 올릴 수 있습니다.");
  const storagePath = `${prefix}/${projectId}/${randomUUID()}`;
  const [uploadUrl] = await adminBucket().file(storagePath).createResumableUpload({ origin: req.headers.origin,
    metadata: { contentType: type || "application/octet-stream", metadata: { originalName: name, uploadedBy: uid, projectId, expectedSize: String(size) } } });
  return { uploadUrl, storagePath };
}
export async function readStorageUpload(input: { storagePath?: string }, projectId: string, uid: string, prefix: string) {
  validProjectId(projectId);
  if (typeof input.storagePath !== "string" || !input.storagePath.startsWith(`${prefix}/${projectId}/`) || input.storagePath.split("/").length !== prefix.split("/").length + 2 || input.storagePath.includes("..")) throw new Error("업로드한 파일 경로를 확인해주세요.");
  const file = adminBucket().file(input.storagePath);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (metadata.metadata?.uploadedBy !== uid || metadata.metadata?.projectId !== projectId || !Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES || size !== Number(metadata.metadata?.expectedSize)) throw new Error("업로드한 파일의 크기 또는 권한을 확인해주세요.");
  const [buffer] = await file.download();
  return { buffer, name: String(metadata.metadata?.originalName ?? "file"), type: metadata.contentType ?? "application/octet-stream", size, storagePath: input.storagePath };
}
