import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const compiled = createRequire(path.join(process.env.PSS_TEST_BUILD, 'test-loader.cjs'));
const load = (file) => compiled(path.join(process.env.PSS_TEST_BUILD, file));
const { reconstructAbstract, selectPapers, researchSearchMode } = load('lib/research/openalex.js');
const { parseAnalysisRequest, selectCases, retrieveEvidence } = load('lib/research/evidence.js');
const { parseAnswer, answerFromEvidence, answerText } = load('lib/research/answer.js');
const { compactEvidence, usedSourceIds, usedAnswerEvidence } = load('lib/research/types.js');
const llm = load('lib/llm/index.js');
const searchHandler = load('pages/api/research/search.js').default;
const answerHandler = load('pages/api/research/answer.js').default;

const material = { id: 'park', label: 'Local park', title: 'Neighborhood park', text: 'Public participation improved neighborhood connectivity; displacement remained a concern.' };
const work = (overrides = {}) => ({ id: 'https://openalex.org/W1', display_name: 'Participatory regeneration', publication_year: 2024, relevance_score: 10, authorships: [{ author: { display_name: 'A. Author' } }], primary_location: { source: { display_name: 'Urban Studies' } }, open_access: { is_oa: true }, cited_by_count: 12, doi: 'https://doi.org/10.1/example', topics: [{ display_name: 'Urban regeneration' }], abstract_inverted_index: { Public: [0], participation: [1], improves: [2], governance: [3] }, ...overrides });
const evidence = () => ({ question: 'public participation', selectedSources: ['cases', 'research'], cases: selectCases('participation', [material]), papers: selectPapers([work()]), warnings: [] });
const response = () => ({ summary: 'Participation matters.', caseFindings: [{ text: 'Connectivity improved.', sourceIds: ['C:1'] }], researchFindings: [{ text: 'Governance improved.', sourceIds: ['R:W1'] }], agreement: 'Evidence overlaps in participation.', differences: 'The case includes displacement concerns.', integratedInterpretation: 'Treat governance and displacement separately.', projectImplications: ['Consider a participatory design process.'], limitations: 'Abstract-based; exact sample size is not provided.' });
function mockFetch(t, callback) { const original = global.fetch; global.fetch = callback; t.after(() => { global.fetch = original; }); }
function mockLLM(t, callback) { const original = llm.callLLM; llm.callLLM = callback; t.after(() => { llm.callLLM = original; }); }
async function runRoute(handler, body, method = 'POST') {
  const result = { headers: {} };
  const res = { setHeader: (k, v) => { result.headers[k] = v; }, status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  await handler({ method, body }, res);
  return result;
}

test('abstract reconstruction preserves repeated words and ignores invalid positions', () => {
  assert.equal(reconstructAbstract({ parks: [2], urban: [0, 3], improve: [1], corrupt: [-1, 20000, 1.5] }), 'urban improve parks urban');
  assert.equal(reconstructAbstract(null), null);
});
test('paper selection prefers relevant abstracts, excludes retractions/duplicates, and validates links', () => {
  const papers = selectPapers([work({ id: 'https://openalex.org/W2', abstract_inverted_index: null, cited_by_count: 999999 }), work(), work(), work({ id: 'https://openalex.org/W3', is_retracted: true }), work({ id: 'https://openalex.org/W4', doi: 'javascript:alert(1)' })]);
  assert.equal(papers.length, 3);
  assert.equal(papers[0].sourceId, 'R:W1');
  assert.equal(papers[1].doi, null);
  assert.equal(papers[2].usedInAnswer, false);
  assert.equal(papers[0].journal, 'Urban Studies');
  assert.deepEqual(papers[0].authors, ['A. Author']);
});
test('source defaults and request bounds reject malformed or unsupported inputs', () => {
  assert.deepEqual(parseAnalysisRequest({ question: 'question' }).selectedSources, ['cases', 'research']);
  assert.deepEqual(parseAnalysisRequest({ question: 'question', selectedSources: [] }).selectedSources, ['cases', 'research']);
  assert.deepEqual(parseAnalysisRequest({ question: 'question', selectedSources: ['cases', 'cases'] }).selectedSources, ['cases']);
  for (const body of [null, { question: 7 }, { question: ' ' }, { question: 'x'.repeat(2001) }, { question: 'question', selectedSources: ['web'] }, { question: 'question', cases: [null] }]) assert.throws(() => parseAnalysisRequest(body));
});
test('cases use actual project excerpts and rank matching text without fabricated attributes', () => {
  const result = selectCases('participation', [{ ...material, id: 'other', text: 'Industrial heritage and creative industries.' }, material, { ...material, text: 'Describe key regeneration patterns observed in this case.' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'park');
  assert.deepEqual(result[0].relevanceTerms, ['participation']);
  assert.equal(result[0].location, undefined);
  assert.deepEqual(selectCases('unmatched term', [material])[0].relevanceTerms, []);
});
test('long natural-language questions use semantic search and concise queries use works search', () => {
  assert.equal(researchSearchMode('urban regeneration'), 'search');
  assert.equal(researchSearchMode('How does public participation affect displacement and gentrification in urban regeneration projects?'), 'search.semantic');
});
test('research retrieval sends a server-side query and reuses bounded cached results', async (t) => {
  let calls = 0;
  mockFetch(t, async (url) => { calls++; assert.equal(url.hostname, 'api.openalex.org'); assert.equal(url.searchParams.get('search'), 'cache fixture'); return Response.json({ results: [work()] }); });
  const request = parseAnalysisRequest({ question: 'cache fixture', selectedSources: ['research'] });
  assert.equal((await retrieveEvidence(request)).papers.length, 1);
  assert.equal((await retrieveEvidence(request)).papers.length, 1);
  assert.equal(calls, 1);
});
test('research outage is explicit while case evidence stays usable', async (t) => {
  mockFetch(t, async () => { throw new Error('network failure with private details'); });
  const result = await retrieveEvidence(parseAnalysisRequest({ question: 'outage fixture', cases: [material] }));
  assert.equal(result.cases.length, 1);
  assert.equal(result.papers.length, 0);
  assert.match(result.warnings[0].message, /unavailable/);
  assert(!JSON.stringify(result).includes('private details'));
});
test('rate limits and denied access produce specific safe warnings', async (t) => {
  mockFetch(t, async () => new Response('private provider payload', { status: 429 }));
  assert.match((await retrieveEvidence(parseAnalysisRequest({ question: 'rate limit fixture', selectedSources: ['research'] }))).warnings[0].message, /rate limited/);
  global.fetch = async () => new Response('', { status: 401 });
  assert.match((await retrieveEvidence(parseAnalysisRequest({ question: 'denied fixture', selectedSources: ['research'] }))).warnings[0].message, /OPENALEX_API_KEY/);
});
test('malformed provider responses produce safe warnings rather than parser details', async (t) => {
  mockFetch(t, async () => new Response('private invalid payload'));
  const result = await retrieveEvidence(parseAnalysisRequest({ question: 'invalid JSON fixture', selectedSources: ['research'] }));
  assert.equal(result.warnings[0].message, 'Research search returned an invalid response.');
  assert.deepEqual(selectPapers([null, work()]).map(p => p.sourceId), ['R:W1']);
});
test('no abstracts never generate title-based findings or call the LLM', async (t) => {
  mockFetch(t, async () => Response.json({ results: [work({ abstract_inverted_index: null })] }));
  mockLLM(t, async () => { throw new Error('must not be called'); });
  const request = parseAnalysisRequest({ question: 'no abstract fixture', selectedSources: ['research'] });
  const result = await retrieveEvidence(request);
  const answer = await answerFromEvidence(request, result);
  assert.equal(answer.sources.length, 0);
  assert.deepEqual(answer.researchFindings, []);
  assert.match(answer.limitations, /no available abstracts/);
});
test('citation metadata comes from retrieval; hallucinated or cross-kind references fail', () => {
  const valid = response(); valid.sources = [{ title: 'invented paper' }];
  const answer = parseAnswer(JSON.stringify(valid), evidence());
  assert.equal(answer.sources[1].title, 'Participatory regeneration');
  assert.match(answerText(answer), /R:W1/);
  const invalid = response(); invalid.researchFindings[0].sourceIds = ['R:W999'];
  assert.throws(() => parseAnswer(JSON.stringify(invalid), evidence()), /unsupported source/);
  invalid.researchFindings[0].sourceIds = ['C:1'];
  assert.throws(() => parseAnswer(JSON.stringify(invalid), evidence()), /unsupported source/);
  assert.throws(() => parseAnswer('{}', evidence()), /invalid/);
});
test('synthesis prompt uses abstract scope, project context and only usable papers', async (t) => {
  const bundle = evidence(); bundle.papers.push(...selectPapers([work({ id: 'https://openalex.org/W2', abstract_inverted_index: null })]));
  mockLLM(t, async (input) => {
    assert.match(input.systemText, /ABSTRACT-BASED/);
    assert.match(input.systemText, /sample sizes/);
    assert.match(input.systemText, /untrusted/);
    const payload = JSON.parse(input.userText);
    assert.equal(payload.papers.length, 1);
    assert.equal(payload.projectContext, 'Seoul project');
    return JSON.stringify(response());
  });
  const result = await answerFromEvidence(parseAnalysisRequest({ question: 'question', projectContext: 'Seoul project' }), bundle);
  assert.equal(result.sources.length, 2);
  const compact = compactEvidence(bundle);
  assert(compact.papers.every((p) => !('abstract' in p)));
  assert.equal(compact.papers[0].usedInAnswer, true);
});
test('API routes validate methods and inputs before retrieval', async () => {
  for (const route of [searchHandler, answerHandler]) {
    const method = await runRoute(route, {}, 'GET');
    assert.equal(method.status, 405); assert.equal(method.headers.Allow, 'POST');
    assert.equal((await runRoute(route, { question: 7 })).status, 400);
  }
});
test('answer API returns source-separated structured results and no stored abstracts', async (t) => {
  mockFetch(t, async () => Response.json({ results: [work()] }));
  mockLLM(t, async () => JSON.stringify(response()));
  const result = await runRoute(answerHandler, { question: 'route fixture', cases: [material], projectContext: 'Seoul' });
  assert.equal(result.status, 200);
  assert.equal(result.body.analysis.answer.researchFindings.length, 1);
  assert.equal(result.body.analysis.answer.caseFindings.length, 1);
  assert(!('abstract' in result.body.analysis.evidence.papers[0]));
  assert.match(result.body.reply, /doi.org/);
});
test('synthesis failure returns retrieved evidence with a safe error', async (t) => {
  mockLLM(t, async () => { throw new Error('private provider error'); });
  const result = await runRoute(answerHandler, { question: 'failure fixture', selectedSources: ['cases'], cases: [material] });
  assert.equal(result.status, 502);
  assert.equal(result.body.evidence.cases.length, 1);
  assert(!JSON.stringify(result.body).includes('private provider'));
});
test('answer viewing shows only cited evidence without modifying saved records', () => {
  const bundle = evidence();
  bundle.papers.push(...selectPapers([work({ id: 'https://openalex.org/W2' })]));
  bundle.cases.push({ ...bundle.cases[0], sourceId: 'C:2', id: 'other' });
  const record = { selectedSources: bundle.selectedSources, answer: parseAnswer(JSON.stringify(response()), bundle), evidence: compactEvidence(bundle) };
  const before = JSON.stringify(record);
  assert.deepEqual([...usedSourceIds(record.answer)], ['C:1', 'R:W1']);
  const visible = usedAnswerEvidence(record);
  assert.deepEqual(visible.cases.map(c => c.sourceId), ['C:1']);
  assert.deepEqual(visible.papers.map(p => p.openAlexId), ['https://openalex.org/W1']);
  assert.equal(JSON.stringify(record), before);
});
test('a historical case-only answer keeps its own evidence sources', () => {
  const bundle = evidence(); bundle.selectedSources = ['cases']; bundle.papers = [];
  const content = response(); content.researchFindings = [];
  const record = { selectedSources: ['cases'], answer: parseAnswer(JSON.stringify(content), bundle), evidence: compactEvidence(bundle) };
  assert.deepEqual(usedAnswerEvidence(record).selectedSources, ['cases']);
  assert.deepEqual(usedAnswerEvidence(record).papers, []);
});
