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
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }
    
    const token = authHeader.replace("Bearer ", "");
    const decoded = await verifyAdminRequest(token);

    const { curatedText } = req.body as {
  curatedText?: string;
};
    let finalCuratedText = curatedText;
    
    if (!finalCuratedText && files?.length) {
      finalCuratedText = "Auto-generated background knowledge from uploaded files.";
    }
    
    if (!finalCuratedText) {
      return res.status(400).json({ error: "No background knowledge content." });
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

    res.status(200).json({ ok: true });
  } catch (error) {
  console.error("ADMIN BACKGROUND ERROR:", error);
  res.status(500).json({
    error: error instanceof Error ? error.message : "Unexpected error",
  });
  }
}
