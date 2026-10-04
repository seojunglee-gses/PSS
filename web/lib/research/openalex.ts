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

export function selectPapers(works: OpenAlexWork[], limit = 8): ResearchPaper[] {
  const seen = new Set<string>();
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

export async function searchOpenAlex(question: string): Promise<ResearchPaper[]> {
  const cached = cache.get(question);
  if (cached && cached.expires > Date.now()) return cached.papers;
  const url = new URL("https://api.openalex.org/works");
  // Natural-language questions use semantic retrieval; concise queries use works search.
  url.searchParams.set(researchSearchMode(question), question);
  url.searchParams.set("per-page", "25");
  url.searchParams.set("filter", "is_retracted:false");
  if (process.env.OPENALEX_API_KEY) url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
  if (process.env.OPENALEX_MAILTO) url.searchParams.set("mailto", process.env.OPENALEX_MAILTO);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: "application/json" } });
  } catch {
    throw new Error("Research retrieval is unavailable or timed out. Please try again.");
  }
  if (!response.ok) {
    // Never return provider request URLs/errors; they can contain the API key.
    if (response.status === 401 || response.status === 403) throw new Error("Research access was denied. Check the server-side OPENALEX_API_KEY and network access.");
    if (response.status === 429) throw new Error("Research search is rate limited. Please try again later.");
    throw new Error("Research search failed. Please try again.");
  }
  let payload: { results?: OpenAlexWork[] };
  try { payload = await response.json(); }
  catch { throw new Error("Research search returned an invalid response."); }
  if (!payload || typeof payload !== "object") throw new Error("Research search returned an invalid response.");
  if (!Array.isArray(payload.results)) throw new Error("Research search returned an invalid response.");
  const papers = selectPapers(payload.results);
  if (cache.size >= 50) cache.delete(cache.keys().next().value!);
  cache.set(question, { expires: Date.now() + 5 * 60 * 1000, papers });
  return papers;
}
