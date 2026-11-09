import { isGeoQuestion, isSpatialInvestigation } from "../spatial/geo-query";
import { parseAnswer } from "./answer";
import { externalSourceUrl } from "./external-cases";
import { wantsNewCases, wantsResearch } from "./routing";
import { usedSourceIds, type EvidenceBundle, type CaseEvidence, type ResearchPaper } from "./types";

// Reuse bounded, already cited source excerpts from this authorized stage history.
// Never accept a client-supplied evidence bundle or promote historical prose to evidence.
export function recentAnswerEvidence(logs: unknown): EvidenceBundle | undefined {
  if (!Array.isArray(logs)) return;
  const cases = new Map<string, CaseEvidence>(), papers = new Map<string, ResearchPaper>();
  for (const log of logs.filter(log => log?.stepId === "data" && log?.analysis).slice(-3).reverse()) {
    try {
      const saved = log.analysis.evidence;
      if (!saved || !Array.isArray(saved.cases) || !Array.isArray(saved.papers)) continue;
      const bundle: EvidenceBundle = { question: "", selectedSources: [], warnings: [],
        cases: saved.cases.slice(0, 12).filter((c: CaseEvidence) => typeof c?.sourceId === "string" && /^C:/.test(c.sourceId) && typeof c.title === "string" && typeof c.text === "string" && (!c.origin || c.origin === "external" && externalSourceUrl(c.url) === c.url)).map((c: CaseEvidence) => ({ ...c, text: c.text.slice(0, 7000) })),
        papers: saved.papers.slice(0, 5).filter((p: ResearchPaper) => typeof p?.openAlexId === "string" && /^https:\/\/openalex\.org\/W\d+$/.test(p.openAlexId) && p.sourceId === `R:${p.openAlexId.split("/").pop()}`).map((p: ResearchPaper) => ({ ...p, abstract: typeof p.evidenceExcerpt === "string" ? p.evidenceExcerpt.slice(0, 2500) : null, usedInAnswer: typeof p.evidenceExcerpt === "string" && !!p.evidenceExcerpt.trim() })),
      };
      // Old records without abstract excerpts cannot support new paper findings.
      // Validate the old answer against its original citation metadata first.
      const original = { ...bundle, papers: bundle.papers.map((p: ResearchPaper) => ({ ...p, usedInAnswer: !!saved.papers.find((old: ResearchPaper) => old.sourceId === p.sourceId)?.usedInAnswer })) };
      const used = usedSourceIds(parseAnswer(JSON.stringify(log.analysis.answer), original));
      for (const c of bundle.cases) if (used.has(c.sourceId) && !cases.has(c.sourceId) && cases.size < 6) cases.set(c.sourceId, c);
      for (const p of bundle.papers) if (used.has(p.sourceId) && p.usedInAnswer && !papers.has(p.sourceId) && papers.size < 5) papers.set(p.sourceId, p);
    } catch { /* Malformed/legacy records are dialogue only, never fresh evidence. */ }
  }
  if (!cases.size && !papers.size) return;
  return { question: "", selectedSources: [...(cases.size ? ["cases" as const] : []), ...(papers.size ? ["research" as const] : [])], cases: [...cases.values()], papers: [...papers.values()], warnings: [] };
}

export function isPlanningFollowUp(question: string): boolean {
  return !wantsNewCases(question) && !wantsResearch(question) && !isSpatialInvestigation(question) && !isGeoQuestion(question)
    && /그럼|그러면|이런\s*방식|(?:이|그)\s*(?:방법|대안|사례)|우리\s*(?:지역|사업).*(?:현실|적합|방법)|\b(?:then|this approach|our (?:area|project))\b/i.test(question);
}
