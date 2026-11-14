import {backgroundOriginalContext,needsBackgroundOriginal} from "./background-sources-server";
import { requestClarification } from "../facilitation";
import { parseSpatialResult } from "../spatial/context";
import { canonicalBuildingContext } from "../spatial/building-use-server";
import type { SpatialResult } from "../spatial/types";
import { searchExternalCases } from "./external-cases";
import { searchOpenAlex, readOpenAlexPaper } from "./openalex";
import { SOURCE_OPTIONS } from "./types";
import { resolveSources, sourceRoutingQuestion,namedCases,wantsImplications,wantsResearch,wantsNewCases } from "./routing";
import { retrieveCasePassages } from "./case-retrieval";
import { conversationHistory } from "../chat-history";
import type { ConversationMessage } from "../chat-history";
import type { CaseEvidence, CaseMaterial, EvidenceBundle, EvidenceSource } from "./types";

export type AnalysisRequest = {
  topicSelection?: boolean;
  continuityContext?: string;
  analysisSession?: import("../analysis-session").AnalysisActivity[];
  facilitationHistory?: ConversationMessage[];
  question: string;
  reuseEvidence?: EvidenceBundle;
  authorizedProjectId?: string;
  hasBackground?: boolean;
  backgroundSourceIds?: string[];
  clarification?: string;
  retrievalWarnings?: EvidenceBundle["warnings"];
  spatialQueryResult?: Pick<import("../spatial/geo-query").GeoResult, "reply" | "places" | "warnings">;
  history?: ConversationMessage[];
  searchQuestion?: string;
  spatialContext?: SpatialResult;
  registeredSpatialContext?: import("../spatial/context").SpatialPromptContext;
  selectedSources: EvidenceSource[];
  cases: CaseMaterial[];
  projectContext: string;
  previousSummaries?: Record<string, unknown>;
  provider: "openai" | "gemini" | "deepseek";
  casePassages?: CaseEvidence[];
  selectedPaperId?: string;
};

export function parseAnalysisRequest(body: unknown): AnalysisRequest {
  if (!body || typeof body !== "object") throw new Error("A question is required.");
  const input = body as Record<string, unknown>;
  if (typeof input.question !== "string" || !input.question.trim() || input.question.length > 2000) throw new Error("Enter a question of 1–2000 characters.");
  if (input.selectedSources !== undefined && (!Array.isArray(input.selectedSources) || input.selectedSources.some((s) => !SOURCE_OPTIONS.includes(s as EvidenceSource)))) throw new Error("Invalid evidence sources.");
  if (input.cases !== undefined && (!Array.isArray(input.cases) || input.cases.length > 20)) throw new Error("Invalid case materials.");
  const cases: CaseMaterial[] = ((input.cases ?? []) as unknown[]).map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid case materials.");
    const c = item as Record<string, unknown>;
    if (["id", "label", "title", "text"].some((key) => typeof c[key] !== "string") || (c.text as string).length > 20000) throw new Error("Invalid case materials.");
    return { id: (c.id as string).slice(0, 100), label: (c.label as string).slice(0, 200), title: (c.title as string).slice(0, 300), text: (c.text as string).slice(0, 6000) };
  });
  const selected = (input.selectedSources ?? []) as EvidenceSource[];
  const history = conversationHistory(input.history);
  const searchQuestion = sourceRoutingQuestion(input.question.trim(), history);
  const sources = resolveSources(searchQuestion, selected);
  return {
    question: input.question.trim(),
    history,
    searchQuestion,
    spatialContext: sources.includes("spatial") ? canonicalBuildingContext(parseSpatialResult(input.spatialContext)) : undefined,
    selectedSources: sources,
    cases,
    projectContext: typeof input.projectContext === "string" ? input.projectContext.slice(0, 60000) : "",
    provider: typeof input.provider === "string" && input.provider.toLowerCase() === "gemini" ? "gemini" :
      typeof input.provider === "string" && input.provider.toLowerCase() === "deepseek" ? "deepseek" : "openai",
  };
}

export function selectCases(question: string, cases: CaseMaterial[]): CaseEvidence[] {
  const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
  const stopwords = new Set(["the", "and", "for", "how", "what", "can", "with", "are", "this", "from", "should", "does"]);
  const queryTerms = terms.filter((term) => !stopwords.has(term));
  const ranked = cases.filter((c) => c.text.trim() && !/^(Describe key|Summarize major|Capture transferable)/.test(c.text.trim()))
    .map((c, index) => ({ ...c, sourceId: `C:${index + 1}`, relevanceTerms: queryTerms.filter((term) => `${c.title} ${c.label} ${c.text}`.toLowerCase().includes(term)) }))
    .sort((a, b) => b.relevanceTerms.length - a.relevanceTerms.length);
  const matching = ranked.filter((c) => c.relevanceTerms.length);
  // A lexical miss is explicitly a contextual comparison, not a relevance claim.
  return (matching.length ? matching : wantsNewCases(question) ? [] : ranked).slice(0, 4);
}

