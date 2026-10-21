import type { NextApiRequest } from "next";
import { adminDb, verifyUserRequest } from "./firebaseAdmin";
import { AccessError, memberActive, memberPath, validProjectId } from "./membership/server";
import { canManageProject } from "./rbac";
import type { ProjectMeta } from "./projects";
import { parseSections } from "./content-format";

export async function loadProjectContext(req: NextApiRequest, stage: string) {
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
  const [background, summary] = await Promise.all([
    db.doc(`ppssBackgroundKnowledge_${projectId}/current`).get(),
    db.doc(`ppssWorkspaceSummaries_${projectId}/${user.uid}`).get(),
  ]);
  const content = project.workspaceContent;
  const plain = (text: unknown = "") => parseSections(typeof text === "string" ? text : "").map((part) => part.text.replace(/\*\*/g, "")).join("\n\n");
  const current = content?.[stage as keyof typeof content];
  const currentMaterial = [project.projectName, current && typeof current === "object" && "title" in current ? current.title : "", plain(typeof current === "string" ? current : current?.text), stage !== "problem" ? plain(typeof content?.problem === "string" ? content.problem : content?.problem?.text) : "", background.data()?.curatedText].filter(Boolean).join("\n\n");
  const stages = ["problem", "data", "alternatives", "evaluation", "report"];
  const previousSummaries = Object.fromEntries(Object.entries(summary.data()?.stageSummaries ?? {}).filter(([key, value]) => stages.indexOf(key) >= 0 && stages.indexOf(key) < stages.indexOf(stage) && typeof value === "string"));
  return { projectId, user, project, currentMaterial, previousSummaries,
    cases: (Array.isArray(content?.data?.cases) ? content.data.cases : []).filter((c) => c && typeof c.id === "string" && typeof c.text === "string").map((c) => ({ id: c.id, label: c.label, title: c.title, text: plain(c.text) })) };
}
