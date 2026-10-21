import { prepareStorageUpload, readStorageUpload } from "../../../lib/storage-upload-server";
import { validProjectId } from "../../../lib/membership/server";
import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import {
  adminBucket,
  adminDb,
  buildDownloadUrl,
  verifyAdminRequest,
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

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing Authorization header" });
      return;
    }
    const authToken = authHeader.replace("Bearer ", "");
    const decoded = await verifyAdminRequest(authToken);
    const downloadToken = randomUUID();

    if (req.body?.action === "prepare") {
      if (!/^image\/(png|jpeg|webp)$/.test(req.body.type ?? "")) throw new Error("PNG, JPG, WebP 이미지를 선택해주세요.");
      res.status(200).json(await prepareStorageUpload(req, decoded.uid, "ppss-site-image")); return;
    }
    const scopedProjectId = validProjectId(req.body.projectId);
    const { storagePath, type } = await readStorageUpload(req.body, scopedProjectId, decoded.uid, "ppss-site-image");
    if (!/^image\/(png|jpeg|webp)$/.test(type)) throw new Error("PNG, JPG, WebP 이미지를 선택해주세요.");
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
  console.error("SITE IMAGE UPLOAD ERROR:", error);
  res.status(500).json({
    error: error instanceof Error ? error.message : "Unexpected error.",
  });
}
}
