import { reviewContext } from "./spatial/analysis-review";
import type { NextApiRequest } from "next";
import { adminDb, verifyUserRequest } from "./firebaseAdmin";
import { AccessError, memberActive, memberPath, validProjectId } from "./membership/server";
import { canManageProject } from "./rbac";
import type { ProjectMeta } from "./projects";
import { parseSections } from "./content-format";

export async function loadProjectContext(req: NextApiRequest, stage: string, includePrivateReview=true, includeStageHistory=false) {
  if(!["problem","data","alternatives","evaluation","report"].includes(stage))throw new AccessError(400,"단계를 확인해주세요.");
  const projectId = validProjectId(req.body?.projectId);
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AccessError(401, "로그인이 필요합니다.");
  let user;
  try { user = await verifyUserRequest(header.slice(7)); }
  catch { throw new AccessError(401, "로그인 상태를 확인해주세요."); }
  const db = adminDb();
  const snapshot = await db.doc(`ppssProjects/${projectId}`).get();
  if (!snapshot.exists) throw new AccessError(404, "사업을 찾을 수 없습니다.");
  const project = snapshot.data() as ProjectMeta;
  if (!canManageProject(user.email, project) && !memberActive((await db.doc(memberPath(user.uid, projectId)).get()).data())) throw new AccessError(403, "이 사업의 자료를 볼 권한이 없습니다.");
  const [background, summary, privateData] = await Promise.all([
    db.doc(`ppssBackgroundKnowledge_${projectId}/current`).get(),
    db.doc(`ppssWorkspaceSummaries_${projectId}/${user.uid}`).get(),
    includePrivateReview&&["data","alternatives","evaluation","report"].includes(stage)?db.doc(`users_${projectId}/${user.uid}/steps/data`).get():Promise.resolve(undefined),
  ]);
  const content = project.workspaceContent;
  const plain = (text: unknown = "") => parseSections(typeof text === "string" ? text : "").map((part) => part.text.replace(/\*\*/g, "")).join("\n\n");
  const current = content?.[stage as keyof typeof content];
  const ownReview=reviewContext(privateData?.data()?.analysisReview);
  let currentMaterial = [project.projectName, current && typeof current === "object" && "title" in current ? current.title : "", plain(typeof current === "string" ? current : current?.text), stage !== "problem" ? plain(typeof content?.problem === "string" ? content.problem : content?.problem?.text) : "", background.data()?.curatedText,ownReview].filter(Boolean).join("\n\n");
  let spatialData: Awaited<ReturnType<typeof import("./spatial/geo-server").projectLayers>> | undefined;
  if(stage==="data"&&req.body?.spatialSelection?.selected){
    const {parseGeoContext,representativePoint,featureNames}=await import('./spatial/geo-query');
    const {featureKey}=await import('./spatial/engine');
    const {projectLayers}=await import('./spatial/geo-server');
    const selection=parseGeoContext(req.body.spatialSelection).selected!;
    spatialData=await projectLayers(user,projectId);
    const {layers}=spatialData;
    const layer=layers.find(l=>l.config.id===selection.layerId),feature=layer?.data.features.find((f,i)=>featureKey(f,i)===selection.featureId);
    if(!layer||!feature)throw new AccessError(409,"gis.selectionChanged");
    currentMaterial+='\nCurrent map selection from authorized project dataset (location only; no inference of safety, demand, accessibility or consensus): '+JSON.stringify({dataset:layer.config.id,featureId:selection.featureId,name:featureNames(feature)[0]??layer.config.label,...representativePoint(feature)});
  }
  const stages = ["problem", "data", "alternatives", "evaluation", "report"];
  const previousSummaries = Object.fromEntries(Object.entries(summary.data()?.stageSummaries ?? {}).filter(([key, value]) => stages.indexOf(key) >= 0 && stages.indexOf(key) < stages.indexOf(stage) && typeof value === "string"));
  const prior=stages.slice(0,Math.max(0,stages.indexOf(stage)));
  const confirmed=prior.length?(await db.doc(`users_${projectId}/${user.uid}`).get()).data()?.confirmedStageSummaries??{}:{};
  prior.forEach(id=>{const text=confirmed[id]?.text;if(typeof text==='string'&&text.trim())previousSummaries[id]=text.slice(0,12000);});
  const savedDialogue=includeStageHistory?(stage==='data'?privateData:await db.doc(`users_${projectId}/${user.uid}/steps/${stage}`).get()):undefined;
  const stageHistory=Array.isArray(savedDialogue?.data()?.logs)?savedDialogue!.data()!.logs:[];

  if (typeof req.body?.continuityTopicId === 'string') {
    const {previousStage,topicContext}=await import('./stage-topics');
    const priorStage=previousStage(stage);
    if(priorStage){
      const {readStageTopics}=await import('./stage-topics-server');
      const topic=(await readStageTopics(projectId,user.uid,priorStage)).find(topic=>topic.id===req.body.continuityTopicId);
      if(!topic)throw new AccessError(409,'선택한 이전 논의 주제를 다시 확인해주세요.');
      currentMaterial+='\n'+topicContext(topic,stage);
    }
  }

  const backgroundSourceIds=Array.isArray(background.data()?.sourceIds)?background.data()!.sourceIds.filter((id:unknown):id is string=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(id)).slice(0,10):undefined;
  return { projectId, user, project, currentMaterial, hasBackground:background.exists, backgroundSourceIds, previousSummaries, stageHistory, spatialData,
    cases: (Array.isArray(content?.data?.cases) ? content.data.cases : []).filter((c) => c && typeof c.id === "string" && typeof c.text === "string").map((c) => ({ id: c.id, label: c.label, title: c.title, text: plain(c.text), ...(Array.isArray(c.aliases)?{aliases:c.aliases.filter((a):a is string=>typeof a==='string').slice(0,20)}:{}) })) };
}
