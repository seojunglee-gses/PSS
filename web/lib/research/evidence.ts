import { parseSpatialResult } from "../spatial/context";
import type { SpatialResult } from "../spatial/types";
import { searchOpenAlex } from "./openalex";
import { DEFAULT_SOURCES } from "./types";
import type { CaseEvidence, CaseMaterial, EvidenceBundle, EvidenceSource } from "./types";

export type AnalysisRequest = {
  question: string;
  spatialContext?: SpatialResult;
  selectedSources: EvidenceSource[];
  cases: CaseMaterial[];
  projectContext: string;
  provider: "openai" | "gemini" | "deepseek";
};

export function parseAnalysisRequest(body: unknown): AnalysisRequest {
  if (!body || typeof body !== "object") throw new Error("A question is required.");
  const input = body as Record<string, unknown>;
  if (typeof input.question !== "string" || !input.question.trim() || input.question.length > 2000) throw new Error("Enter a question of 1–2000 characters.");
  if (input.selectedSources !== undefined && (!Array.isArray(input.selectedSources) || input.selectedSources.some((s) => s !== "cases" && s !== "research"))) throw new Error("Invalid evidence sources.");
  if (input.cases !== undefined && (!Array.isArray(input.cases) || input.cases.length > 20)) throw new Error("Invalid case materials.");
  const cases: CaseMaterial[] = ((input.cases ?? []) as unknown[]).map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid case materials.");
    const c = item as Record<string, unknown>;
    if (["id", "label", "title", "text"].some((key) => typeof c[key] !== "string") || (c.text as string).length > 20000) throw new Error("Invalid case materials.");
    return { id: (c.id as string).slice(0, 100), label: (c.label as string).slice(0, 200), title: (c.title as string).slice(0, 300), text: (c.text as string).slice(0, 6000) };
  });
  const selected = (input.selectedSources ?? []) as EvidenceSource[];
  return {
    question: input.question.trim(),
    spatialContext: parseSpatialResult(input.spatialContext),
    selectedSources: selected.length ? [...new Set(selected)] : [...DEFAULT_SOURCES],
    cases,
    projectContext: typeof input.projectContext === "string" ? input.projectContext.slice(0, 4000) : "",
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
  if (request.selectedSources.includes("cases")) {
    evidence.cases = selectCases(request.question, request.cases);
    if (!evidence.cases.length) evidence.warnings.push({ source: "cases", message: "No substantive case-study materials are available for this project." });
  }
  if (request.selectedSources.includes("research")) {
    try {
      evidence.papers = await searchOpenAlex(request.question);
      if (!evidence.papers.length) evidence.warnings.push({ source: "research", message: "No relevant research papers were found. Try a more specific question." });
      else if (!evidence.papers.some((paper) => paper.abstract)) evidence.warnings.push({ source: "research", message: "The retrieved papers have no available abstracts; research findings cannot be inferred from titles alone." });
    } catch (error) {
      evidence.warnings.push({ source: "research", message: error instanceof Error ? error.message : "Research search failed." });
    }
  }
  return evidence;
}
