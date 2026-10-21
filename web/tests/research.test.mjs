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
const { MODELS, selectOpenAIChatModel, callOpenAI } = load('lib/llm/openai.js');
const searchHandler = load('pages/api/research/search.js').default;
const answerHandler = load('pages/api/research/answer.js').default;

test('OpenAI model routing reserves Fast Chat for clear simple tasks', () => {
  assert.deepEqual(MODELS, { fastChat: 'gpt-6-luna', chat: 'gpt-6.1-sol', image: 'gpt-image-2.5-flare' });
  for (const question of ['안녕하세요', '이 문장 맞춤법 고쳐줘', '다음 글을 요약해줘: 짧은 글입니다.', 'Rewrite this sentence', 'What is a glossary?']) {
    assert.equal(selectOpenAIChatModel(question, 'problem'), MODELS.fastChat);
  }
  for (const question of ['공간 분석 결과를 해석해줘', '여러 근거를 종합해줘', 'Compare design alternatives', 'Rewrite the report', '다음 단계는?', 'rewrite ' + 'x'.repeat(601)]) {
    assert.equal(selectOpenAIChatModel(question, 'problem'), MODELS.chat);
  }
});
test('report and analysis stages cannot be routed to Fast Chat even for simple requests', () => {
  for (const stage of ['report', 'summary', 'data', 'alternatives', 'evaluation']) {
    for (const question of ['요약해줘', '안녕하세요', 'Rewrite this sentence']) {
      assert.equal(selectOpenAIChatModel(question, stage), MODELS.chat);
    }
  }
});
test('OpenAI gateway defaults to Chat and sends a selected Fast Chat model without extra requests', async (t) => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'mock-model-routing-key';
  t.after(() => { if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; });
  const models = [];
  mockFetch(t, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body); models.push(body.model);
    assert.equal(body.input[0].content[0].text, 'unchanged prompt');
    return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'reply' }] }] });
  });
  await callOpenAI({ systemText: 'unchanged prompt', userText: 'task' });
  await callOpenAI({ model: MODELS.fastChat, systemText: 'unchanged prompt', userText: 'task' });
  assert.deepEqual(models, [MODELS.chat, MODELS.fastChat]);
});

test('spatial AI context resolves building names on the server and keeps original codes',async t=>{
 let received;
 mockLLM(t,async request=>{received=JSON.parse(request.userText);return JSON.stringify({...response(),caseFindings:[],researchFindings:[]})});
 const spatialContext={projectId:'uses',type:'area',timestamp:new Date().toISOString(),layerIds:['buildings'],parameters:{},metrics:{buildingCount:2},notes:[],buildingUses:[{use_code:'03000',use_name:'사용자가 지어낸 이름',count:1},{use_code:'XXXXX',use_name:'임의 용도',count:1}]};
 const result=await runRoute(answerHandler,{question:'건물 용도를 설명해줘',selectedSources:['spatial'],spatialContext});
 assert.equal(result.status,200);assert.equal(received.spatialContext.buildingUses[0].use_code,'03000');assert.equal(received.spatialContext.buildingUses[0].use_name,'제1종근린생활시설');assert.equal(received.spatialContext.buildingUses[1].use_code,'XXXXX');assert.equal(received.spatialContext.buildingUses[1].use_name,'용도 정보 없음');
});

