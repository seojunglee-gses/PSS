import { contextualQuestion, type ConversationMessage } from "../chat-history";
import type { EvidenceSource } from "./types";

export function resolveSources(question: string, selected: EvidenceSource[] = []): EvidenceSource[] {
  if (selected.length) return [...new Set(selected)];
  const cases = /사례|비슷한\s*(지역|도시|사업)|다른\s*도시|어떻게\s*했|case\s*stud|\bcases?\b|similar\s*(area|city|cities|project)/i.test(question);
  const research = /논문|연구|학술|검증|선행연구|literature|\bstud(?:y|ies)\b|\bresearch\b|\bevidence\b/i.test(question) || (!cases && /효과|effect|impact/i.test(question));
  const placeSearch = /어디(?:야|인가요|에\s*있)|\b(?:find|search|where is)\b|(?:검색|찾아)(?:해)?(?:줘|주세요)/i.test(question) && !/문제|목표|전략|자료|요약|내용/.test(question);
  const spatial = placeSearch || /도로\s*폭|면적|필지|건물|토지\s*이용|거리|위치|경계|인구|녹지|접근성|버퍼|시설|GIS|공간\s*분석|주변|근처|카페|약국|마트|음식점|식당|편의점|병원|학교|버스\s*정류장|도보|걸어|가장\s*가까|에서.*까지|nearby|nearest|walking|cafe|pharmacy|restaurant|supermarket|road\s*width|\barea\b|parcel|building|land\s*use|distance|location|boundary|population/i.test(question);
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

export function sourceRoutingQuestion(question: string, history: ConversationMessage[]) {
  // A concrete new project/spatial question must not inherit an earlier literature/case search.
  if (!/논문|연구|학술|사례|research|stud(?:y|ies)|cases?/i.test(question) && (/도로\s*폭|면적|필지|토지\s*이용|주요\s*문제|사업\s*(배경|목표)|대상지\s*확인|주변|근처|도보|가장\s*가까|카페|약국|마트|병원|학교|nearby|nearest|walking|에서.*까지/i.test(question) || /(?:검색|찾아)(?:해)?(?:줘|주세요)/.test(question))) return question;
  return contextualQuestion(question, history);
}
