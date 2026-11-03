import type { NextApiRequest, NextApiResponse } from "next";
import { adminBucket, adminDb, verifyAdminRequest } from "../../../lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { AccessError, validProjectId } from "../../../lib/membership/server";

const COLLECTIONS_TO_RESET = [
  "ppssChatLogs",
  "ppssGeneratedImages",
  "ppssWorkspaceSummaries",
  "ppssEvaluations",
  "ppssUserDesignSubmissions",
  "ppssEvaluationImages",
  "ppssExecutiveSummaries",
  "ppssStageLocks",
];

const storagePrefixesToReset = (projectId: string) => [`ppss-generated-images/${projectId}/`, `ppss-chat-logs/${projectId}/`, `projects/${projectId}/generated-images/`];

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
  await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
};

const deletePrivateWorkspace = async (projectId: string) => {
  const db = adminDb();
  // Stage documents can exist without a parent user document.
  const users = await db.collection(`users_${projectId}`).listDocuments();
  for (const user of users) {
    await db.recursiveDelete(user.collection("steps"));
    const snapshot = await user.get();
    if (snapshot.exists && snapshot.data()?.confirmedStageSummaries) {
      await user.update({ confirmedStageSummaries: FieldValue.delete() });
    }
  }
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

    const projectId = validProjectId(req.body?.projectId ?? "project-1");
    await deletePrivateWorkspace(projectId);
    await Promise.all(COLLECTIONS_TO_RESET.map((name) => deleteCollection(resolveCollection(name, projectId))));
    await Promise.all(storagePrefixesToReset(projectId).map(deleteStoragePrefix));

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(error instanceof AccessError ? error.status : 500).json({
      error: error instanceof Error ? error.message : "Unable to reset project.",
    });
  }
}
