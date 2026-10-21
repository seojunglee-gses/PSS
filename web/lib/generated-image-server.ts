import { randomUUID } from "node:crypto";
import { adminBucket, adminDb, buildDownloadUrl } from "./firebaseAdmin";
import { validProjectId } from "./membership/server";
import { logStorageFailure } from "./storage-errors";
export async function storeGeneratedImage(input: { projectId: string; imageId: string; base64: string; label: string; note: string; userId: string }) {
  validProjectId(input.projectId);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.imageId)) throw new Error("Invalid image ID.");
  const storagePath = `projects/${input.projectId}/generated-images/${input.imageId}.png`;
  try {
    const token = randomUUID();
    const data = input.base64.replace(/^data:[^,]+,/, "");
    await adminBucket().file(storagePath).save(Buffer.from(data, "base64"), { resumable: false,
      metadata: { contentType: "image/png", metadata: { firebaseStorageDownloadTokens: token } } });
    const record = { imageId: input.imageId, label: input.label, note: input.note, userId: input.userId,
      storagePath, downloadUrl: buildDownloadUrl(storagePath, token), createdAt: new Date().toISOString() };
    await adminDb().doc(`ppssGeneratedImages_${input.projectId}/${input.imageId}`).set(record);
    return record;
  } catch (error) { logStorageFailure(error, storagePath, true); throw new Error("생성한 이미지를 저장하지 못했습니다. 서버 Storage 권한과 설정을 확인해주세요."); }
}
