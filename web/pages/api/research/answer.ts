import { spatialPromptContext } from "../../../lib/spatial/context";
import { projectLayers } from "../../../lib/spatial/geo-server";
import { canonicalBuildingContext } from "../../../lib/spatial/building-use-server";
import { analysisActivities, analysisSessionContext, analysisSessionQuestion, isPaperReference } from "../../../lib/analysis-session";
import { clarificationExchange } from "../../../lib/chat-history";
import {policyHistory} from "../../../lib/facilitation";
import { loadProjectContext } from "../../../lib/project-context-server";
import { AccessError } from "../../../lib/membership/server";
import type { NextApiRequest, NextApiResponse } from "next";
import { parseAnalysisRequest, retrieveEvidence } from "../../../lib/research/evidence";
import { answerFromEvidence, answerText } from "../../../lib/research/answer";
import { compactEvidence } from "../../../lib/research/types";
import { namedCases,resolveSources,sourceRoutingQuestion, wantsNewCases } from "../../../lib/research/routing";
import { readCasePassages } from "../../../lib/research/case-sources-server";

export const config = { api: { bodyParser: { sizeLimit: "128kb" } } };
export const maxDuration = 60;
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "Method not allowed" }); return; }
  let request;
  try { request = parseAnalysisRequest(req.body); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request." }); return; }
  try {
    const context = await loadProjectContext(req, "data", true, true);
    request.projectContext = context.currentMaterial;
    request.authorizedProjectId=context.projectId;
    request.hasBackground=context.hasBackground;
    request.backgroundSourceIds=context.backgroundSourceIds;
    request.previousSummaries = context.previousSummaries;
    request.cases = context.cases;
    const activities=analysisActivities(context.stageHistory,context.projectId);
    request.searchQuestion=clarificationExchange(request.question,request.history)?sourceRoutingQuestion(request.question,request.history??[]):analysisSessionQuestion(request.question,activities,context.cases);
    const contextual=request.searchQuestion!==request.question;
    if(!contextual)request.searchQuestion=sourceRoutingQuestion(request.question,request.history??[]);
    if(!Array.isArray(req.body.selectedSources)||!req.body.selectedSources.length)request.selectedSources=resolveSources(request.searchQuestion,[],context.cases,contextual?[]:request.history);
    if (isPaperReference(request.question)) {
      const paper = [...activities].reverse().find(activity => activity.type === "research" && /^https:\/\/openalex\.org\/W\d+$/.test(activity.referenceId));
      if (paper) request.selectedPaperId = paper.referenceId;
    }
    request.analysisSession=analysisSessionContext(context.stageHistory,context.projectId,context.cases,request.selectedSources);
    if(request.selectedSources.includes("spatial") && !request.spatialContext)request.spatialContext=canonicalBuildingContext([...activities].reverse().find(a=>a.type==="spatial")?.result);
    if(request.selectedSources.includes("spatial")) {
      const data=context.spatialData??await projectLayers(context.user,context.projectId);
      request.registeredSpatialContext=spatialPromptContext(data.layers,req.body.spatialSelection,activities,!!data.boundary,{nearbyPlaces:!!data.boundary&&!!process.env.KAKAO_REST_API_KEY,priority:!!data.priority});
    }
    if(request.selectedSources.includes('cases')){
      const focused=namedCases(request.searchQuestion,context.cases,contextual?[]:request.history);
      request.casePassages=await readCasePassages(context.projectId,!wantsNewCases(request.question)&&focused.length?focused:context.cases);
    }
    request.facilitationHistory=policyHistory(context.stageHistory);
  } catch (error) { res.status(error instanceof AccessError ? error.status : 503).json({ error: error instanceof AccessError ? error.message : "사업 자료를 불러오지 못했습니다." }); return; }
  // Retrieve on the server, not from client-provided paper claims or URLs.
  const evidence = await retrieveEvidence(request);
  try {
    const answer = await answerFromEvidence(request, evidence);
    res.status(200).json({ reply: answerText(answer), analysis: { selectedSources: request.selectedSources, ...(request.spatialContext ? { spatialContext: request.spatialContext } : {}), answer, evidence: compactEvidence(evidence) } });
  } catch {
    res.status(502).json({ error: "Unable to synthesize the retrieved evidence. Check the selected AI provider configuration or try again.", evidence: compactEvidence(evidence) });
  }
}