export async function retrieveEvidence(request: AnalysisRequest): Promise<EvidenceBundle> {
  const evidence: EvidenceBundle = { question: request.question, selectedSources: request.selectedSources, cases: [], papers: [], warnings: [...(request.retrievalWarnings ?? [])] };
  request.clarification??=requestClarification(request.searchQuestion??request.question,request.history,request.projectContext,/[가-힣]/.test(request.question)?"ko":"en");
  if(request.clarification)return evidence;
  // Topic selections already carry server-verified local material; do not fan out into searches.
  if(request.topicSelection&&request.reuseEvidence)return {...request.reuseEvidence,question:request.question};
  if (request.selectedSources.includes("project")) {
    let projectMaterial=request.projectContext;
    if(request.authorizedProjectId&&request.hasBackground&&needsBackgroundOriginal(request.searchQuestion??request.question)){
      try {
        const original=await backgroundOriginalContext(request.authorizedProjectId,request.searchQuestion??request.question,request.backgroundSourceIds);
        if(original.text)projectMaterial+='\n\n'+original.text;
        evidence.warnings.push(...original.warnings.map(message=>({source:"project" as const,message})));
      } catch {
        evidence.warnings.push({source:'project',message:'프로젝트 원문 자료를 불러오지 못했어요. 현재 등록된 사업 설명을 바탕으로 대화를 이어갈게요.'});
      }
    }
    if (projectMaterial.trim()) evidence.projectContext = projectMaterial;
    else evidence.warnings.push({ source: "project", message: "이 사업에 등록된 자료가 없습니다." });
  }
  if (request.selectedSources.includes("spatial") && !request.spatialContext && !request.registeredSpatialContext?.registeredLayers.length) evidence.warnings.push({ source: "spatial", message: "현재 질문에 사용할 공간 계산 결과가 아직 없습니다. 실행되지 않은 값을 사실로 제시하지 마세요." });
  if (request.reuseEvidence) {
    return { ...request.reuseEvidence, question: request.question, selectedSources: request.selectedSources, projectContext: evidence.projectContext ?? request.projectContext, warnings: evidence.warnings };
  }
  let researchQuery=request.searchQuestion ?? request.question;
  let needsResearch=request.selectedSources.includes('research');
  const discovery=wantsNewCases(request.question);
  const explicitResearch=wantsResearch(request.question) || request.selectedSources.includes("research");
  const focused=discovery?[]:namedCases(request.searchQuestion ?? request.question,request.cases,request.history);
  const caseFactsOnly=request.casePassages!==undefined&&focused.length>0&&!wantsImplications(request.question)&&!/논문|연구|학술|일반|\b(?:research|stud(?:y|ies)|literature)\b/i.test(request.question);
  if (request.selectedSources.includes("cases")) {
    evidence.cases = selectCases(request.searchQuestion ?? request.question, focused.length?request.cases.filter(item=>focused.some(c=>c.id===item.id)):request.cases);
    if(request.casePassages!==undefined&&(request.casePassages.length>0||namedCases(request.question,request.cases,request.history).length>0||discovery&&request.cases.length>0)){
      const bodies = discovery ? request.cases.map((material,index)=>({...material,sourceId:`C:${index+1}`,relevanceTerms:[]})) : evidence.cases;
      const selected=await retrieveCasePassages(request,request.casePassages,bodies);evidence.cases=selected.cases;
      needsResearch=explicitResearch || (!discovery && !!selected.researchQuery);researchQuery=selected.researchQuery || request.searchQuestion || request.question;
      if(needsResearch&&!request.selectedSources.includes('research'))request.selectedSources.push('research');
      if(needsResearch&&caseFactsOnly&&!focused.some(c=>researchQuery.toLowerCase().includes(c.title.toLowerCase())))researchQuery=`${focused.map(c=>c.title).join(' ')} ${researchQuery}`.slice(0,350);
    }
    // Explicit requests for new examples reach the web even when a registered case matches.
    // A substantive unmatched case-comparison gap can use the same path.
    if (discovery || (!evidence.cases.length && wantsImplications(request.question) && !explicitResearch)) {
      try {
        const external = await searchExternalCases(request);
        evidence.cases.push(...external);
        if (!external.length) evidence.warnings.push({ source: "cases", message: "이번 외부 검색에서 요청 조건에 맞는 실제 사례를 확인하지 못했습니다. 확인된 자료와 조건부 계획 판단을 구분해 설명합니다." });
      } catch {
        evidence.warnings.push({ source: "cases", message: "외부 사례 검색을 완료하지 못했습니다. 확인하지 못한 사례나 성과를 사실로 제시하지 않습니다." });
      }
    }
    if (!evidence.cases.length && !discovery) evidence.warnings.push({ source: "cases", message: "현재 질문에 맞는 등록 사례 근거를 확인하지 못했습니다." });
  }
  if (needsResearch) {
    try {
      evidence.papers = request.selectedPaperId ? await readOpenAlexPaper(request.selectedPaperId) : await searchOpenAlex(researchQuery, request.provider, request.projectContext);
      if(caseFactsOnly){
        const normalized=(value:string)=>value.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
        evidence.papers=evidence.papers.filter(p=>focused.some(c=>[c.title,...(c.aliases??[])].some(name=>normalized(name).length>=4&&normalized(`${p.title} ${p.abstract??''}`).includes(normalized(name)))));
      }
      if (!evidence.papers.length) evidence.warnings.push({ source: "research", message: "이번 검색에서 질문에 맞는 연구논문을 찾지 못했습니다." });
      else if (!evidence.papers.some((paper) => paper.abstract)) evidence.warnings.push({ source: "research", message: "검색된 논문에 공개 초록이 없어 제목만으로 연구 결과를 판단할 수 없습니다." });
    } catch (error) {
      const message = error instanceof Error && /^[가-힣\s.,]+$/.test(error.message) ? error.message : "연구논문 검색을 완료하지 못했습니다. 현재 확인된 자료를 바탕으로 답변합니다.";
      evidence.warnings.push({ source: "research", message });
    }
  }
  return evidence;
}
