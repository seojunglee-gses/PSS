import type { EvidenceSource } from "./types";

export function resolveSources(question: string, selected: EvidenceSource[] = []): EvidenceSource[] {
  if (selected.length) return [...new Set(selected)];
  const cases = /사례|비슷한\s*(지역|도시|사업)|다른\s*도시|어떻게\s*했|case\s*stud|\bcases?\b|similar\s*(area|city|cities|project)/i.test(question);
  const research = /논문|연구|학술|검증|선행연구|literature|\bstud(?:y|ies)\b|\bresearch\b|\bevidence\b/i.test(question) || (!cases && /효과|effect|impact/i.test(question));
  const spatial = /도로\s*폭|면적|필지|건물|토지\s*이용|거리|위치|경계|인구|녹지|접근성|버퍼|시설|GIS|공간\s*분석|road\s*width|\barea\b|parcel|building|land\s*use|distance|location|boundary|population/i.test(question);
  const project = /프로젝트\s*자료|사업\s*자료|대상지\s*자료|사업\s*(배경|목표)|project\s*(data|material|context)/i.test(question);
  const result: EvidenceSource[] = [];
  // Academic questions about spatial topics need literature, not an unsolicited GIS lookup.
  if (project || (spatial && !cases && !research)) result.push("project");
  if (spatial && !cases && !research) result.push("spatial");
  if (cases) result.push("cases");
  if (research) result.push("research");
  // Ambiguous questions use existing project context and the normal answer call.
  return result.length ? result : ["project"];
}
