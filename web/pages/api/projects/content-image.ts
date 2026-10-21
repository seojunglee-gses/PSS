import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { loadProjectContext } from "../../../lib/project-context-server";
import { canManageProject } from "../../../lib/rbac";
import { AccessError } from "../../../lib/membership/server";
import { adminBucket, buildDownloadUrl } from "../../../lib/firebaseAdmin";
import { prepareStorageUpload, readStorageUpload } from "../../../lib/storage-upload-server";
import { logStorageFailure, storageFailureDetails } from "../../../lib/storage-errors";
export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "Method not allowed" }); return; }
  let authenticated = false;
  let storagePath = "projects/(pending)";
  try {
    const context = await loadProjectContext(req, "problem");
    authenticated = true;
    if (!canManageProject(context.user.email, context.project)) throw new AccessError(403, "이 사업의 관리자만 이미지를 올릴 수 있습니다.");
    if (!["background", "case"].includes(req.body.purpose)) throw new AccessError(400, "이미지 종류를 확인해주세요.");
    const folder = req.body.purpose === "case" ? "case-images" : "background-images";
    storagePath = `projects/${context.projectId}/${folder}/(pending)`;
    if (req.body.action === "prepare") {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(req.body.type ?? "") || !Number.isSafeInteger(req.body.size) || req.body.size > 10 * 1024 * 1024) throw new AccessError(400, "JPG, PNG, WebP, GIF 이미지를 선택해주세요. 최대 10MB까지 올릴 수 있습니다.");
      res.status(200).json(await prepareStorageUpload(req, context.user.uid, "projects", folder)); return;
    }
    const requestedPath = req.body.storagePath;
    if (typeof requestedPath === "string" && requestedPath.startsWith(`projects/${context.projectId}/${folder}/`) && /^[a-zA-Z0-9_-]{1,128}$/.test(requestedPath.split("/").pop() ?? "")) storagePath = requestedPath;
    const file = await readStorageUpload(req.body, context.projectId, context.user.uid, "projects", folder);
    storagePath = file.storagePath;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 10 * 1024 * 1024) throw new AccessError(400, "이미지 형식과 크기를 확인해주세요.");
    const token = randomUUID();
    await adminBucket().file(storagePath).setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
    res.status(200).json({ storagePath, downloadUrl: buildDownloadUrl(storagePath, token) });
  } catch (error) {
    const failedPath = (error as { storagePath?: unknown })?.storagePath;
    if (typeof failedPath === "string" && failedPath.startsWith(storagePath.replace("(pending)", "")) && /^[a-zA-Z0-9_-]{1,128}$/.test(failedPath.split("/").pop() ?? "")) storagePath = failedPath;
    const status = error instanceof AccessError ? error.status : 503;
    const safeError = error instanceof AccessError ? { code: `http/${status}` } : error;
    logStorageFailure(safeError, storagePath, authenticated);
    res.status(status).json({ error: error instanceof AccessError ? error.message : "이미지를 저장하지 못했습니다. 서버 Storage 권한과 설정을 확인해주세요.", ...storageFailureDetails(safeError, storagePath, authenticated) });
  }
}
