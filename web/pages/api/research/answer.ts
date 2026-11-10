import { isSelectedPlaceDiscussion } from "../../../lib/spatial/geo-query";
import { isPlanningFollowUp, recentAnswerEvidence } from "../../../lib/research/follow-up";
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
import { namedCases,resolveSources,sourceRoutingQuestion, wantsNewCases, wantsResearch } from "../../../lib/research/routing";
import { readCasePassages } from "../../../lib/research/case-sources-server";

export const config = { api: { bodyParser: { sizeLimit: "128kb" } } };
export const maxDuration = 120;
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "Method not allowed" }); return; }
  let request;
  try { request = parseAnalysisRequest(req.body); }
  catch { res.status(400).json({ error: "질문과 선택한 자료를 확인해 주세요. 질문은 1~2000자로 입력할 수 있습니다." }); return; }
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
    const automatic = !Array.isArray(req.body.selectedSources) || !req.body.selectedSources.length;
    if (automatic && wantsResearch(request.question) && !wantsNewCases(request.question)) {
      // A referential effects question should not repeat the anchor's case search.
      request.selectedSources = ["research"];
      if (/이런|이러한|그런|이\s*방법|그\s*방법|이\s*방식|this|that/i.test(request.question)) {
        const recent = request.history?.filter(message => message.role === "assistant").slice(-1)[0]?.content;
        if (recent) request.searchQuestion = `${request.question}\n앞서 논의한 방법: ${recent.slice(0, 1800)}`;
      }
    }
    if (automatic && isPlanningFollowUp(request.question)) {
      const previous = recentAnswerEvidence(context.stageHistory);
      if (previous) {
        request.reuseEvidence = previous;
        request.searchQuestion = request.question;
        request.selectedSources = [...new Set(["project" as const, ...previous.selectedSources, ...(isSelectedPlaceDiscussion(request.question) ? ["spatial" as const] : [])])];
      }
    }
    if (automatic && isSelectedPlaceDiscussion(request.question) && !request.selectedSources.includes("spatial")) request.selectedSources.push("spatial");
    request.analysisSession=analysisSessionContext(context.stageHistory,context.projectId,context.cases,request.selectedSources);
    if(request.selectedSources.includes("spatial") && !request.spatialContext && !isSelectedPlaceDiscussion(request.question))request.spatialContext=canonicalBuildingContext([...activities].reverse().find(a=>a.type==="spatial")?.result);
    if(request.selectedSources.includes("spatial")) {
      const data=context.spatialData??await projectLayers(context.user,context.projectId);
      request.registeredSpatialContext=spatialPromptContext(data.layers,req.body.spatialSelection,activities,!!data.boundary,{nearbyPlaces:!!data.boundary&&!!process.env.KAKAO_REST_API_KEY,priority:!!data.priority,boundary:data.boundary});
    }
    if(request.selectedSources.includes('cases') && !request.reuseEvidence){
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
    res.status(502).json({ error: "찾은 자료를 바탕으로 답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", evidence: compactEvidence(evidence) });
  }
}
