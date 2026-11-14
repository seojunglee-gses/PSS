import { isGeoQuestion, isSpatialInvestigation, requestsSpatialAnalysis, isSelectedPlaceDiscussion } from "../spatial/geo-query";
import { clarificationExchange, contextualQuestion, type ConversationMessage } from "../chat-history";
import type { EvidenceSource } from "./types";

export function namedCases<T extends {id:string;title:string;label:string;aliases?:string[]}>(question:string,cases:T[],history:ConversationMessage[]=[]){
  const normalize=(text:string)=>text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const match=(text:string)=>cases.filter(item=>[item.title,item.label,...(item.aliases??[])].some(name=>typeof name==='string'&&normalize(name).length>=3&&normalize(text).includes(normalize(name))));
  const current=match(question);if(current.length)return current;
  for(const message of [...history].reverse()){const found=match(message.content);if(found.length)return found;}return [];
}
export const wantsImplications=(question:string)=>/적용|시사점|배울\s*점|참고할\s*점|아이디어|비교|전략|적합|괜찮|좋을까|어떻게|개선|해결|대안|방법|추천|제안|효과|가능|해야|할까|너라면|\b(?:apply|adapt|implications?|lessons?|compare|recommend|suggest|alternatives?|suitab|should|improve)\b/i.test(question);
// Real implemented examples use external case search; effect/research questions use OpenAlex.
export const wantsNewCases = (question:string) => {
  const remaining = question.replace(/(?:이|그|해당)\s*(?:해외\s*)?사례|(?:this|that) case/gi, "");
  if (remaining !== question && !/(?:다른|새로운|추가|비슷한|유사한|해외|국내외).{0,20}사례|사례.{0,20}(?:찾|검색)|(?:other|new|find|search)/i.test(remaining)) return false;
  return /(?:해외|국내외|외국|다른\s*지역|새로운).{0,45}사례.{0,25}(?:참고|보고\s*싶|알고\s*싶|알려|소개|추천|비교)|사례.{0,20}(?:소개해|추천해)|(?:international|overseas|foreign|new).{0,35}cases?.{0,20}(?:learn|refer|see|explore)/i.test(question) || /(?:사례|비슷한\s*(?:사업|지역|도시)|다른\s*(?:사업|지역|도시))(?:(?!논문|연구|학술|효과).)*(?:찾|검색|있(?:어|나)|보여)|실제로.*(?:한|운영).*(?:곳|사례).*(?:있|찾)|(?:find|search|show).*(?:cases?|similar projects?)|other cases?|해외에서는.*어떻게|국내\s*다른\s*지역|다른\s*지역.*어떻게|이런\s*방식.*해결한\s*곳|성공(?:한)?\s*사례|지속(?:적으로)?\s*운영(?:되는)?\s*사례|이런\s*사례.*있/i.test(question)
};
export const wantsResearch = (question:string) => /논문|연구|학술|검증|선행연구|근거.*(?:찾|검색)|효과(?:가|는|적|\s*있)|지속가능성|literature|\b(?:stud(?:y|ies)|research|evidence|effective|effectiveness|sustainability)\b/i.test(question);

export function resolveSources(question: string, selected: EvidenceSource[] = [], availableCases:{id:string;title:string;label:string;aliases?:string[]}[]=[],history:ConversationMessage[]=[]): EvidenceSource[] {
  if (selected.length) return [...new Set(selected)];
  const cases = wantsNewCases(question) || namedCases(question,availableCases,/이\s*사례|그\s*사례|여기|거기|그곳|부작용|차도|this case|that case|\bthere\b|\bit\b/i.test(question)?history:[]).length>0 || /사례|비슷한\s*(지역|도시|사업)|다른\s*도시|어떻게\s*했|case\s*stud|\bcases?\b|similar\s*(area|city|cities|project)/i.test(question);
  const investigation = isSpatialInvestigation(question);
  const research = wantsResearch(question) || (!cases && !investigation && /효과|effect|impact/i.test(question));
  const placeSearch = /어디(?:야|인가요|에\s*있)|\b(?:find|search|where (?:is|are))\b|(?:검색|찾아)(?:해)?(?:줘|주세요)/i.test(question) && !/문제|목표|전략|자료|요약|내용/.test(question);
  let spatial = isSelectedPlaceDiscussion(question) || placeSearch || isGeoQuestion(question) || /도로\s*폭|면적|필지|건물|토지\s*이용|거리|위치|경계|인구|녹지|접근성|버퍼|시설|GIS|공간\s*분석|주변|근처|카페|약국|마트|음식점|식당|편의점|병원|학교|버스\s*정류장|도보|걸어|가장\s*가까|에서.*까지|nearby|nearest|walking|cafe|pharmacy|restaurant|supermarket|road\s*width|\barea\b|parcel|building|land\s*use|distance|location|boundary|population/i.test(question);
  // An idea mentioning greenery/a park is not itself a request to look up GIS/POIs.
  if (!investigation && !requestsSpatialAnalysis(question) && !isSelectedPlaceDiscussion(question) && !placeSearch && /싶|좋겠|생각|하면\s*어떨|대신|바꾸고|전환하고|제안|I(?: would)? (?:like|want)|what if/i.test(question)) spatial = false;
  const project = /프로젝트\s*자료|사업\s*자료|대상지\s*자료|사업\s*(배경|목표)|project\s*(data|material|context)/i.test(question);
  const result: EvidenceSource[] = [];
  // Academic questions about spatial topics need literature, not an unsolicited GIS lookup.
  if (project || (spatial && !cases && !research)) result.push("project");
  if (requestsSpatialAnalysis(question) || spatial && !cases && !research) result.push("spatial");
  if (cases) result.push("cases");
  if (research) result.push("research");
  // Ambiguous questions use existing project context and the normal answer call.
  return result.length ? result : ["project"];
}

export function sourceRoutingQuestion(question: string, history: ConversationMessage[]) {
  if(clarificationExchange(question,history))return contextualQuestion(question,history);
  // A concrete new project/spatial question must not inherit an earlier literature/case search.
  if (isSpatialInvestigation(question) || requestsSpatialAnalysis(question)) return question;
  if (!/논문|연구|학술|사례|research|stud(?:y|ies)|cases?/i.test(question) && (/도로\s*폭|면적|필지|토지\s*이용|주요\s*문제|위치|어디|사업\s*(배경|목표)|대상지\s*확인|주변|근처|도보|가장\s*가까|카페|약국|마트|병원|학교|nearby|nearest|walking|에서.*까지/i.test(question) || /(?:검색|찾아)(?:해)?(?:줘|주세요)/.test(question))) return question;
  return contextualQuestion(question, history);
}
