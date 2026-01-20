import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import {
  adminBucket,
  adminDb,
  buildDownloadUrl,
  verifyAdminRequest,
} from "../../../lib/firebaseAdmin";

const stripDataPrefix = (data: string) =>
  data.includes(",") ? data.split(",")[1] : data;

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

    const { name, type, size, lastModified, data } = req.body as {
      name?: string;
      type?: string;
      size?: number;
      lastModified?: number;
      data?: string;
    };

    if (!name || !data || !size || !lastModified) {
      res.status(400).json({ error: "Invalid payload." });
      return;
    }

    const imageId = "current";
    const db = adminDb();
    const storagePath = "ppss-site-image/current";
    const token = randomUUID();
    const bucket = adminBucket();
    await bucket.file(storagePath).save(
      Buffer.from(stripDataPrefix(data), "base64"),
      {
        metadata: {
          contentType: type || "application/octet-stream",
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
          },
        },
      }
    );
    const downloadUrl = buildDownloadUrl(storagePath, downloadToken);
    
    await db.doc("ppssSiteImages/current").set(
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
