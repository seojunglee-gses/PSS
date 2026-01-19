import type { NextApiRequest, NextApiResponse } from "next";
import {
  adminDb,
  verifyAdminRequest,
} from "../../../lib/firebaseAdmin";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid Authorization header" });
    }

    const token = authHeader.replace("Bearer ", "");
    const decoded = await verifyAdminRequest(token);

    const { curatedText } = req.body as {
      curatedText?: string;
    };

    const finalCuratedText =
  curatedText && curatedText.trim().length > 0
    ? curatedText.trim()
    : "Background knowledge uploaded. Pending curation.";
    
    const db = adminDb();
    await db.doc("ppssBackgroundKnowledge/current").set(
      {
        curatedText: finalCuratedText,
        updatedBy: decoded.email ?? decoded.uid,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    
    await db.doc("ppssBackgroundKnowledge/current").set(
      {
        curatedText,
        updatedBy: decoded.email ?? decoded.uid,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("ADMIN BACKGROUND ERROR:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error",
    });
  }
}
