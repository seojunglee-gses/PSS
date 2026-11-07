import { parseSpatialResult } from "../spatial/context";
import { canonicalBuildingContext } from "../spatial/building-use-server";
import type { SpatialResult } from "../spatial/types";
import { searchOpenAlex } from "./openalex";
import { SOURCE_OPTIONS } from "./types";
import { resolveSources, sourceRoutingQuestion,namedCases,wantsImplications } from "./routing";
import { retrieveCasePassages } from "./case-retrieval";
import { conversationHistory } from "../chat-history";
import type { ConversationMessage } from "../chat-history";
import type { CaseEvidence, CaseMaterial, EvidenceBundle, EvidenceSource } from "./types";

export type AnalysisRequest = {
  analysisSession?: import("../analysis-session").AnalysisActivity[];
  facilitationHistory?: ConversationMessage[];
  question: string;
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
  return (matching.length ? matching : ranked).slice(0, 4);
}

export async function retrieveEvidence(request: AnalysisRequest): Promise<EvidenceBundle> {
  const evidence: EvidenceBundle = { question: request.question, selectedSources: request.selectedSources, cases: [], papers: [], warnings: [] };
  if (request.selectedSources.includes("project")) {
    if (request.projectContext.trim()) evidence.projectContext = request.projectContext;
    else evidence.warnings.push({ source: "project", message: "이 사업에 등록된 자료가 없습니다." });
  }
  if (request.selectedSources.includes("spatial") && !request.spatialContext && !request.registeredSpatialContext?.registeredLayers.length) evidence.warnings.push({ source: "spatial", message: "공간 분석 결과가 없습니다. 공간 분석에서 질문에 필요한 분석을 먼저 실행해주세요." });
  let researchQuery=request.searchQuestion ?? request.question;
  let needsResearch=request.selectedSources.includes('research');
  const focused=namedCases(request.searchQuestion ?? request.question,request.cases,request.history);
  const caseFactsOnly=request.casePassages!==undefined&&focused.length>0&&!wantsImplications(request.question)&&!/논문|연구|학술|일반|\b(?:research|stud(?:y|ies)|literature)\b/i.test(request.question);
  if (request.selectedSources.includes("cases")) {
    evidence.cases = selectCases(request.searchQuestion ?? request.question, focused.length?request.cases.filter(item=>focused.some(c=>c.id===item.id)):request.cases);
    if(request.casePassages!==undefined&&(request.casePassages.length>0||namedCases(request.question,request.cases,request.history).length>0)){
      const selected=await retrieveCasePassages(request,request.casePassages,evidence.cases);evidence.cases=selected.cases;
      needsResearch=!!selected.researchQuery;researchQuery=selected.researchQuery;
      if(needsResearch&&!request.selectedSources.includes('research'))request.selectedSources.push('research');
      if(needsResearch&&caseFactsOnly&&!focused.some(c=>researchQuery.toLowerCase().includes(c.title.toLowerCase())))researchQuery=`${focused.map(c=>c.title).join(' ')} ${researchQuery}`.slice(0,350);
    }
    if (!evidence.cases.length) evidence.warnings.push({ source: "cases", message: "No substantive case-study materials are available for this project." });
  }
  if (needsResearch) {
    try {
      evidence.papers = await searchOpenAlex(researchQuery, request.provider, request.projectContext);
      if(caseFactsOnly){
        const normalized=(value:string)=>value.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
        evidence.papers=evidence.papers.filter(p=>focused.some(c=>[c.title,...(c.aliases??[])].some(name=>normalized(name).length>=4&&normalized(`${p.title} ${p.abstract??''}`).includes(normalized(name)))));
      }
      if (!evidence.papers.length) evidence.warnings.push({ source: "research", message: "No relevant research papers were found. Try a more specific question." });
      else if (!evidence.papers.some((paper) => paper.abstract)) evidence.warnings.push({ source: "research", message: "The retrieved papers have no available abstracts; research findings cannot be inferred from titles alone." });
    } catch (error) {
      evidence.warnings.push({ source: "research", message: error instanceof Error ? error.message : "Research search failed." });
    }
  }
  return evidence;
}
