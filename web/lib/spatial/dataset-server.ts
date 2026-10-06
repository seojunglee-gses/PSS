import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type { Bucket } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";
import { canManageProject } from "../rbac";
import type { ProjectMeta } from "../projects";
import { AccessError, memberActive, memberPath, validProjectId, type Identity } from "../membership/server";
import { DATASET_TYPES, MAX_DATASET_BYTES, parseDataset, type SpatialDataset } from "./datasets";
import { BUILDING_USE_VERSION, normalizeBuildingData } from "./building-use-server";
import type { FeatureCollection, Geometry } from "geojson";

export const datasetCollection = (projectId: string) => `ppssSpatialDatasets_${validProjectId(projectId)}`;
function validId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new AccessError(400, "공간정보를 다시 선택해주세요.");
  return value;
}
async function authorize(db: Firestore, user: Identity, projectId: string, write: boolean) {
  const project = await db.doc(`ppssProjects/${projectId}`).get();
  if (!project.exists) throw new AccessError(404, "사업을 찾을 수 없습니다.");
  const manager = canManageProject(user.email, project.data() as ProjectMeta);
  if (write && !manager) throw new AccessError(403, "이 사업의 관리자만 공간정보를 관리할 수 있습니다.");
  if (!manager && !memberActive((await db.doc(memberPath(user.uid, projectId)).get()).data())) throw new AccessError(403, "이 사업의 공간정보를 볼 권한이 없습니다.");
  return manager;
}
export async function listDatasets(db: Firestore, user: Identity, projectId: string) {
  validProjectId(projectId);
  const canManage = await authorize(db, user, projectId, false);
  const snapshot = await db.collection(datasetCollection(projectId)).get();
  return { canManage, datasets: snapshot.docs.map((d) => {
    const data = d.data();
    return { ...data, datasetId: d.id, uploadedAt: data.uploadedAt.toDate().toISOString() } as SpatialDataset;
  }).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)) };
}
async function removeFile(bucket: Bucket, path: string) {
  try { await bucket.file(path).delete({ ignoreNotFound: true }); }
  catch { console.error("Spatial dataset file cleanup failed; unreferenced object retained."); }
}
function normalizedPath(projectId: string, datasetId: string, revisionId: string, version: string, id: string) {
  return `ppss-spatial-datasets/${projectId}/${datasetId}/${revisionId}/normalized-${version}-${id}.geojson`;
}
function existingNormalizedPath(dataset: SpatialDataset, projectId: string, datasetId: string): string | undefined {
  if (!dataset.normalizedStoragePath) return undefined;
  if (!dataset.normalizedId || !/^[a-zA-Z0-9_-]{1,128}$/.test(dataset.normalizedId) || !dataset.buildingUseVersion || !/^[a-f0-9]{64}$/.test(dataset.buildingUseVersion) || dataset.normalizedStoragePath !== normalizedPath(projectId, datasetId, dataset.revisionId, dataset.buildingUseVersion, dataset.normalizedId)) throw new AccessError(400, "건물 용도 자료 경로를 확인해주세요.");
  return dataset.normalizedStoragePath;
}
function normalizedBytes(data: FeatureCollection<Geometry>) {
  const bytes = Buffer.from(JSON.stringify(data));
  if (bytes.length > MAX_DATASET_BYTES) throw new AccessError(400, "용도 정보를 포함한 건물 자료가 3MB를 넘습니다. 파일을 나눠 업로드해주세요.");
  return bytes;
}
const normalizedOptions = { resumable: false, metadata: { contentType: "application/geo+json", cacheControl: "private, no-store" } };
export async function mutateDataset(db: Firestore, bucket: Bucket, user: Identity, body: Record<string, unknown>) {
  const projectId = validProjectId(body.projectId);
  await authorize(db, user, projectId, true);
  if (!["upload", "replace", "delete"].includes(String(body.action))) throw new AccessError(400, "공간정보 요청을 확인해주세요.");
  const creating = body.action === "upload";
  const datasetId = creating ? randomUUID() : validId(body.datasetId);
  const ref = db.collection(datasetCollection(projectId)).doc(datasetId);
  let uploadedPath: string | undefined;
  let uploadedNormalizedPath: string | undefined;
  let payload: Record<string, unknown> | undefined;
  if (body.action !== "delete") {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100 || !DATASET_TYPES.includes(body.type as SpatialDataset["type"]) || typeof body.fileName !== "string" || body.fileName.length > 255 || /[\\/\u0000]/.test(body.fileName)) throw new AccessError(400, "자료 이름·유형·파일명을 확인해주세요.");
    const format = body.fileName.split(".").pop()?.toLowerCase() as SpatialDataset["format"];
    if (!["geojson", "json", "csv"].includes(format)) throw new AccessError(400, "GeoJSON, JSON, CSV 파일만 업로드할 수 있습니다.");
    if (typeof body.data !== "string" || body.data.length > Math.ceil(MAX_DATASET_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.data)) throw new AccessError(400, "파일 크기는 3MB 이하로 준비해주세요.");
    const bytes = Buffer.from(body.data, "base64");
    if (!bytes.length || bytes.length > MAX_DATASET_BYTES) throw new AccessError(400, "비어 있지 않은 3MB 이하 파일을 준비해주세요.");
    let geometryType: SpatialDataset["geometryType"];
    let normalized: Buffer | undefined;
    try {
      const parsed = parseDataset(new TextDecoder("utf-8", { fatal: true }).decode(bytes), format, body.type as SpatialDataset["type"]);
      geometryType = parsed.geometryType;
      if (body.type === "buildings" && parsed.data) normalized = normalizedBytes(normalizeBuildingData(parsed.data));
    }
    catch (error) { throw new AccessError(400, error instanceof TypeError ? "UTF-8 파일로 저장해주세요." : error instanceof Error ? error.message : "파일 형식을 확인해주세요."); }
    const revisionId = randomUUID();
    uploadedPath = `ppss-spatial-datasets/${projectId}/${datasetId}/${revisionId}/original.${format}`;
    payload = { projectId, datasetId, name: body.name.trim(), type: body.type, fileName: body.fileName, format, storagePath: uploadedPath, revisionId, size: bytes.length, geometryType, uploadedAt: Timestamp.now(), uploadedBy: user.uid };
    if (normalized) {
      const normalizedId = randomUUID();
      uploadedNormalizedPath = normalizedPath(projectId, datasetId, revisionId, BUILDING_USE_VERSION, normalizedId);
      Object.assign(payload, { normalizedId, normalizedStoragePath: uploadedNormalizedPath, buildingUseVersion: BUILDING_USE_VERSION });
    }
    try {
      await bucket.file(uploadedPath).save(bytes, { resumable: false, metadata: { contentType: format === "csv" ? "text/csv; charset=utf-8" : format === "geojson" ? "application/geo+json" : "application/json", cacheControl: "private, no-store" } });
      if (normalized && uploadedNormalizedPath) await bucket.file(uploadedNormalizedPath).save(normalized, normalizedOptions);
    }
    catch (error) { await removeFile(bucket, uploadedPath); if (uploadedNormalizedPath) await removeFile(bucket, uploadedNormalizedPath); throw error; }
  }
  let previousPaths: string[];
  try {
    previousPaths = await db.runTransaction(async (tx) => {
      const [project, previous] = await Promise.all([tx.get(db.doc(`ppssProjects/${projectId}`)), tx.get(ref)]);
      const count = creating ? (await tx.get(db.collection(datasetCollection(projectId)))).size : 0;
      // Recheck current project ownership before committing a file or deletion.
      if (!project.exists || !canManageProject(user.email, project.data() as ProjectMeta)) throw new AccessError(403, "이 사업의 관리자만 공간정보를 관리할 수 있습니다.");
      if (creating ? previous.exists : !previous.exists) throw new AccessError(409, "공간정보 목록을 새로고침해주세요.");
      if (creating && count >= 20) throw new AccessError(400, "사업당 공간정보는 최대 20개까지 등록할 수 있습니다.");
      if (!creating && previous.data()?.revisionId !== body.expectedRevisionId) throw new AccessError(409, "다른 관리자가 이 자료를 변경했습니다. 목록을 새로고침해주세요.");
      if (!creating && previous.data()?.storagePath !== `ppss-spatial-datasets/${projectId}/${datasetId}/${previous.data()?.revisionId}/original.${previous.data()?.format}`) throw new AccessError(400, "공간정보 경로를 확인해주세요.");
      const oldNormalized = previous.exists ? existingNormalizedPath(previous.data() as SpatialDataset, projectId, datasetId) : undefined;
      if (body.action === "delete") tx.delete(ref); else tx.set(ref, payload!);
      return [previous.data()?.storagePath, oldNormalized].filter((path): path is string => typeof path === "string");
    });
  } catch (error) { if (uploadedPath) await removeFile(bucket, uploadedPath); if (uploadedNormalizedPath) await removeFile(bucket, uploadedNormalizedPath); throw error; }
  for (const path of previousPaths) await removeFile(bucket, path);
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
  const cachedPath = existingNormalizedPath(dataset, projectId, datasetId);
  if (dataset.type === "buildings" && cachedPath && dataset.buildingUseVersion === BUILDING_USE_VERSION) {
    try {
      const [cached] = await bucket.file(cachedPath).download();
      if (cached.length > MAX_DATASET_BYTES) throw new AccessError(400, "건물 용도 자료 크기를 확인해주세요.");
      return { data: parseDataset(new TextDecoder("utf-8", { fatal: true }).decode(cached), "geojson", "buildings").data };
    } catch (error) { if ((error as {code?: unknown}).code !== 404) throw error; }
  }
  const [bytes] = await bucket.file(expected).download();
  if (bytes.length > MAX_DATASET_BYTES) throw new AccessError(400, "공간정보 파일이 지원 크기를 벗어났습니다.");
  const data = parseDataset(new TextDecoder("utf-8", { fatal: true }).decode(bytes), dataset.format, dataset.type).data;
  if (!data || dataset.type !== "buildings") return { data };
  // Legacy uploads / updated reference: create one derived version and reuse it thereafter.
  const normalized = normalizeBuildingData(data), bytesToSave = normalizedBytes(normalized), normalizedId = randomUUID();
  const newPath = normalizedPath(projectId, datasetId, revisionId, BUILDING_USE_VERSION, normalizedId);
  let committed = false, replacedPath: string | undefined;
  try {
    await bucket.file(newPath).save(bytesToSave, normalizedOptions);
    await db.runTransaction(async (tx) => {
      const [current, project, member] = await Promise.all([tx.get(snapshot.ref), tx.get(db.doc(`ppssProjects/${projectId}`)), tx.get(db.doc(memberPath(user.uid, projectId)))]);
      if (!project.exists || (!canManageProject(user.email, project.data() as ProjectMeta) && !memberActive(member.data()))) throw new AccessError(403, "이 사업의 공간정보를 볼 권한이 없습니다.");
      if (!current.exists || current.data()?.revisionId !== revisionId) throw new AccessError(409, "이 공간정보가 변경되었습니다. 공간 분석을 다시 열어주세요.");
      const currentData = current.data() as SpatialDataset;
      const currentPath = existingNormalizedPath(currentData, projectId, datasetId);
      // A concurrent reader has already committed the same reference version.
      committed = false; replacedPath = undefined;
      if (currentPath && currentData.buildingUseVersion === BUILDING_USE_VERSION && currentData.normalizedId !== dataset.normalizedId) return;
      tx.update(snapshot.ref, { normalizedId, normalizedStoragePath: newPath, buildingUseVersion: BUILDING_USE_VERSION });
      committed = true; replacedPath = currentPath;
    });
  } catch (error) { await removeFile(bucket, newPath); throw error; }
  if (!committed) await removeFile(bucket, newPath);
  else if (replacedPath) await removeFile(bucket, replacedPath);
  return { data: normalized };
}
