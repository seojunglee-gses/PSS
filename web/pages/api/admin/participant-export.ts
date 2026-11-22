import type { NextApiRequest, NextApiResponse } from "next";
import { pipeline } from "node:stream/promises";
import { adminBucket, adminDb, verifyUserRequest } from "../../../lib/firebaseAdmin";
import { AccessError, validProjectId } from "../../../lib/membership/server";
import { exportImagePath, exportParticipantIdentity, exportUserId, listExportParticipants, readParticipantExport } from "../../../lib/participant-export-server";

export const config = { api: { responseLimit: false } };
export const maxDuration = 60;
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); res.status(405).json({ error: "지원하지 않는 요청입니다." }); return; }
  let user;
  try { user = await verifyUserRequest(req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]); }
  catch { res.status(401).json({ error: "로그인 상태를 확인해주세요." }); return; }
  try {
    const db = adminDb(), projectId = validProjectId(req.query.projectId);
    // Every branch, including binary downloads, checks the current project's manager role.
    if (req.query.imageId !== undefined) {
      const userId = exportUserId(req.query.userId), imageId = exportUserId(req.query.imageId);
      await exportParticipantIdentity(db, user, projectId, userId);
      const image = (await db.doc(`ppssGeneratedImages_${projectId}/${imageId}`).get()).data();
      if (!image || image.userId !== userId) throw new AccessError(404, "이미지를 찾을 수 없습니다.");
      if (["system_admin", "project_admin"].includes(image.role)) throw new AccessError(403, "참여자 연구 기록만 내려받을 수 있습니다.");
      const bucket = adminBucket(), path = exportImagePath(projectId, image, bucket.name), file = bucket.file(path);
      const [metadata] = await file.getMetadata();
      if (!Number.isFinite(Number(metadata.size)) || Number(metadata.size) > 20 * 1024 * 1024) throw new AccessError(413, "이미지 파일이 다운로드 제한(20MB)을 초과합니다.");
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(metadata.size));
      res.setHeader("X-PPSS-Image-Extension", path.split(".").pop()!.toLowerCase());
      await pipeline(file.createReadStream(), res, { signal: AbortSignal.timeout(45_000) });
    } else if (req.query.userId !== undefined) {
      res.status(200).json(await readParticipantExport(db, user, projectId, req.query.userId));
    } else {
      res.status(200).json({ participants: await listExportParticipants(db, user, projectId) });
    }
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    res.status(error instanceof AccessError ? error.status : 503).json({ error: error instanceof AccessError ? error.message : "참여자 파일을 불러오지 못했습니다. 잠시 후 다시 시도해주세요." });
  }
}
