import { loadProjectContext } from "../../../lib/project-context-server";
import { canManageProject } from "../../../lib/rbac";
import { logStorageFailure } from "../../../lib/storage-errors";
import { prepareStorageUpload, readStorageUpload } from "../../../lib/storage-upload-server";
import { AccessError, validProjectId } from "../../../lib/membership/server";
import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import {
  adminBucket,
  adminDb,
  buildDownloadUrl,
} from "../../../lib/firebaseAdmin";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let authenticated = false;
  let targetPath = "projects/(pending)/site-images";
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing Authorization header" });
      return;
    }
    const context = await loadProjectContext(req, "problem");
    authenticated = true;
    if (!canManageProject(context.user.email, context.project)) throw new AccessError(403, "이 사업의 관리자만 대상지 이미지를 올릴 수 있습니다.");
    const decoded = context.user;
    targetPath = `projects/${context.projectId}/site-images/(pending)`;
    const downloadToken = randomUUID();

    if (req.body?.action === "prepare") {
      if (!/^image\/(png|jpeg|webp)$/.test(req.body.type ?? "")) throw new Error("PNG, JPG, WebP 이미지를 선택해주세요.");
      res.status(200).json(await prepareStorageUpload(req, decoded.uid, "projects", "site-images")); return;
    }
    const scopedProjectId = validProjectId(req.body.projectId);
    if (typeof req.body.storagePath === "string" && (req.body.storagePath.startsWith(`projects/${scopedProjectId}/site-images/`) || req.body.storagePath.startsWith(`ppss-site-image/${scopedProjectId}/`)) && /^[a-zA-Z0-9_-]{1,128}$/.test(req.body.storagePath.split("/").pop() ?? "")) targetPath = req.body.storagePath;
    const { storagePath, type } = req.body.storagePath?.startsWith("projects/")
      ? await readStorageUpload(req.body, scopedProjectId, decoded.uid, "projects", "site-images")
      : await readStorageUpload(req.body, scopedProjectId, decoded.uid, "ppss-site-image");
    if (!/^image\/(png|jpeg|webp)$/.test(type)) throw new Error("PNG, JPG, WebP 이미지를 선택해주세요.");
    targetPath = storagePath;
    const imageId = storagePath.split("/").pop()!;
    const db = adminDb();
    await adminBucket().file(storagePath).setMetadata({ metadata: { firebaseStorageDownloadTokens: downloadToken } });
    const downloadUrl = buildDownloadUrl(storagePath, downloadToken);
    
    await db.doc(`ppssSiteImages_${scopedProjectId}/current`).set(
      {
        imageId,
        storagePath,
        downloadUrl,
        updatedAt: new Date().toISOString(),
        updatedBy: decoded.email ?? decoded.uid,
      },
      { merge: true }
    );

    res.status(200).json({ downloadUrl });
  } catch (error) {
  const failedPath = (error as { storagePath?: unknown })?.storagePath;
  if (typeof failedPath === "string" && /^projects\/[a-zA-Z0-9_-]+\/site-images\/[a-zA-Z0-9_-]+$/.test(failedPath)) targetPath = failedPath;
  logStorageFailure(error, targetPath, authenticated);
  res.status(error instanceof AccessError ? error.status : 500).json({
    error: error instanceof Error ? error.message : "Unexpected error.",
  });
}
}
