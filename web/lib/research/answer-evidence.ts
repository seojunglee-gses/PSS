import { answerNarrative, inlineSourceIds, usedSourceIds, type AnalysisRecord } from "./types";

export type AnswerEvidenceItem = {
  key: string;
  sourceIds: string[];
  kind: "research" | "spatial" | "cases" | "project" | "web" | "unknown";
  title: string;
  details: string[];
  excerpts: string[];
  claims: string[];
  links: { label: string; url: string }[];
  caseIds: string[];
  spatial?: AnalysisRecord["spatialContext"];
};

export function evidenceUrl(value: string | null | undefined): string | undefined {
  if (!value) return;
  try { const url = new URL(value); if (url.protocol === "https:" || url.protocol === "http:") return url.href; } catch { /* Missing/invalid legacy links remain unavailable. */ }
}
const clean = (text: string) => text.replace(/\[(?:[CR]:)[^\[\]]+\]/g, "").trim();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

// A display projection of saved evidence only. Never searches, generates, or mutates records.
export function answerEvidenceItems(record: AnalysisRecord): AnswerEvidenceItem[] {
  const answer = record.answer;
  const evidence = record.evidence;
  const used = usedSourceIds(answer);
  const groups = new Map<string, AnswerEvidenceItem>();
  const claimsFor = (id: string) => unique([
    ...[...answer.caseFindings, ...answer.researchFindings].filter(f => f.sourceIds.includes(id)).map(f => clean(f.text)),
    ...answerNarrative(answer).flatMap(text => text.split(/\n+/u).filter(line => inlineSourceIds(line).includes(id)).map(clean)),
  ]);
  const add = (item: AnswerEvidenceItem) => {
    const previous = groups.get(item.key);
    if (!previous) { groups.set(item.key, item); return; }
    for (const field of ["sourceIds", "details", "excerpts", "claims", "caseIds"] as const) previous[field] = unique([...previous[field], ...item[field]]);
    previous.links = [...new Map([...previous.links, ...item.links].map(link => [link.url, link])).values()];
  };
  for (const id of used) {
    const citation = answer.sources.find(source => source.sourceId === id);
    const c = evidence.cases.find(source => source.sourceId === id);
    const paper = evidence.papers.find(source => source.sourceId === id);
    const kind = paper ? "research" : c ? "cases" : citation && ["research", "spatial", "cases", "project", "web"].includes(citation.kind) ? citation.kind as AnswerEvidenceItem["kind"] : "unknown";
    const links: AnswerEvidenceItem["links"] = [];
    const link = (label: string, raw?: string | null) => { const url = evidenceUrl(raw); if (url) links.push({label, url}); };
    link("원문 보기", c?.url ?? citation?.url);
    link("DOI", paper?.doi ?? citation?.doi);
    link("OpenAlex", paper?.openAlexId ?? citation?.openAlexId);
    const key = c ? JSON.stringify(["cases", c.origin ?? "registered", c.id, c.documentId || c.fileName || c.id, c.revisionId ?? "", c.url ?? ""])
      : paper ? `research:${paper.doi || paper.openAlexId || id}`
      : kind === "project" || kind === "spatial" ? kind : `${kind}:${links[0]?.url || id}`;
    add({ key, sourceIds: [id], kind, title: c?.title || paper?.title || citation?.title || id,
      details: unique(c ? [c.documentTitle || "", c.fileName || "", c.publisher || "", c.page ? `p.${c.page}` : c.paragraph ? `문단 ${c.paragraph}` : ""]
        : paper ? [paper.authors?.join(", ") || "", paper.year?.toString() || "", paper.journal || ""]
        : citation ? [citation.authors?.join(", ") || "", citation.year?.toString() || "", citation.publisher || ""] : []),
      excerpts: unique([c?.text || paper?.evidenceExcerpt || ""]), claims: claimsFor(id), links: links.filter((link, index) => links.findIndex(candidate => candidate.url === link.url) === index), caseIds: c ? [c.id] : [] });
  }
  // Preserve the existing project/spatial attachments even without numbered citations.
  if (evidence.projectContext) add({ key: "project", kind: "project", title: "등록된 프로젝트 자료", sourceIds: [], details: [], excerpts: [evidence.projectContext], claims: [], links: [], caseIds: [] });
  if (record.spatialContext) {
    const item = groups.get("spatial");
    if (item) item.spatial = record.spatialContext;
    else add({key: "spatial", kind: "spatial", title: "공간 분석 결과", sourceIds: [], details: [], excerpts: [], claims: [], links: [], caseIds: [], spatial: record.spatialContext});
  }
  return [...groups.values()];
}
