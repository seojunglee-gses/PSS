import { academicSearchQuery } from "./query";
import type { ResearchPaper } from "./types";

type OpenAlexWork = {
  id?: string;
  display_name?: string;
  publication_year?: number;
  doi?: string;
  cited_by_count?: number;
  relevance_score?: number;
  is_retracted?: boolean;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } | null } | null;
  open_access?: { is_oa?: boolean };
  topics?: { display_name?: string }[];
};

export function reconstructAbstract(index: OpenAlexWork["abstract_inverted_index"]): string | null {
  if (!index || typeof index !== "object") return null;
  const words = new Map<number, string>();
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0 && position < 10000) words.set(position, word);
    }
  }
  const text = [...words].sort(([a], [b]) => a - b).map(([, word]) => word).join(" ").trim();
  return text ? text.slice(0, 6000) : null;
}

function verifiedLink(value: string | undefined, host: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === host && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function selectPapers(works: OpenAlexWork[], limit = 5): ResearchPaper[] {
  const seen = new Set<string>();
  const titles = new Set<string>();
  const dois = new Set<string>();
  // The provider's relevance order dominates; abstract availability breaks ties.
  // Citation counts are display metadata, never a ranking signal.
  return works
    .filter((work) => {
      if (!work || typeof work !== "object") return false;
      if (!work.id || !/^https:\/\/openalex\.org\/W\d+$/.test(work.id) || !work.display_name || work.is_retracted || seen.has(work.id)) return false;
      seen.add(work.id);
      return true;
    })
    .map((work, position) => ({ work, position, abstract: reconstructAbstract(work.abstract_inverted_index) }))
    .sort((a, b) => Number(Boolean(b.abstract)) - Number(Boolean(a.abstract)) ||
      (b.work.relevance_score ?? 0) - (a.work.relevance_score ?? 0) || a.position - b.position)
    .filter(({ work }) => {
      const title = work.display_name!.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      const doi = verifiedLink(work.doi, "doi.org")?.toLowerCase();
      if (titles.has(title) || (doi && dois.has(doi))) return false;
      titles.add(title);
      if (doi) dois.add(doi);
      return true;
    })
    .slice(0, limit)
    .map(({ work, abstract }) => ({
      sourceId: `R:${work.id!.split("/").pop()}`,
      openAlexId: work.id!,
      title: work.display_name!,
      authors: (work.authorships ?? []).flatMap(({ author }) => author?.display_name ? [author.display_name] : []),
      year: Number.isInteger(work.publication_year) ? work.publication_year! : null,
      abstract,
      doi: verifiedLink(work.doi, "doi.org"),
      journal: work.primary_location?.source?.display_name ?? null,
      citationCount: Math.max(0, work.cited_by_count ?? 0),
      openAccess: typeof work.open_access?.is_oa === "boolean" ? work.open_access.is_oa : null,
      topics: (work.topics ?? []).flatMap((topic) => topic.display_name ? [topic.display_name] : []),
      usedInAnswer: Boolean(abstract),
    }));
}

const cache = new Map<string, { expires: number; papers: ResearchPaper[] }>();

export function researchSearchMode(question: string): "search" | "search.semantic" {
  return question.trim().split(/\s+/).length >= 10 || question.length >= 100 ? "search.semantic" : "search";
}

async function fetchPapers(query: string): Promise<ResearchPaper[]> {
  const cached = cache.get(query);
  if (cached && cached.expires > Date.now()) return cached.papers;
  const url = new URL("https://api.openalex.org/works");
  // Natural-language questions use semantic retrieval; concise queries use works search.
  url.searchParams.set(researchSearchMode(query), query);
  url.searchParams.set("per-page", "15");
  url.searchParams.set("filter", "is_retracted:false,has_abstract:true");
  if (process.env.OPENALEX_API_KEY) url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
  if (process.env.OPENALEX_MAILTO) url.searchParams.set("mailto", process.env.OPENALEX_MAILTO);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: "application/json" } });
  } catch {
    throw new Error("연구논문 검색에 연결하지 못했거나 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (!response.ok) {
    // Never return provider request URLs/errors; they can contain the API key.
    if (response.status === 401 || response.status === 403) throw new Error("연구논문 검색 서비스에 접근하지 못했습니다. 검색 설정을 확인해 주세요.");
    if (response.status === 429) throw new Error("연구논문 검색 요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.");
    throw new Error("연구논문 검색을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  let payload: { results?: OpenAlexWork[] };
  try { payload = await response.json(); }
  catch { throw new Error("연구논문 검색 결과를 읽지 못했습니다. 잠시 후 다시 시도해 주세요."); }
  if (!payload || typeof payload !== "object") throw new Error("연구논문 검색 결과를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");
  if (!Array.isArray(payload.results)) throw new Error("연구논문 검색 결과를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");
  const papers = selectPapers(payload.results);
  if (cache.size >= 50) cache.delete(cache.keys().next().value!);
  cache.set(query, { expires: Date.now() + 5 * 60 * 1000, papers });
  return papers;
}

// Coalesce both conversion and retrieval, including concurrent requests for equivalent queries.
const pendingQuestions = new Map<string, Promise<ResearchPaper[]>>();
const pendingQueries = new Map<string, Promise<ResearchPaper[]>>();
export async function searchOpenAlex(question: string, provider?: "openai" | "gemini" | "deepseek", projectContext = ""): Promise<ResearchPaper[]> {
  const key = `${provider ?? "openai"}:${question.trim()}:${projectContext.slice(0, 1500)}`;
  const existing = pendingQuestions.get(key);
  if (existing) return existing;
  const operation = (async () => {
    const query = await academicSearchQuery(question, provider, projectContext);
    let request = pendingQueries.get(query);
    if (!request) {
      request = fetchPapers(query).finally(() => pendingQueries.delete(query));
      pendingQueries.set(query, request);
    }
    return request;
  })().finally(() => pendingQuestions.delete(key));
  pendingQuestions.set(key, operation);
  return operation;
}

// Re-open an actually viewed paper by stable ID; do not replace it with a new ranked search.
export async function readOpenAlexPaper(id: string): Promise<ResearchPaper[]> {
  if (!/^(?:https:\/\/openalex\.org\/)?W\d+$/.test(id)) throw new Error("선택한 논문 정보가 올바르지 않습니다.");
  const url = new URL(`https://api.openalex.org/works/${id.split('/').pop()}`);
  if (process.env.OPENALEX_API_KEY) url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
  if (process.env.OPENALEX_MAILTO) url.searchParams.set("mailto", process.env.OPENALEX_MAILTO);
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("선택한 논문을 불러오지 못했습니다. 다른 논문으로 대체하지 않았습니다.");
  return selectPapers([await response.json()]);
}
