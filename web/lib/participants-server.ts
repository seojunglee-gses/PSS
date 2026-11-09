import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { adminAuth } from "./firebaseAdmin";
import { canManageProject, isResearchParticipant } from "./rbac";
import { AccessError, memberActive, memberPath, validProjectId, type Identity } from "./membership/server";
import type { ProjectMeta } from "./projects";
import type { WorkspaceSummary } from "./firebase";

export async function participantAccess(db: Firestore, user: Identity, projectId: string, write = false) {
  validProjectId(projectId);
  const snapshot = await db.doc(`ppssProjects/${projectId}`).get();
  if (!snapshot.exists) throw new AccessError(404, "사업을 찾을 수 없습니다.");
  const project = snapshot.data() as ProjectMeta;
  const manager = canManageProject(user.email, project);
  if (write && !manager || !manager && !memberActive((await db.doc(memberPath(user.uid, projectId)).get()).data())) throw new AccessError(403, "이 사업의 참여자 관리 권한이 없습니다.");
  return { project, manager };
}

// Resolve Firebase UIDs on the server: summary document IDs are not necessarily emails.
// Every participant aggregate uses this filter before counting or prompting an LLM.
export async function participantRecords(db: Firestore, projectId: string, kind: "summaries" | "evaluations" | "submissions" | "images" = "summaries") {
  validProjectId(projectId);
  const project = (await db.doc(`ppssProjects/${projectId}`).get()).data() as ProjectMeta;
  const snapshot = await db.collection(`${({ summaries: "ppssWorkspaceSummaries", evaluations: "ppssEvaluations", submissions: "ppssUserDesignSubmissions", images: "ppssEvaluationImages" })[kind]}_${projectId}`).get();
  const records = snapshot.docs.map(doc => ({ userId: kind === "summaries" ? doc.id : String(doc.data().userId ?? ""), data: doc.data() }));
  const ids = [...new Set(records.map(record => record.userId).filter(id => id && !id.includes("@")))];
  const emails = new Map<string, string>();
  for (let start = 0; start < ids.length; start += 100) {
    const resolved = await adminAuth().getUsers(ids.slice(start, start + 100).map(uid => ({ uid })));
    for (const user of resolved.users) if (user.email) emails.set(user.uid, user.email);
  }
  return records.flatMap(record => {
    const email = emails.get(record.userId) ?? (record.userId.includes("@") ? record.userId : typeof record.data.email === "string" ? record.data.email : undefined);
    if (!record.userId || !isResearchParticipant(email, project) || ["system_admin", "project_admin"].includes(record.data.role)) return [];
    return [{ ...record, participantId: email ?? record.userId }];
  });
}
export async function participantSummaries(db: Firestore, projectId: string) {
  return (await participantRecords(db, projectId)).map(record => ({ userId: record.userId, participantId: record.participantId, summary: record.data as WorkspaceSummary }));
}

// A chat-only reset archives originals and leaves completion, summaries, uploads,
// memberships and every other participant intact. Stale clients cannot re-add old logs.
export async function softResetParticipantChat(db: Firestore, user: Identity, projectId: string, userId: unknown, stageId: unknown) {
  await participantAccess(db, user, projectId, true);
  if (typeof userId !== "string" || !userId || userId.length > 128 || userId.includes("/") || !["problem", "data", "alternatives", "evaluation", "report"].includes(String(stageId))) throw new AccessError(400, "참여자와 단계를 다시 선택해주세요.");
  if (!(await participantSummaries(db, projectId)).some(entry => entry.userId === userId)) throw new AccessError(404, "참여자를 찾을 수 없습니다.");
  const step = db.doc(`users_${projectId}/${userId}/steps/${stageId}`);
  const archive = db.doc(`users_${projectId}/${userId}/steps/${stageId}/chatResetArchives/${randomUUID()}`);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(step);
    const resetAt = new Date().toISOString();
    tx.set(archive, { userId, stageId, resetAt, resetBy: user.uid, previous: snapshot.data() ?? {} });
    tx.set(step, { logs: [], chatResetAt: resetAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
