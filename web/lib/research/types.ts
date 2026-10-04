export type EvidenceSource = "cases" | "research";
export const DEFAULT_SOURCES: EvidenceSource[] = ["cases", "research"];

export type CaseMaterial = { id: string; label: string; title: string; text: string };
export type CaseEvidence = CaseMaterial & {
  sourceId: string;
  relevanceTerms: string[];
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
};
export type EvidenceBundle = {
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
};
export type AnalysisAnswer = {
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
// Small metadata fits the existing step-chat records; abstracts stay transient.
export type AnalysisRecord = {
  selectedSources: EvidenceSource[];
  answer: AnalysisAnswer;
  evidence: Omit<EvidenceBundle, "papers"> & {
    papers: Omit<ResearchPaper, "abstract">[];
  };
};

export function compactEvidence(evidence: EvidenceBundle): AnalysisRecord["evidence"] {
  return { ...evidence, papers: evidence.papers.map(({ abstract, ...paper }) => {
    void abstract;
    return paper;
  }) };
}

// Viewing an answer uses its cited findings, independently of the next question's sources.
export function usedSourceIds(answer: AnalysisAnswer): Set<string> {
  return new Set([...answer.caseFindings, ...answer.researchFindings].flatMap((finding) => finding.sourceIds));
}

export function usedAnswerEvidence(record: AnalysisRecord): AnalysisRecord["evidence"] {
  const used = usedSourceIds(record.answer);
  return {
    ...record.evidence,
    cases: record.evidence.cases.filter((item) => used.has(item.sourceId)),
    papers: record.evidence.papers.filter((item) => used.has(item.sourceId)),
  };
}
