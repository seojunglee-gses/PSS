import type { NextApiRequest, NextApiResponse } from "next";
import { adminBucket, adminDb, verifyAdminRequest } from "../../../lib/firebaseAdmin";

const COLLECTIONS_TO_RESET = [
  "ppssChatLogs",
  "ppssGeneratedImages",
  "ppssWorkspaceSummaries",
  "ppssEvaluations",
  "ppssUserDesignSubmissions",
  "ppssEvaluationImages",
  "ppssExecutiveSummaries",
];

const STORAGE_PREFIXES_TO_RESET = ["ppss-generated-images/", "ppss-chat-logs/"];

const deleteCollection = async (collectionPath: string) => {
  const db = adminDb();
  const batchSize = 400;
  while (true) {
    const snapshot = await db.collection(collectionPath).limit(batchSize).get();
    if (snapshot.empty) {
      break;
    }
    const batch = db.batch();
    snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }
};

const deleteStoragePrefix = async (prefix: string) => {
  const bucket = adminBucket();
  const [files] = await bucket.getFiles({ prefix });
  await Promise.all(files.map((file) => file.delete().catch(() => null)));
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
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }
    const token = authHeader.replace("Bearer ", "");
    await verifyAdminRequest(token);

    await Promise.all(COLLECTIONS_TO_RESET.map(deleteCollection));
    await Promise.all(STORAGE_PREFIXES_TO_RESET.map(deleteStoragePrefix));

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to reset project.",
    });
  }
}
