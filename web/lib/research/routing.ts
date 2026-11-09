import { isGeoQuestion, isSpatialInvestigation } from "../spatial/geo-query";
import { clarificationExchange, contextualQuestion, type ConversationMessage } from "../chat-history";
import type { EvidenceSource } from "./types";

export function namedCases<T extends {id:string;title:string;label:string;aliases?:string[]}>(question:string,cases:T[],history:ConversationMessage[]=[]){
  const normalize=(text:string)=>text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const match=(text:string)=>cases.filter(item=>[item.title,item.label,...(item.aliases??[])].some(name=>typeof name==='string'&&normalize(name).length>=3&&normalize(text).includes(normalize(name))));
  const current=match(question);if(current.length)return current;
  for(const message of [...history].reverse()){const found=match(message.content);if(found.length)return found;}return [];
}
export const wantsImplications=(question:string)=>/적용|시사점|배울\s*점|참고할\s*점|아이디어|비교|전략|적합|괜찮|좋을까|어떻게|개선|해결|대안|방법|추천|제안|효과|가능|해야|할까|너라면|\b(?:apply|adapt|implications?|lessons?|compare|recommend|suggest|alternatives?|suitab|should|improve)\b/i.test(question);
// These describe intent, not a new search service. New cases can only be found via existing literature search.
export const wantsNewCases = (question:string) => /(?:사례|비슷한\s*(?:사업|지역|도시)|다른\s*(?:사업|지역|도시)).*(?:찾|검색|있(?:어|나)|보여)|실제로.*(?:한|운영).*(?:곳|사례).*(?:있|찾)|(?:find|search|show).*(?:cases?|similar projects?)|other cases?/i.test(question);
export const wantsResearch = (question:string) => /논문|연구|학술|검증|선행연구|근거.*(?:찾|검색)|효과(?:가|는|적|\s*있)|지속가능성|다른\s*(?:방법|대안).*(?:없|있|찾)|literature|\b(?:stud(?:y|ies)|research|evidence|effective|effectiveness|sustainability)\b/i.test(question);

export function resolveSources(question: string, selected: EvidenceSource[] = [], availableCases:{id:string;title:string;label:string;aliases?:string[]}[]=[],history:ConversationMessage[]=[]): EvidenceSource[] {
  if (selected.length) return [...new Set(selected)];
  const cases = wantsNewCases(question) || namedCases(question,availableCases,/이\s*사례|그\s*사례|여기|거기|그곳|부작용|차도|this case|that case|\bthere\b|\bit\b/i.test(question)?history:[]).length>0 || /사례|비슷한\s*(지역|도시|사업)|다른\s*도시|어떻게\s*했|case\s*stud|\bcases?\b|similar\s*(area|city|cities|project)/i.test(question);
  const investigation = isSpatialInvestigation(question);
  const research = wantsResearch(question) || (!cases && !investigation && /효과|effect|impact/i.test(question));
  const placeSearch = /어디(?:야|인가요|에\s*있)|\b(?:find|search|where (?:is|are))\b|(?:검색|찾아)(?:해)?(?:줘|주세요)/i.test(question) && !/문제|목표|전략|자료|요약|내용/.test(question);
  const spatial = placeSearch || isGeoQuestion(question) || /도로\s*폭|면적|필지|건물|토지\s*이용|거리|위치|경계|인구|녹지|접근성|버퍼|시설|GIS|공간\s*분석|주변|근처|카페|약국|마트|음식점|식당|편의점|병원|학교|버스\s*정류장|도보|걸어|가장\s*가까|에서.*까지|nearby|nearest|walking|cafe|pharmacy|restaurant|supermarket|road\s*width|\barea\b|parcel|building|land\s*use|distance|location|boundary|population/i.test(question);
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
  if(clarificationExchange(question,history))return contextualQuestion(question,history);
  // A concrete new project/spatial question must not inherit an earlier literature/case search.
  if (isSpatialInvestigation(question)) return question;
  if (!/논문|연구|학술|사례|research|stud(?:y|ies)|cases?/i.test(question) && (/도로\s*폭|면적|필지|토지\s*이용|주요\s*문제|위치|어디|사업\s*(배경|목표)|대상지\s*확인|주변|근처|도보|가장\s*가까|카페|약국|마트|병원|학교|nearby|nearest|walking|에서.*까지/i.test(question) || /(?:검색|찾아)(?:해)?(?:줘|주세요)/.test(question))) return question;
  return contextualQuestion(question, history);
}
