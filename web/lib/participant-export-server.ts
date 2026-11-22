import type { DocumentData, DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { adminAuth } from "./firebaseAdmin";
import { participantAccess } from "./participants-server";
import { AccessError, type Identity } from "./membership/server";
import { isResearchParticipant } from "./rbac";

export const EXPORT_STAGES = ["problem", "data", "alternatives", "evaluation", "report"] as const;
const ownedCollections = ["ppssEvaluations", "ppssGeneratedImages", "ppssUserDesignSubmissions", "ppssEvaluationImages"] as const;
export function exportUserId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 128 || value.includes("/") || [".", ".."].includes(value)) throw new AccessError(400, "참여자를 다시 선택해주세요.");
  return value;
}
const adminRole = (data?: DocumentData) => ["system_admin", "project_admin"].includes(data?.role);
export async function listExportParticipants(db: Firestore, user: Identity, projectId: string) {
  const { project } = await participantAccess(db, user, projectId, true);
  const candidates = new Map<string, { email?: string; admin: boolean }>();
  const add = (id: string, data: DocumentData = {}) => {
    if (typeof id !== "string" || !id || id.includes("/") || id.length > 128) return;
    const previous = candidates.get(id);
    candidates.set(id, { email: previous?.email ?? data.email, admin: Boolean(previous?.admin || adminRole(data)) });
  };
  // listDocuments also finds parents that have only step subdocuments (unfinished users).
  const parents = await db.collection(`users_${projectId}`).listDocuments();
  parents.forEach(ref => add(ref.id));
  for (const base of ["ppssWorkspaceSummaries", "ppssChatLogs", ...ownedCollections]) {
    const snapshot = await db.collection(`${base}_${projectId}`).select("userId", "email", "role").get();
    snapshot.docs.forEach(doc => add(base === "ppssWorkspaceSummaries" || base === "ppssChatLogs" ? doc.id : doc.data().userId, doc.data()));
  }
  const ids = [...candidates.keys()].filter(id => !id.includes("@"));
  for (let start = 0; start < ids.length; start += 100) {
    const { users } = await adminAuth().getUsers(ids.slice(start, start + 100).map(uid => ({ uid })));
    users.forEach(entry => { if (entry.email) candidates.get(entry.uid)!.email = entry.email; });
  }
  return [...candidates].flatMap(([userId, value]) => {
    const email = value.email ?? (userId.includes("@") ? userId : undefined);
    return !value.admin && isResearchParticipant(email, project) ? [{ userId, participantId: email ?? userId }] : [];
  }).sort((a, b) => a.participantId.localeCompare(b.participantId));
}

export type ExportRecord = { id: string; path: string; data: DocumentData };
const record = (doc: DocumentSnapshot): ExportRecord | null => doc.exists ? { id: doc.id, path: doc.ref.path, data: doc.data()! } : null;
export async function exportParticipantIdentity(db: Firestore, user: Identity, projectId: string, target: unknown) {
  const userId = exportUserId(target);
  const { project } = await participantAccess(db, user, projectId, true);
  const [personal, summary, legacy] = await Promise.all([
    db.doc(`users_${projectId}/${userId}`).get(), db.doc(`ppssWorkspaceSummaries_${projectId}/${userId}`).get(), db.doc(`ppssChatLogs_${projectId}/${userId}`).get(),
  ]);
  let email = userId.includes("@") ? userId : summary.data()?.email;
  if (!userId.includes("@")) {
    try { email = (await adminAuth().getUser(userId)).email ?? email; }
    catch (error) { if ((error as { code?: string }).code !== "auth/user-not-found") throw error; }
  }
  if (!isResearchParticipant(email, project) || [personal.data(), summary.data(), legacy.data()].some(adminRole)) throw new AccessError(403, "참여자 연구 기록만 내려받을 수 있습니다.");
  return { userId, email, personal, summary, legacy };
}
export async function readParticipantExport(db: Firestore, user: Identity, projectId: string, target: unknown) {
  const { userId, email, personal, summary, legacy } = await exportParticipantIdentity(db, user, projectId, target);
  const collections: Record<string, ExportRecord[]> = {};
  for (const base of ownedCollections) {
    const snapshot = await db.collection(`${base}_${projectId}`).where("userId", "==", userId).get();
    collections[base] = snapshot.docs.filter(doc => doc.data().userId === userId).map(doc => record(doc)!);
  }
  if (Object.values(collections).some(rows => rows.some(row => adminRole(row.data)))) throw new AccessError(403, "참여자 연구 기록만 내려받을 수 있습니다.");
  const steps = [];
  for (const stageId of EXPORT_STAGES) {
    const ref = db.doc(`users_${projectId}/${userId}/steps/${stageId}`);
    const snapshot = await ref.get();
    const archives = await ref.collection("chatResetArchives").get();
    steps.push({ stageId, document: record(snapshot), archives: archives.docs.map(doc => record(doc)!) });
  }
  if (!personal.exists && !summary.exists && !legacy.exists && !steps.some(step => step.document || step.archives.length) && !Object.values(collections).some(rows => rows.length)) throw new AccessError(404, "저장된 참여자 기록이 없습니다.");
  return {
    schemaVersion: 1, exportedAt: new Date().toISOString(), projectId, userId, participantId: email ?? userId,
    personal: record(personal), summary: record(summary), legacyChat: record(legacy), steps,
    evaluations: collections.ppssEvaluations, generatedImages: collections.ppssGeneratedImages,
    submissions: collections.ppssUserDesignSubmissions, publishedImages: collections.ppssEvaluationImages,
  };
}
export type ParticipantExport = Awaited<ReturnType<typeof readParticipantExport>>;

/** Only known project-scoped Storage objects; never fetch arbitrary stored URLs. */
export function exportImagePath(projectId: string, image: DocumentData, bucket: string) {
  let path = image.storagePath;
  if (!path && typeof image.downloadUrl === "string") {
    try {
      const url = new URL(image.downloadUrl), prefix = `/v0/b/${bucket}/o/`;
      if (url.protocol === "https:" && url.hostname === "firebasestorage.googleapis.com" && !url.port && url.pathname.startsWith(prefix)) path = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch { /* Report an unavailable source instead of guessing. */ }
  }
  if (typeof path !== "string" || ![`projects/${projectId}/generated-images/`, `ppss-generated-images/${projectId}/`].some(prefix => path.startsWith(prefix)) || path.split("/").some(part => !part || part === "." || part === "..") || path.includes("\\") || !/\.(png|jpe?g|webp|gif)$/i.test(path)) throw new AccessError(404, "이 이미지의 원본 파일을 확인하지 못했습니다.");
  return path;
}
