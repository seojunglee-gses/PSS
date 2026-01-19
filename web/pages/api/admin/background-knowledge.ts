import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import {
  adminBucket,
  adminDb,
  buildDownloadUrl,
  verifyAdminRequest,
} from "../../../lib/firebaseAdmin";

type UploadFile = {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  data: string;
};

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
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }

const token = authHeader.replace("Bearer ", "");
const decoded = await verifyAdminRequest(token);

    const { curatedText, files } = req.body as {
      curatedText?: string;
      files?: UploadFile[];
    };

    if (!curatedText) {
      res.status(400).json({ error: "curatedText is required." });
      return;
    }

    const db = adminDb();
    await db.doc("ppssBackgroundKnowledge/current").set(
      {
        curatedText,
        updatedBy: decoded.email ?? decoded.uid,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    if (files?.length) {
      const bucket = adminBucket();
      await Promise.all(
        files.map(async (file) => {
          const timestamp = new Date().toISOString();
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const storagePath = `ppss-background-knowledge/originals/${timestamp}-${safeName}`;
          const token = randomUUID();
          await bucket
            .file(storagePath)
            .save(Buffer.from(stripDataPrefix(file.data), "base64"), {
              metadata: {
                contentType: file.type || "application/octet-stream",
                metadata: {
                  firebaseStorageDownloadTokens: token,
                },
              },
            });
          await db.collection("ppssBackgroundKnowledgeArchives").add({
            fileName: file.name,
            storagePath,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            uploadedAt: timestamp,
            uploadedBy: decoded.email ?? decoded.uid,
            downloadUrl: buildDownloadUrl(storagePath, token),
          });
        })
      );
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}
