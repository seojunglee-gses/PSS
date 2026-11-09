import { loadProjectContext } from "../../../lib/project-context-server";
import { AccessError } from "../../../lib/membership/server";
import type { NextApiRequest, NextApiResponse } from "next";
import { parseAnalysisRequest, retrieveEvidence } from "../../../lib/research/evidence";

export const config = { api: { bodyParser: { sizeLimit: "128kb" } } };
export const maxDuration = 120;
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "Method not allowed" }); return; }
  let request;
  try { request = parseAnalysisRequest(req.body); }
  catch { res.status(400).json({ error: "질문과 선택한 자료를 확인해 주세요. 질문은 1~2000자로 입력할 수 있습니다." }); return; }
  try {
    const context = await loadProjectContext(req, "data");
    request.projectContext = context.currentMaterial;
    request.authorizedProjectId=context.projectId;
    request.hasBackground=context.hasBackground;
    request.backgroundSourceIds=context.backgroundSourceIds;
    request.previousSummaries = context.previousSummaries;
    request.cases = context.cases;
  } catch (error) { res.status(error instanceof AccessError ? error.status : 503).json({ error: error instanceof AccessError ? error.message : "사업 자료를 불러오지 못했습니다." }); return; }
  res.status(200).json({ evidence: await retrieveEvidence(request) });
}