const material = { id: 'park', label: 'Local park', title: 'Neighborhood park', text: 'Public participation improved neighborhood connectivity; displacement remained a concern.' };
const work = (overrides = {}) => ({ id: 'https://openalex.org/W1', display_name: 'Participatory regeneration', publication_year: 2024, relevance_score: 10, authorships: [{ author: { display_name: 'A. Author' } }], primary_location: { source: { display_name: 'Urban Studies' } }, open_access: { is_oa: true }, cited_by_count: 12, doi: 'https://doi.org/10.1/example', topics: [{ display_name: 'Urban regeneration' }], abstract_inverted_index: { Public: [0], participation: [1], improves: [2], governance: [3] }, ...overrides });
const evidence = () => ({ question: 'public participation', selectedSources: ['cases', 'research'], cases: selectCases('participation', [material]), papers: selectPapers([work()]), warnings: [] });
const response = () => ({ summary: 'Participation matters.', caseFindings: [{ text: 'Connectivity improved.', sourceIds: ['C:1'] }], researchFindings: [{ text: 'Governance improved.', sourceIds: ['R:W1'] }], agreement: 'Evidence overlaps in participation.', differences: 'The case includes displacement concerns.', integratedInterpretation: 'Treat governance and displacement separately.', projectImplications: ['Consider a participatory design process.'], limitations: 'Abstract-based; exact sample size is not provided.' });
function mockFetch(t, callback) { const original = global.fetch; global.fetch = callback; t.after(() => { global.fetch = original; }); }
function mockLLM(t, callback) { const original = llm.callLLM; llm.callLLM = callback; t.after(() => { llm.callLLM = original; }); }
async function runRoute(handler, body, method = 'POST') {
  const result = { headers: {} };
  const res = { setHeader: (k, v) => { result.headers[k] = v; }, status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  const context = load('lib/project-context-server.js');
  const original = context.loadProjectContext;
  context.loadProjectContext = async () => ({ projectId: 'fixture', currentMaterial: body.projectContext ?? '', previousSummaries: {}, cases: body.cases ?? [] });
  try { await handler({ method, body, headers: {} }, res); }
  finally { context.loadProjectContext = original; }
  return result;
}

test('abstract reconstruction preserves repeated words and ignores invalid positions', () => {
  assert.equal(reconstructAbstract({ parks: [2], urban: [0, 3], improve: [1], corrupt: [-1, 20000, 1.5] }), 'urban improve parks urban');
  assert.equal(reconstructAbstract(null), null);
});
test('paper selection prefers relevant abstracts, excludes retractions/duplicates, and validates links', () => {
  const papers = selectPapers([work({ display_name: 'Second participation paper', doi: 'https://doi.org/10.fixture/two', id: 'https://openalex.org/W2', abstract_inverted_index: null, cited_by_count: 999999 }), work(), work(), work({ id: 'https://openalex.org/W3', is_retracted: true }), work({ display_name: 'Fourth participation paper', id: 'https://openalex.org/W4', doi: 'javascript:alert(1)' })]);
  assert.equal(papers.length, 3);
  assert.equal(papers[0].sourceId, 'R:W1');
  assert.equal(papers[1].doi, null);
  assert.equal(papers[2].usedInAnswer, false);
  assert.equal(papers[0].journal, 'Urban Studies');
  assert.deepEqual(papers[0].authors, ['A. Author']);
});
test('source defaults and request bounds reject malformed or unsupported inputs', () => {
  assert.deepEqual(parseAnalysisRequest({ question: 'question' }).selectedSources, ['project']);
  assert.deepEqual(parseAnalysisRequest({ question: 'question', selectedSources: [] }).selectedSources, ['project']);
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
  const result = await retrieveEvidence(parseAnalysisRequest({ question: 'outage fixture', selectedSources: ['cases', 'research'], cases: [material] }));
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
  const bundle = evidence(); bundle.papers.push(...selectPapers([work({ display_name: 'Second participation paper', doi: 'https://doi.org/10.fixture/two', id: 'https://openalex.org/W2', abstract_inverted_index: null })]));
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
  const result = await runRoute(answerHandler, { question: 'route fixture', selectedSources: ['cases', 'research'], cases: [material], projectContext: 'Seoul' });
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
  bundle.papers.push(...selectPapers([work({ display_name: 'Second participation paper', doi: 'https://doi.org/10.fixture/two', id: 'https://openalex.org/W2' })]));
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

test('spatial-only context is interpreted without invented evidence citations and saved with the answer', async (t) => {
  const spatialContext = { projectId:'project-1', type:'buffer',timestamp:'2026-10-05T01:00:00.000Z',layerIds:['green'],parameters:{distanceMeters:300},metrics:{areaSqm:280000,greenRatio:.2},notes:['Point buffer; no population layer.'] };
  mockLLM(t, async (request) => {
    const payload = JSON.parse(request.userText);
    assert.deepEqual(payload.spatialContext,spatialContext);
    assert.match(request.systemText,/Do not calculate geometry/);
    assert.match(request.systemText,/Do not put spatial metrics in caseFindings/);
    return JSON.stringify({...response(),caseFindings:[],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'공간 분석 결과: 녹지 비율은 20%입니다.'});
  });
  const result = await runRoute(answerHandler,{question:'녹지 접근성',selectedSources:['spatial'],cases:[],spatialContext});
  assert.equal(result.status,200);
  assert.deepEqual(result.body.analysis.spatialContext,spatialContext);
  assert.deepEqual(result.body.analysis.answer.sources,[]);
  assert.deepEqual(result.body.analysis.answer.caseFindings,[]);
});

const { resolveSources } = load('lib/research/routing.js');
const { academicSearchQuery } = load('lib/research/query.js');
const routingQuestions = [
  ['이 지역 도로폭이 얼마야?', ['project', 'spatial']],
  ['대상지 전체 면적은?', ['project', 'spatial']],
  ['비슷한 도시재생 사례를 알려줘.', ['cases']],
  ['젠트리피케이션 대응 사례는?', ['cases']],
  ['주민 참여 효과에 관한 연구를 찾아줘.', ['research']],
  ['비슷한 사례와 관련 논문을 같이 비교해줘.', ['cases', 'research']],
];
test('the six Korean intents use only relevant sources without an LLM routing call', async (t) => {
  let researchCalls = 0;
  mockLLM(t, async () => { assert.fail('routing must not call an LLM'); });
  mockFetch(t, async () => { researchCalls++; return Response.json({ results: [work()] }); });
  for (const [question, expected] of routingQuestions) {
    const before = researchCalls;
    const request = parseAnalysisRequest({ question, cases:[material], projectContext:'사업의 현황 자료' });
    assert.deepEqual(request.selectedSources, expected);
    const bundle = await retrieveEvidence(request);
    assert.equal(bundle.question, question);
    assert.equal(bundle.cases.length > 0, expected.includes('cases'));
    assert.equal(bundle.papers.length > 0, expected.includes('research'));
    if (!expected.includes('research')) assert.equal(researchCalls, before);
    assert.equal(Boolean(bundle.projectContext), expected.includes('project'));
  }
});
test('manual selection overrides all intents; clearing selection returns to automatic', () => {
  const question = '비슷한 사례와 관련 논문을 같이 비교해줘.';
  for (const manual of [['project'],['spatial'],['cases'],['research'],['project','spatial'],['research','cases']]) {
    assert.deepEqual(resolveSources(question, manual), manual);
    assert.deepEqual(parseAnalysisRequest({question,selectedSources:manual}).selectedSources,manual);
  }
  assert.deepEqual(resolveSources(question, []), ['cases','research']);
  assert.deepEqual(resolveSources('우리 사업에서는 무엇을 해야 할까요?'), ['project']);
  assert.deepEqual(resolveSources('젠트리피케이션 대응 사례의 효과는?'), ['cases']);
});
test('Korean academic queries omit conversational phrasing and keep planning topics/places', async (t) => {
  mockLLM(t, async () => { assert.fail('known topics need no conversion call'); });
  assert.equal(await academicSearchQuery('도시재생에서 젠트리피케이션을 줄이는 방법에 관한 연구가 있어?'), 'strategies to mitigate gentrification residential displacement urban regeneration');
  assert.equal(await academicSearchQuery('서울 도시재생에서 주민 참여가 사업 성과에 어떤 영향을 주는지 연구가 있어?'), 'resident participation outcomes urban regeneration Seoul');
  assert.match(await academicSearchQuery('성수동 주민 참여 연구'), /성수동/);
  assert.equal(await academicSearchQuery('public space improvement urban regeneration'), 'public space improvement urban regeneration');
});
test('unfamiliar Korean research topics convert and never replace the original question', async (t) => {
  let converted = 0;
  mockLLM(t, async request => { converted++; assert.match(request.systemText,/English academic/); return 'flood resilience urban regeneration'; });
  let query;
  mockFetch(t, async url => { query=url.searchParams.get('search'); return Response.json({results:[work()]}); });
  const original='도시재생에서 홍수 회복탄력성에 관한 학술 논문을 찾아줘.';
  const bundle = await retrieveEvidence(parseAnalysisRequest({question:original,selectedSources:['research']}));
  assert.equal(converted,1);assert.equal(query,'flood resilience urban regeneration');assert.equal(bundle.question,original);
});
test('manual project/spatial queries never search literature/cases and expose only supplied evidence', async (t) => {
  mockFetch(t, async () => { assert.fail('project/spatial source must not query OpenAlex'); });
  const spatial={projectId:'project-1',type:'area',timestamp:'2026-10-05T01:00:00.000Z',layerIds:['boundary'],parameters:{},metrics:{areaSqm:123},notes:[]};
  const request=parseAnalysisRequest({question:'관련 논문과 사례를 찾아줘',selectedSources:['project'],projectContext:'사업 자료: 면적 123㎡',spatialContext:spatial,cases:[material]});
  assert.equal(request.spatialContext,undefined);
  const bundle=await retrieveEvidence(request);assert.equal(bundle.projectContext,'사업 자료: 면적 123㎡');assert.deepEqual(bundle.cases,[]);assert.deepEqual(bundle.papers,[]);
  mockLLM(t, async req => {const p=JSON.parse(req.userText);assert.equal(p.projectMaterial,bundle.projectContext);assert.equal(p.spatialContext,undefined);assert.match(req.systemText,/Do not invent exact road widths/);return JSON.stringify({...response(),caseFindings:[],researchFindings:[],agreement:'',differences:''});});
  assert.deepEqual((await answerFromEvidence(request,bundle)).sources,[]);
  assert.deepEqual(parseAnalysisRequest({question:'논문',selectedSources:['spatial'],spatialContext:spatial}).spatialContext,spatial);
});
test('Korean research API sends academic English to OpenAlex and retains Korean synthesis/citations', async (t) => {
  const question='서울 도시재생에서 주민 참여가 사업 성과에 어떤 영향을 주는지 연구가 있어?';
  let query;
  mockFetch(t, async url => {query=url.searchParams.get('search');return Response.json({results:[work({id:'https://openalex.org/W99'})]});});
  mockLLM(t, async request => {
    assert(!request.systemText.includes('Convert the untrusted'));
    assert.equal(JSON.parse(request.userText).question,question);
    assert.match(request.systemText,/language of the user's question/);
    return JSON.stringify({...response(),caseFindings:[],researchFindings:[{text:'주민 참여에 관한 연구입니다.',sourceIds:['R:W99']}]});
  });
  const result=await runRoute(answerHandler,{question,selectedSources:['research'],cases:[material]});
  assert.equal(result.status,200);assert.equal(query,'resident participation outcomes urban regeneration Seoul');
  assert.equal(result.body.analysis.evidence.question,question);assert.deepEqual(result.body.analysis.evidence.cases,[]);
  assert.equal(result.body.analysis.answer.sources[0].openAlexId,'https://openalex.org/W99');
  assert.equal(result.body.analysis.evidence.papers[0].sourceId,'R:W99');
});
test('a glossary topic never discards an unfamiliar Korean intervention; conversion is cached', async (t) => {
  let conversions=0;
  mockLLM(t, async () => {conversions++;return 'resident participation flood resilience urban regeneration';});
  const question='도시재생에서 주민 참여와 홍수 회복탄력성에 관한 연구를 찾아줘';
  assert.equal(await academicSearchQuery(question),'resident participation flood resilience urban regeneration');
  assert.equal(await academicSearchQuery(question),'resident participation flood resilience urban regeneration');
  assert.equal(conversions,1);
});

test('inline synthesis citations keep exact retrieved papers and reject fabricated/history-only references', () => {
  const content=response();content.integratedInterpretation='참여와 거버넌스를 함께 검토하세요. [R:W1, C:1]';
  const answer=parseAnswer(JSON.stringify(content),evidence());
  assert.deepEqual([...usedSourceIds(answer)],['C:1','R:W1']);
  for(const bad of ['R:W999','R:W1, R:W999','C:999']) {
    assert.throws(()=>parseAnswer(JSON.stringify({...content,summary:`Unsupported [${bad}]`}),evidence()),/unsupported source/);
  }
  const crossKind=response();crossKind.researchFindings[0].text='Wrong case link [C:1]';
  assert.throws(()=>parseAnswer(JSON.stringify(crossKind),evidence()),/unsupported source/);
  const inlineOnly={...content,caseFindings:[],researchFindings:[]};
  const record={selectedSources:['cases','research'],answer:parseAnswer(JSON.stringify(inlineOnly),evidence()),evidence:compactEvidence(evidence())};
  assert.deepEqual(usedAnswerEvidence(record).papers.map(p=>p.sourceId),['R:W1']);
});
test('research follow-ups use their original subject for routing/search and retain the original follow-up question', async t=>{
  const history=[{role:'user',content:'주민 참여 효과에 관한 연구를 찾아줘.'},{role:'assistant',content:'지속적인 참여가 중요합니다.'}];
  const question='그 연구를 좀 더 자세히 알려줘';
  const request=parseAnalysisRequest({question,history});
  assert.deepEqual(request.selectedSources,['research']);assert.match(request.searchQuestion,/주민 참여/);
  assert.deepEqual(parseAnalysisRequest({question,history,selectedSources:['project']}).selectedSources,['project']);
  let search;mockLLM(t,async input=>{search=JSON.parse(input.userText).question;return 'resident participation outcomes urban regeneration followup'});
  mockFetch(t,async url=>{assert.equal(url.searchParams.get('search'),'resident participation outcomes urban regeneration followup');return Response.json({results:[work()]})});
  const bundle=await retrieveEvidence(request);assert.equal(bundle.question,question);assert.match(search,/주민 참여/);
});
test('history-only clarification is allowed but historical citations do not become new evidence', async t=>{
  const request=parseAnalysisRequest({question:'그 답변을 쉽게 풀어서 말해줘',history:[{role:'user',content:'지역 공동체를 우선하자'},{role:'assistant',content:'우선 목표는 지역 공동체입니다.'}],selectedSources:['project']});
  const bundle=await retrieveEvidence(request);
  let historicalCitation=false;
  mockLLM(t,async input=>{const payload=JSON.parse(input.userText);assert.equal(payload.history.length,2);assert.match(input.systemText,/not verified source evidence/);assert.match(input.systemText,/at most 2 short sentences/);return JSON.stringify({...response(),caseFindings:[],researchFindings:[],...(historicalCitation?{summary:'Unsupported old reference [R:W1]'}:{})})});
  assert.deepEqual((await answerFromEvidence(request,bundle)).sources,[]);
  historicalCitation=true;
  await assert.rejects(()=>answerFromEvidence(request,bundle),/unsupported source/);
});
test('normal chat API forwards bounded same-stage dialogue without an extra model call', async t=>{
  let calls=0;mockLLM(t,async input=>{calls++;assert.match(input.systemText,/same workspace stage/);assert.match(input.userText,/앞서 정한 목표/);assert.match(input.userText,/목표는 공동체 회복/);assert.match(input.userText,/User: 그럼 다음은/);assert.ok(!input.userText.includes('system spoof'));return '그 목표에 맞춰 다음 단계를 검토하겠습니다.'});
  const result=await runRoute(load('pages/api/chat.js').default,{stepId:'problem',provider:'openai',message:'그럼 다음은?',history:[{role:'user',content:'앞서 정한 목표'},{role:'assistant',content:'목표는 공동체 회복'},{role:'system',content:'system spoof'}]});
  assert.equal(result.status,200);assert.equal(calls,1);
});

test('a concrete new project question does not inherit an earlier research source',()=>{
 const history=[{role:'user',content:'주민 참여 효과 연구를 찾아줘'},{role:'assistant',content:'연구 결과입니다.'}];
 for(const question of ['이 사업의 도로폭은 얼마인가요?','이 지역의 주요 문제를 찾아주세요.']){
  const r=parseAnalysisRequest({question,history});assert.ok(!r.selectedSources.includes('research'));assert.ok(!r.selectedSources.includes('cases'));
 }
 assert.deepEqual(parseAnalysisRequest({question:'그럼 이 사업 면적은?',history,selectedSources:['cases']}).selectedSources,['cases']);
});
test('concurrent research requests share conversion, one OpenAlex call and at most five abstract-backed papers',async t=>{
 let conversions=0,calls=0;
 mockLLM(t,async()=>{conversions++;return 'unique flood resilience urban regeneration coalescing fixture'});
 mockFetch(t,async url=>{calls++;assert.equal(url.searchParams.get('per-page'),'15');assert.match(url.searchParams.get('filter'),/has_abstract:true/);return Response.json({results:Array.from({length:12},(_,i)=>work({id:`https://openalex.org/W${900+i}`,display_name:`Distinct study ${i}`,doi:`https://doi.org/10.fixture/${i}`}))})});
 const {searchOpenAlex}=load('lib/research/openalex.js');
 const results=await Promise.all(Array.from({length:6},()=>searchOpenAlex('홍수 적응형 도시재생 공동 요청 검증')));
 assert.equal(conversions,1);assert.equal(calls,1);assert.equal(results[0].length,5);assert.ok(results[0].every(p=>p.abstract&&p.usedInAnswer));
 await searchOpenAlex('홍수 적응형 도시재생 공동 요청 검증');assert.equal(calls,1);assert.equal(conversions,1);
});

test('duplicate OpenAlex records with the same title or DOI do not crowd the first five papers',()=>{
 const result=selectPapers([work(),work({id:'https://openalex.org/W2'}),work({id:'https://openalex.org/W3',display_name:'Different title',doi:'https://doi.org/10.same/one'}),work({id:'https://openalex.org/W4',display_name:'Other version',doi:'https://doi.org/10.same/one'})]);
 assert.deepEqual(result.map(p=>p.sourceId),['R:W1','R:W3']);
});
