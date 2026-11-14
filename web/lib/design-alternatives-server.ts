import { createHash, randomUUID } from "node:crypto";
import { adminDb } from "./firebaseAdmin";
import { AccessError } from "./membership/server";
import { callLLM } from "./llm";
import { DESIGN_PROPOSAL_INSTRUCTIONS, parseDesignDirection, type DesignDirection } from "./design-alternatives";
import type { loadProjectContext } from "./project-context-server";
type Context = Awaited<ReturnType<typeof loadProjectContext>>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Reuse the existing server-only derivative collection; source research records are read-only.
export const designRef = (projectId: string, userId: string, kind: string) => adminDb().doc(`ppssDerivedStageTopics/design-${hash([projectId, userId, kind])}`);
export async function withDesignOperation<T>(context: Context, kind: string, requestId: string, payload: unknown, work: () => Promise<T>): Promise<T> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new AccessError(400, "요청 번호를 확인해주세요.");
  const db = adminDb(), ref = designRef(context.projectId, context.user.uid, `${kind}:${requestId}`), lock = designRef(context.projectId, context.user.uid, `${kind}:lock`);
  const payloadHash = hash(payload), token = randomUUID();
  const slots = kind === "image" ? Array.from({ length: Math.max(1, Math.min(8, Number(process.env.PPSS_IMAGE_CONCURRENCY) || 3)) }, (_, index) => designRef("_service", "_image", `slot:${index}`)) : [];
  let slot: typeof lock | undefined;
  const cached = await db.runTransaction(async tx => {
    const [operation, busy, ...slotStates] = await Promise.all([tx.get(ref), tx.get(lock), ...slots.map(item => tx.get(item))]);
    const record = operation.data();
    if (record && record.payloadHash !== payloadHash) throw new AccessError(409, "요청 내용이 바뀌었어요. 다시 시도해 주세요.");
    if (record?.status === "done") return { value: record.result as T };
    if ((record?.status === "running" && (kind === "image" || Number(busy.data()?.until) > Date.now())) || (record?.status === "failed" && kind === "image")) throw new AccessError(409, "이 요청을 처리하고 있어요. 잠시 후 이미지를 다시 확인해 주세요.");
    if (Number(busy.data()?.until) > Date.now()) throw new AccessError(409, "앞선 요청을 처리하고 있어요. 잠시만 기다려 주세요.");
    const freeSlot = slotStates.findIndex(snapshot => Number(snapshot.data()?.until ?? 0) <= Date.now());
    if (slots.length && freeSlot < 0) throw new AccessError(429, "다른 이미지를 만들고 있어요. 잠시 후 다시 눌러주세요. 기존 이미지는 그대로 있어요.");
    slot = freeSlot >= 0 ? slots[freeSlot] : undefined;
    if (slot) tx.set(slot, { token, until: Date.now() + 12 * 60_000 });
    tx.set(lock, { token, until: Date.now() + 12 * 60_000 });
    tx.set(ref, { projectId: context.projectId, userId: context.user.uid, payloadHash, status: "running", startedAt: new Date().toISOString() });
    return null;
  });
  if (cached) return cached.value;
  try {
    const result = await work();
    await ref.set({ status: "done", result }, { merge: true });
    return result;
  } catch (error) {
    // Do not replay an ambiguous provider timeout automatically: it may already have generated an image.
    await ref.set({ status: "failed" }, { merge: true }).catch(() => {});
    throw error;
  } finally {
    await db.runTransaction(async tx => {
      const [busy, occupied] = await Promise.all([tx.get(lock), slot ? tx.get(slot) : Promise.resolve(undefined)]);
      if (busy.data()?.token === token) tx.set(lock, { until: 0 });
      if (slot && occupied?.data()?.token === token) tx.set(slot, { until: 0 });
    }).catch(() => {});
  }
}
export async function readDesignDirection(context: Context): Promise<DesignDirection | null> {
  return (await designRef(context.projectId, context.user.uid, "direction").get()).data()?.direction ?? null;
}
async function previousDialogue(context: Context) {
  const db = adminDb(), result: Record<string, unknown> = {};
  const legacy = (await db.doc(`ppssChatLogs_${context.projectId}/${context.user.uid}`).get()).data();
  for (const stage of ["problem", "data"]) {
    const own = (await db.doc(`users_${context.projectId}/${context.user.uid}/steps/${stage}`).get()).data();
    const logs = Array.isArray(own?.logs) && own.logs.length ? own.logs : legacy?.logsByStep?.[stage] ?? legacy?.logs?.filter((log: { stepId?: string }) => log.stepId === stage) ?? [];
    result[stage] = logs.filter((log: { sender?: string; text?: string }) => ["user", "assistant", "Planner", "ChatGPT"].includes(log.sender ?? "") && typeof log.text === "string").map((log: { sender: string; text: string; id?: string }) => ({ role: ["user", "Planner"].includes(log.sender) ? "user" : "assistant", text: log.text, ...(log.id ? { id: log.id } : {}) }));
  }
  // Fail clearly rather than silently omitting older resident opinions in an oversized request.
  if (JSON.stringify(result).length > 240_000) throw new AccessError(413, "이전 대화가 매우 길어 설계 방향을 자동으로 준비하지 못했어요. 채팅에서 원하는 방향을 알려주세요.");
  return result;
}
export async function prepareDesignDirection(context: Context, feedback?: string, expectedRevision?: string): Promise<DesignDirection | null> {
  const prior = await readDesignDirection(context);
  if (!feedback && prior) return prior;
  if (feedback && (!prior || prior.revision !== expectedRevision)) throw new AccessError(409, "설계 방향이 바뀌었어요. 새로 확인한 뒤 수정해주세요.");
  if (!feedback) {
    const images = await adminDb().collection(`ppssGeneratedImages_${context.projectId}`).where("userId", "==", context.user.uid).limit(1).get();
    const own = (await adminDb().doc(`users_${context.projectId}/${context.user.uid}`).get()).data();
    const workspace = (await adminDb().doc(`ppssWorkspaceSummaries_${context.projectId}/${context.user.uid}`).get()).data();
    const legacy = (await adminDb().doc(`ppssChatLogs_${context.projectId}/${context.user.uid}`).get()).data();
    const legacyLogs = legacy?.logsByStep?.alternatives ?? legacy?.logs?.filter((log: { stepId?: string }) => log.stepId === "alternatives") ?? [];
    if (!images.empty || context.stageHistory.length || legacyLogs.length || own?.completedStages?.includes("alternatives") || workspace?.completedStages?.includes("alternatives")) return null;
  }
  const result = await callLLM({ provider: "openai", systemText: DESIGN_PROPOSAL_INSTRUCTIONS, userText: JSON.stringify({ project: context.currentMaterial, summaries: context.previousSummaries, dialogue: await previousDialogue(context), prior, feedback: feedback ?? null }) });
  const direction: DesignDirection = { ...parseDesignDirection(result), revision: randomUUID() };
  const db = adminDb(), ref = designRef(context.projectId, context.user.uid, "direction");
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data()?.direction as DesignDirection | undefined;
    if ((current?.revision ?? null) !== (prior?.revision ?? null)) throw new AccessError(409, "다른 창에서 설계 방향이 바뀌었어요. 다시 불러와주세요.");
    tx.create(designRef(context.projectId, context.user.uid, `revision:${direction.revision}`), { direction, projectId: context.projectId, userId: context.user.uid, feedback: feedback ?? null, previousRevision: prior?.revision ?? null, createdAt: new Date().toISOString() });
    tx.set(ref, { direction, projectId: context.projectId, userId: context.user.uid });
  });
  return direction;
}
export async function confirmDesignDirection(context: Context, revision: string) {
  const ref = designRef(context.projectId, context.user.uid, "direction");
  return adminDb().runTransaction(async tx => {
    const direction = (await tx.get(ref)).data()?.direction as DesignDirection | undefined;
    if (!direction || direction.revision !== revision) throw new AccessError(409, "현재 설계 방향을 다시 확인해주세요.");
    if (direction.confirmedAt) return direction;
    const confirmed = { ...direction, confirmedAt: new Date().toISOString() };
    tx.set(ref, { direction: confirmed }, { merge: true });
    tx.create(designRef(context.projectId, context.user.uid, `confirmation:${revision}`), { direction: confirmed, userId: context.user.uid, projectId: context.projectId });
    return confirmed;
  });
}
