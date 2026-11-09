import type { SpatialResult } from "../spatial/types";
export type EvidenceSource = "project" | "spatial" | "cases" | "research";
export const SOURCE_OPTIONS: EvidenceSource[] = ["project", "spatial", "cases", "research"];
// Empty selection means automatic routing, not searching every source.
export const DEFAULT_SOURCES: EvidenceSource[] = [];

export type CaseMaterial = { id: string; label: string; title: string; text: string; aliases?: string[] };
export type CaseSourceMeta = { sourceId:string;caseId:string;title:string;fileName:string;revisionId:string;uploadedAt:string;passageCount:number };
export type CasePassage = { passageId:string;text:string;page?:number;paragraph:number };
export type CaseEvidence = CaseMaterial & {
  sourceId: string;
  relevanceTerms: string[];
  origin?: "external"; url?: string; publisher?: string; evidenceLevel?: "page" | "preview"; retrievedAt?: string;
  documentId?: string; documentTitle?:string; fileName?:string; revisionId?:string; passageId?:string; page?:number; paragraph?:number;
};
export type ResearchPaper = {
  sourceId: string;
  openAlexId: string;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  doi: string | null;
  journal: string | null;
  citationCount: number;
  openAccess: boolean | null;
  topics: string[];
  usedInAnswer: boolean;
  evidenceExcerpt?: string;
};
export type EvidenceBundle = {
  projectContext?: string;
  question: string;
  selectedSources: EvidenceSource[];
  cases: CaseEvidence[];
  papers: ResearchPaper[];
  warnings: { source: EvidenceSource; message: string }[];
};
export type Finding = { text: string; sourceIds: string[] };
export type EvidenceCitation = {
  sourceId: string;
  kind: EvidenceSource;
  title: string;
  authors: string[];
  year: number | null;
  openAlexId: string | null;
  doi: string | null;
  citationCount: number | null;
  origin?: "external"; url?: string; publisher?: string;
};
export type AnalysisAnswer = {
  format?: 'direct';
  summary: string;
  caseFindings: Finding[];
  researchFindings: Finding[];
  agreement: string;
  differences: string;
  integratedInterpretation: string;
  projectImplications: string[];
  limitations: string;
  sources: EvidenceCitation[];
};
// Keep bounded abstract excerpts for grounded follow-ups; full abstracts stay transient.
export type AnalysisRecord = {
  spatialContext?: SpatialResult;
  selectedSources: EvidenceSource[];
  answer: AnalysisAnswer;
  evidence: Omit<EvidenceBundle, "papers"> & {
    papers: Omit<ResearchPaper, "abstract">[];
  };
};

export function compactEvidence(evidence: EvidenceBundle): AnalysisRecord["evidence"] {
  return { ...evidence, papers: evidence.papers.map(({ abstract, ...paper }) => {
    void abstract;
    return { ...paper, ...(abstract ? { evidenceExcerpt: abstract.slice(0, 2500) } : {}) };
  }) };
}

// Viewing an answer uses its cited findings, independently of the next question's sources.
export function inlineSourceIds(text: string): string[] {
  return [...text.matchAll(/\[((?:[CR]:)[^\[\]]+)\]/g)]
    .flatMap((match) => match[1].split(/\s*[,;]\s*/).map((id) => id.trim()));
}

export function answerNarrative(answer: AnalysisAnswer): string[] {
  return [answer.summary, answer.agreement, answer.differences, answer.integratedInterpretation, ...answer.projectImplications, answer.limitations];
}

export function usedSourceIds(answer: AnalysisAnswer): Set<string> {
  return new Set([
    ...[...answer.caseFindings, ...answer.researchFindings].flatMap((finding) => finding.sourceIds),
    ...answerNarrative(answer).flatMap(inlineSourceIds),
  ]);
}

export function usedAnswerEvidence(record: AnalysisRecord): AnalysisRecord["evidence"] {
  const used = usedSourceIds(record.answer);
  return {
    ...record.evidence,
    cases: record.evidence.cases.filter((item) => used.has(item.sourceId)),
    papers: record.evidence.papers.filter((item) => used.has(item.sourceId)),
  };
}
