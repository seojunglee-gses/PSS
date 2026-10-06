import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type { Bucket } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";
import { canManageProject } from "../rbac";
import type { ProjectMeta } from "../projects";
import { AccessError, memberActive, memberPath, validProjectId, type Identity } from "../membership/server";
import { DATASET_TYPES, MAX_DATASET_BYTES, parseDataset, type SpatialDataset } from "./datasets";

export const datasetCollection = (projectId: string) => `ppssSpatialDatasets_${validProjectId(projectId)}`;
export const permissionCollection = (projectId: string) => `ppssSpatialPermissions_${validProjectId(projectId)}`;
function validId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new AccessError(400, "공간정보를 다시 선택해주세요.");
  return value;
}
async function authorize(db: Firestore, user: Identity, projectId: string, write: boolean) {
  const project = await db.doc(`ppssProjects/${projectId}`).get();
  if (!project.exists) throw new AccessError(404, "사업을 찾을 수 없습니다.");
  const manager = canManageProject(user.email, project.data() as ProjectMeta);
  const member = manager ? undefined : (await db.doc(memberPath(user.uid, projectId)).get()).data();
  if (!manager && !memberActive(member)) throw new AccessError(403, "이 사업의 공간정보를 볼 권한이 없습니다.");
  const permission = !manager && (await db.collection(permissionCollection(projectId)).doc(user.uid).get()).exists;
  if (write && !manager && !permission) throw new AccessError(403, "공간정보 관리 권한이 필요합니다.");
  return { canManage: manager || permission, canGrant: manager };
}
export async function listDatasets(db: Firestore, user: Identity, projectId: string) {
  validProjectId(projectId);
  const access = await authorize(db, user, projectId, false);
  const snapshot = await db.collection(datasetCollection(projectId)).get();
  const permissions = access.canGrant ? (await db.collection(permissionCollection(projectId)).get()).docs.map((d) => ({ uid: d.id, email: d.data().email })) : [];
  return { ...access, permissions, datasets: snapshot.docs.map((d) => {
    const data = d.data();
    return { ...data, datasetId: d.id, uploadedAt: data.uploadedAt.toDate().toISOString() } as SpatialDataset;
  }).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)) };
}
// Only existing platform/project administrators may assign this project-scoped permission.
export async function setSpatialPermission(db: Firestore, user: Identity, body: Record<string, unknown>, lookup: (email: string) => Promise<{ uid: string; email?: string; disabled?: boolean }>) {
  const projectId = validProjectId(body.projectId);
  if (!(await authorize(db, user, projectId, false)).canGrant) throw new AccessError(403, "관리자만 공간정보 관리 권한을 지정할 수 있습니다.");
  let target: { uid: string; email?: string; disabled?: boolean };
  if (body.action === "grant") {
    if (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) throw new AccessError(400, "계획가의 가입 이메일을 입력해주세요.");
    try { target = await lookup(body.email.trim().toLowerCase()); }
    catch (error) { if ((error as { code?: string }).code === "auth/user-not-found") throw new AccessError(400, "가입한 사용자를 찾을 수 없습니다."); throw error; }
    if (target.disabled) throw new AccessError(400, "이 사용자는 권한을 받을 수 없습니다.");
  } else if (body.action === "revoke") target = { uid: validId(body.uid) };
  else throw new AccessError(400, "권한 요청을 확인해주세요.");
  await db.runTransaction(async (tx) => {
    const [project, member] = await Promise.all([tx.get(db.doc(`ppssProjects/${projectId}`)), tx.get(db.doc(memberPath(target.uid, projectId)))]);
    if (!project.exists || !canManageProject(user.email, project.data() as ProjectMeta)) throw new AccessError(403, "관리자만 공간정보 관리 권한을 지정할 수 있습니다.");
    const ref = db.collection(permissionCollection(projectId)).doc(target.uid);
    if (body.action === "revoke") tx.delete(ref);
    else {
      if (!memberActive(member.data())) throw new AccessError(400, "이 사업에 참여한 사용자에게만 권한을 줄 수 있습니다.");
      tx.set(ref, { projectId, uid: target.uid, email: target.email ?? String(body.email).trim().toLowerCase(), grantedBy: user.uid, grantedAt: Timestamp.now() });
    }
  });
  return { uid: target.uid };
}
async function removeFile(bucket: Bucket, path: string) {
  try { await bucket.file(path).delete({ ignoreNotFound: true }); }
  catch { console.error("Spatial dataset file cleanup failed; unreferenced object retained."); }
}
export async function mutateDataset(db: Firestore, bucket: Bucket, user: Identity, body: Record<string, unknown>) {
  const projectId = validProjectId(body.projectId);
  await authorize(db, user, projectId, true);
  if (!["upload", "replace", "delete"].includes(String(body.action))) throw new AccessError(400, "공간정보 요청을 확인해주세요.");
  const creating = body.action === "upload";
  const datasetId = creating ? randomUUID() : validId(body.datasetId);
  const ref = db.collection(datasetCollection(projectId)).doc(datasetId);
  let uploadedPath: string | undefined;
  let payload: Record<string, unknown> | undefined;
  if (body.action !== "delete") {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100 || !DATASET_TYPES.includes(body.type as SpatialDataset["type"]) || typeof body.fileName !== "string" || body.fileName.length > 255 || /[\\/\u0000]/.test(body.fileName)) throw new AccessError(400, "자료 이름·유형·파일명을 확인해주세요.");
    const format = body.fileName.split(".").pop()?.toLowerCase() as SpatialDataset["format"];
    if (!["geojson", "json", "csv"].includes(format)) throw new AccessError(400, "GeoJSON, JSON, CSV 파일만 업로드할 수 있습니다.");
    if (typeof body.data !== "string" || body.data.length > Math.ceil(MAX_DATASET_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.data)) throw new AccessError(400, "파일 크기는 3MB 이하로 준비해주세요.");
    const bytes = Buffer.from(body.data, "base64");
    if (!bytes.length || bytes.length > MAX_DATASET_BYTES) throw new AccessError(400, "비어 있지 않은 3MB 이하 파일을 준비해주세요.");
    let geometryType: SpatialDataset["geometryType"];
    try { geometryType = parseDataset(new TextDecoder("utf-8", { fatal: true }).decode(bytes), format, body.type as SpatialDataset["type"]).geometryType; }
    catch (error) { throw new AccessError(400, error instanceof TypeError ? "UTF-8 파일로 저장해주세요." : error instanceof Error ? error.message : "파일 형식을 확인해주세요."); }
    const revisionId = randomUUID();
    uploadedPath = `ppss-spatial-datasets/${projectId}/${datasetId}/${revisionId}/original.${format}`;
    payload = { projectId, datasetId, name: body.name.trim(), type: body.type, fileName: body.fileName, format, storagePath: uploadedPath, revisionId, size: bytes.length, geometryType, uploadedAt: Timestamp.now(), uploadedBy: user.uid };
    try { await bucket.file(uploadedPath).save(bytes, { resumable: false, metadata: { contentType: format === "csv" ? "text/csv; charset=utf-8" : format === "geojson" ? "application/geo+json" : "application/json", cacheControl: "private, no-store" } }); }
    catch (error) { await removeFile(bucket, uploadedPath); throw error; }
  }
  let previousPath: string | undefined;
  try {
    previousPath = await db.runTransaction(async (tx) => {
      const [project, previous, member, permission] = await Promise.all([tx.get(db.doc(`ppssProjects/${projectId}`)), tx.get(ref), tx.get(db.doc(memberPath(user.uid, projectId))), tx.get(db.collection(permissionCollection(projectId)).doc(user.uid))]);
      const count = creating ? (await tx.get(db.collection(datasetCollection(projectId)))).size : 0;
      // Recheck current project ownership before committing a file or deletion.
      if (!project.exists || !(canManageProject(user.email, project.data() as ProjectMeta) || (memberActive(member.data()) && permission.exists))) throw new AccessError(403, "공간정보 관리 권한이 필요합니다.");
      if (creating ? previous.exists : !previous.exists) throw new AccessError(409, "공간정보 목록을 새로고침해주세요.");
      if (creating && count >= 20) throw new AccessError(400, "사업당 공간정보는 최대 20개까지 등록할 수 있습니다.");
      if (!creating && previous.data()?.revisionId !== body.expectedRevisionId) throw new AccessError(409, "다른 관리자가 이 자료를 변경했습니다. 목록을 새로고침해주세요.");
      if (!creating && previous.data()?.storagePath !== `ppss-spatial-datasets/${projectId}/${datasetId}/${previous.data()?.revisionId}/original.${previous.data()?.format}`) throw new AccessError(400, "공간정보 경로를 확인해주세요.");
      if (body.action === "delete") tx.delete(ref); else tx.set(ref, payload!);
      return previous.data()?.storagePath as string | undefined;
    });
  } catch (error) { if (uploadedPath) await removeFile(bucket, uploadedPath); throw error; }
  if (previousPath) await removeFile(bucket, previousPath);
  return { datasetId };
}
export async function readDataset(db: Firestore, bucket: Bucket, user: Identity, projectId: string, datasetId: string, revisionId: string) {
  validProjectId(projectId); validId(datasetId); validId(revisionId);
  await authorize(db, user, projectId, false);
  const snapshot = await db.collection(datasetCollection(projectId)).doc(datasetId).get();
  if (!snapshot.exists) throw new AccessError(404, "이 공간정보가 삭제되었습니다. 목록을 다시 불러와주세요.");
  const dataset = snapshot.data() as SpatialDataset;
  if (dataset.revisionId !== revisionId) throw new AccessError(409, "이 공간정보가 교체되었습니다. 공간 분석을 다시 열어주세요.");
  const expected = `ppss-spatial-datasets/${projectId}/${datasetId}/${revisionId}/original.${dataset.format}`;
  if (dataset.projectId !== projectId || dataset.storagePath !== expected) throw new AccessError(400, "공간정보 경로를 확인해주세요.");
  const [bytes] = await bucket.file(expected).download();
  if (bytes.length > MAX_DATASET_BYTES) throw new AccessError(400, "공간정보 파일이 지원 크기를 벗어났습니다.");
  return { data: parseDataset(new TextDecoder("utf-8", { fatal: true }).decode(bytes), dataset.format, dataset.type).data };
}
