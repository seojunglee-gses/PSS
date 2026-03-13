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

const storagePrefixesToReset = (projectId?: string) => [`ppss-generated-images/${projectId || "project-1"}/`, `ppss-chat-logs/${projectId || "project-1"}/`];

const resolveCollection = (base: string, projectId?: string) => `${base}_${projectId || "project-1"}`;

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

    const { projectId } = req.body as { projectId?: string };
    await Promise.all(COLLECTIONS_TO_RESET.map((name) => deleteCollection(resolveCollection(name, projectId))));
    await Promise.all(storagePrefixesToReset(projectId).map(deleteStoragePrefix));

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to reset project.",
    });
  }
}
