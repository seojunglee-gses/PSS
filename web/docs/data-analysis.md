# Data Analysis evidence sources

The existing workspace keeps its two columns: Evidence on the left and Analysis Chat on the right. The `+` menu beside the input selects Case Studies, Research Papers, or both. Removing all chips restores the default of both sources. Existing case browsing/editing remains under “Browse / edit project case materials”; other planning stages use their existing chat endpoints.

## Data flow

`pages/workspace/index.tsx` sends the question, selected sources, saved project case excerpts, provider and problem-definition context to `POST /api/research/answer`. The endpoint retrieves evidence server-side, synthesizes a structured answer with the existing LLM adapters, and returns both the answer and the corresponding evidence. `POST /api/research/search` exposes the same retrieval without an LLM call.

Requests accept `question` (1–2000 characters), `selectedSources` (`cases` and/or `research`), `cases` (`id`, `label`, `title`, `text`), optional `projectContext`, and the existing `provider`. Empty or omitted sources mean both. Case materials come from `activeProject.workspaceContent.data.cases`; the request does not fetch arbitrary client-provided URLs or paper payloads.

Case selection ranks the actual saved excerpts by matching question terms. When no terms match, the returned cases are explicitly marked as contextual comparisons. Empty/default placeholder materials are excluded. Locations, years and other case facts are not invented when the saved material lacks them.

`lib/research/openalex.ts` uses OpenAlex Works search for concise queries and `search.semantic` for longer natural-language questions (at least ten words or 100 characters). It retrieves up to 25 works, removes duplicate/retracted works, prefers abstracts within relevance-ranked results and returns up to eight papers. Citation counts are metadata, not a retrieval ranking signal. The server caches results for five minutes, up to 50 questions, and uses a 12-second retrieval timeout.

Research statistics describe only the retrieved papers: publication range, topics, open-access count, and citations. The panel does not classify support/opposition or infer study quality. Papers without abstracts are labeled metadata-only and excluded from synthesis. Every research finding must reference an available abstract's source ID. Citation metadata is assembled from retrieved records rather than accepted from the model. The prompt explicitly requires abstention for missing full-text methods, sample sizes, statistics or tables.

Research failure can produce a partial answer from case materials, with a visible warning. If neither source provides usable evidence, the endpoint returns an evidence-gap response without calling the LLM. A synthesis failure returns the retrieved evidence with HTTP 502. There is no automatic PDF download or full-text RAG.

## Existing storage and planning continuity

The same Firebase step-chat records store optional `selectedSources` and `analysis` fields; no new collection or rules are required. `analysis` contains the structured answer and compact evidence metadata. OpenAlex abstracts and original response payloads are not persisted. The existing text field also includes the answer, source IDs and source links, so downstream summaries and Design / Plan Alternatives can continue to consume Data Analysis output. Historical citation buttons restore the evidence for that specific answer.

## Server configuration

Set keys in **Vercel Environment Variables**, never in browser code or `NEXT_PUBLIC_*` variables:

- The existing selected provider's key: `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `DEEPSEEK_API_KEY`.
- `OPENALEX_API_KEY` if required by the OpenAlex account/access tier. It is sent only from the server to `api.openalex.org`; denial and rate-limit responses are surfaced safely. Basic and semantic searches were exercised successfully without a key in this environment, but access policies can change.
- Optional `OPENALEX_MAILTO` for the OpenAlex contact parameter.

The existing Firebase web-app configuration and authentication still apply. Allow server egress to `api.openalex.org` and the selected LLM provider. On a Node 24 cloud instance using an HTTP(S) proxy, start Node with `NODE_USE_ENV_PROXY=1`; Vercel's normal direct networking does not need a proxy. The cloud wrapper maps the platform's `PSS_OPENAI_API_KEY` binding to the app's `OPENAI_API_KEY`.

## Validation

From `web`, run `bash tests/run-research-tests.sh`. It compiles the server modules into a temporary directory and runs deterministic tests for source selection, abstract reconstruction, metadata/citations, retrieval failure, no-abstract behavior, model grounding instructions and route responses. It makes no external requests and requires no API keys.

Use `npx tsc --noEmit --incremental false` and `npm run build` for normal repository checks. In the prepared cloud environment, use `bash /workspace/pss-setup/run-next.sh build` to keep Next.js's automatic TypeScript adjustments out of the tracked configuration. The upstream repository has existing lint failures and an incomplete lockfile; this feature does not alter those unrelated files.

Live OpenAlex retrieval was verified. Browser interaction and record restoration were checked with isolated Firebase/authentication and LLM response fixtures. A complete production Firebase/LLM session still requires the real deployment configuration and has not been verified here.
