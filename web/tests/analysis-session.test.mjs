import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.join(process.env.PSS_TEST_BUILD, 'session-test.js'));
const load = file => require(path.join(process.env.PSS_TEST_BUILD, file));
const { analysisActivities, parseAnalysisActivity, analysisSessionContext, analysisSessionQuestion } = load('lib/analysis-session.js');
const { conversationHistory, mergeStepChatLogs } = load('lib/chat-history.js');
const { summaryDialogue } = load('lib/facilitation.js');
const { resolveSources } = load('lib/research/routing.js');
const cases = [{ id: 'forest', title: '경의선숲길', label: '경의선숲길', text: '폐선 부지를 공원으로 전환한 사례입니다.' }, { id: 'lane', title: 'Guildford Lane', label: 'Guildford Lane', text: '골목 사례 자료입니다.' }];
const spatial = { projectId: 'p', type: 'buffer', timestamp: '2026-11-06T00:00:00.000Z', layerIds: ['facilities'], parameters: { distanceMeters: 500 }, metrics: { facilityCount: 6 }, notes: [] };
const activity = (type, extra = {}) => ({ id: 'a', projectId: 'p', type, referenceId: 'forest', title: '경의선숲길', ...extra });
const log = (activity, time = 1) => ({ stepId: 'data', sender: 'assistant', provider: 'openai', text: 'Viewed material', createdAt: new Date(time).toISOString(), activity });
function mock(t, target, key, value) { const previous = target[key]; target[key] = value; t.after(() => target[key] = previous); }
const response = () => ({ summary: '공간 분석 결과 공공시설은 6곳입니다.', caseFindings: [], researchFindings: [], agreement: '', differences: '', integratedInterpretation: '', projectImplications: [], limitations: '', sources: [] });

test('activity restoration strips geometry, unknown properties and place-choice secrets and isolates projects', () => {
  const result = parseAnalysisActivity(activity('spatial', { result: { ...spatial, geometry: { private: true } }, location: { question: '가좌역 주변', reply: '공공시설 6곳', scopeMeters: 500, places: [{ id: 'station', name: '가좌역', coordinate: [126.9, 37.5], choiceToken: 'secret' }] }, token: 'secret' }), 'p');
  assert.equal(result.result.metrics.facilityCount, 6);
  assert.equal(result.location.scopeMeters, 500);
  assert.doesNotMatch(JSON.stringify(result), /secret|geometry/);
  assert.equal(parseAnalysisActivity(result, 'other'), undefined);
  assert.equal(parseAnalysisActivity(activity('spatial', { result: { ...spatial, metrics: { area: Infinity } } }), 'p'), undefined);
  assert.equal(analysisActivities([log(result), { ...log(result), stepId: 'problem' }], 'p').length, 1);
});

test('viewing context uses authorized current case content and never becomes dialogue or participant opinion', () => {
  const logs = [{ stepId: 'data', sender: 'user', text: '공간을 확인해주세요.' }, ...Array.from({ length: 30 }, (_, i) => log(activity('cases', { id: `a${i}`, title: 'forged', referenceId: 'forest' }), i + 1))];
  assert.deepEqual(conversationHistory(logs, 'data'), [{ role: 'user', content: '공간을 확인해주세요.' }]);
  assert.deepEqual(summaryDialogue(logs).messages, [{ role: 'user', content: '공간을 확인해주세요.' }]);
  const context = analysisSessionContext(logs, 'p', cases);
  assert.equal(context.length, 12);
  assert.equal(context[0].title, '경의선숲길');
  assert.equal(context[0].material, cases[0].text);
  assert.deepEqual(analysisSessionContext(logs, 'p', [], ['cases']), []);
  assert.deepEqual(analysisSessionContext(logs, 'p', cases, ['research']), []);
});

test('current material resolves follow-ups while explicit new cases and manual sources take precedence', () => {
  const selected = [activity('cases')];
  assert.match(analysisSessionQuestion('우리 지역에 적용할 만한 점은 뭐야?', selected, cases), /^경의선숲길/);
  assert.equal(analysisSessionQuestion('Guildford Lane에서 여기와 다른 점은?', selected, cases), 'Guildford Lane에서 여기와 다른 점은?');
  assert.equal(analysisSessionQuestion('대상지 전체 면적은?', selected, cases), '대상지 전체 면적은?');
  assert.deepEqual(resolveSources(analysisSessionQuestion('우리 지역에 적용하면?', selected, cases), ['research'], cases), ['research']);
  const query = analysisSessionQuestion('여기서 어떤 특징이 보여?', [activity('spatial', { title: '가좌역 주변 500m', result: spatial })], cases);
  assert.deepEqual(resolveSources(query), ['project', 'spatial']);
  assert.deepEqual(resolveSources(analysisSessionQuestion('이 논문은?', [activity('research', { title: 'Resident participation', referenceId: 'https://openalex.org/W1' })], cases)), ['research']);
});

test('concurrent response snapshots retain activities, distinct revisits and dialogue without duplicates', () => {
  const viewed = log(activity('cases'));
  const revisit = log(activity('cases', { id: 'revisit' }), 3);
  const question = { stepId: 'data', sender: 'user', provider: 'openai', text: '어떻게 적용할까?', createdAt: new Date(2).toISOString() };
  const answer = { ...question, sender: 'assistant', text: '근거를 비교해봅시다.', createdAt: new Date(4).toISOString() };
  const merged = mergeStepChatLogs([viewed, question, revisit], [viewed, question, answer]);
  assert.equal(merged.length, 4);
  assert.equal(merged.filter(l => l.activity).length, 2);
  assert.equal(conversationHistory(merged).length, 2);
});

test('API retrieves the currently viewed case rather than a stale case in chat history', async t => {
  const project = load('lib/project-context-server.js'), sources = load('lib/research/case-sources-server.js'), llm = load('lib/llm/index.js');
  let retrieved;
  mock(t, project, 'loadProjectContext', async () => ({ projectId: 'p', spatialData: { layers: [], warnings: [] }, currentMaterial: '현재 사업 자료', previousSummaries: {}, cases, stageHistory: [log(activity('cases'))] }));
  mock(t, sources, 'readCasePassages', async (_pid, selected) => { retrieved = selected; return []; });
  const calls = [];
  mock(t, llm, 'callLLM', async request => { calls.push(request); return request.systemText.includes('Select semantically relevant') ? JSON.stringify({ sourceIds: ['C:1'], researchQuery: '' }) : JSON.stringify(response()); });
  const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(body) { this.body = body; } };
  await load('pages/api/research/answer.js').default({ method: 'POST', headers: {}, body: { projectId: 'p', question: '우리 지역에 적용할 만한 점은 뭐야?', history: [{ role: 'user', content: 'Guildford Lane을 설명해줘' }], selectedSources: [] } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(retrieved.map(c => c.id), ['forest']);
  const sent = JSON.parse(calls.at(-1).userText);
  assert.equal(sent.question, '우리 지역에 적용할 만한 점은 뭐야?');
  assert.equal(sent.analysisSession[0].material, cases[0].text);
  assert.deepEqual(sent.cases.map(c => c.id), ['forest']);
  assert.equal(calls.length, 2); // Existing passage retrieval + answer, no activity/routing LLM call.
});

test('restored GIS activity supplies actual metrics without triggering case/OpenAlex searches', async t => {
  const project = load('lib/project-context-server.js'), sources = load('lib/research/case-sources-server.js'), llm = load('lib/llm/index.js');
  mock(t, project, 'loadProjectContext', async () => ({ projectId: 'p', spatialData: { layers: [], warnings: [] }, currentMaterial: '사업 자료', previousSummaries: {}, cases, stageHistory: [log(activity('spatial', { title: '가좌역 주변 500m', result: spatial }))] }));
  mock(t, sources, 'readCasePassages', async () => assert.fail('No case lookup'));
  mock(t, global, 'fetch', async () => assert.fail('No external retrieval'));
  let calls = 0;
  mock(t, llm, 'callLLM', async request => { calls++; const sent = JSON.parse(request.userText); assert.equal(sent.spatialContext.metrics.facilityCount, 6); assert.match(request.systemText, /not participant opinions/); return JSON.stringify(response()); });
  const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(body) { this.body = body; } };
  await load('pages/api/research/answer.js').default({ method: 'POST', headers: {}, body: { projectId: 'p', question: '여기서 어떤 특징이 보여?', selectedSources: [] } }, res);
  assert.equal(res.code, 200); assert.equal(calls, 1);
  assert.deepEqual(res.body.analysis.selectedSources, ['project', 'spatial']);
});

test('Data stage summary receives activities and calculations separately from attributed dialogue', async t => {
  const project = load('lib/project-context-server.js'), admin = load('lib/firebaseAdmin.js');
  const prior = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'fixture'; t.after(() => prior === undefined ? delete process.env.OPENAI_API_KEY : process.env.OPENAI_API_KEY = prior);
  const logs = [{ stepId: 'data', sender: 'user', text: '어르신이 가까이 이용할 수 있으면 좋겠어요.' }, log(activity('spatial', { title: '가좌역 주변 500m', result: spatial })), log(activity('cases'))];
  mock(t, project, 'loadProjectContext', async () => ({ projectId: 'p', user: { uid: 'u' }, currentMaterial: '사업 자료', previousSummaries: {}, cases }));
  mock(t, admin, 'adminDb', () => ({ doc: () => ({ get: async () => ({ data: () => ({ logs }) }) }) }));
  mock(t, global, 'fetch', async (_url, options) => {
    const sent = JSON.parse(options.body);
    const input = JSON.parse(sent.input.split('Input JSON: ')[1].split('\n\nReturn JSON')[0]);
    assert.equal(input.analysisActivities.length, 2);
    assert.equal(input.analysisActivities[0].result.metrics.facilityCount, 6);
    assert.deepEqual(input.dialogue, [{ role: 'user', content: '어르신이 가까이 이용할 수 있으면 좋겠어요.' }]);
    assert.match(sent.input, /not participant opinions/);
    const result = { workspaceSummary: { stageSummaries: { problem: '', data: '접근성을 중요하게 보며 시설 분석과 사례를 확인했다.', alternatives: '', evaluation: '', report: '' }, overallSummary: '자료 분석을 진행했다.' } };
    return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
  });
  const res = { status(n) { this.code = n; return this; }, json(body) { this.body = body; } };
  await load('pages/api/workspace-summary.js').default({ method: 'POST', headers: {}, body: { projectId: 'p', currentStage: 'data' } }, res);
  assert.equal(res.code, 200);
});

test('explicit material references recover that source rather than a later unrelated activity', () => {
  const activities = [activity('cases'), activity('research', { title: 'Resident participation', referenceId: 'https://openalex.org/W1' }), activity('spatial', { title: '가좌역 주변 500m', result: spatial })];
  assert.match(analysisSessionQuestion('그 사례를 우리 지역에 적용하면?', activities, cases), /^경의선숲길/);
  assert.match(analysisSessionQuestion('이 논문을 설명해줘', activities, cases), /^Research: Resident participation/);
  assert.equal(analysisSessionQuestion('우리 지역 도로폭이 얼마야?', [activity('cases')], cases), '우리 지역 도로폭이 얼마야?');
});

test('a newly inspected location cannot inherit metrics from an earlier area analysis', async t => {
  const project = load('lib/project-context-server.js'), llm = load('lib/llm/index.js');
  const current = activity('spatial', { title: '새로 선택한 건물', referenceId: 'building-2', location: { question: '선택한 건물', reply: 'Selected feature; location only.', places: [{ id: 'building-2', name: '새로 선택한 건물', coordinate: [126.9, 37.5] }] } });
  mock(t, project, 'loadProjectContext', async () => ({ projectId: 'p', spatialData: { layers: [], warnings: [] }, currentMaterial: '사업 자료', previousSummaries: {}, cases, stageHistory: [log(activity('spatial', { title: '가좌역 주변', result: spatial })), log(current, 2)] }));
  mock(t, llm, 'callLLM', async request => { const input = JSON.parse(request.userText); assert.equal(input.spatialContext, undefined); assert.equal(input.analysisSession.at(-1).title, current.title); return JSON.stringify(response()); });
  const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(body) { this.body = body; } };
  await load('pages/api/research/answer.js').default({ method: 'POST', headers: {}, body: { projectId: 'p', question: '여기서 어떤 특징이 보여?', selectedSources: [] } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.analysis.spatialContext, undefined);
});

test('legacy layer activations become viewing metadata, never GIS results or raw JSON replies', () => {
  const viewed = activity('spatial', { referenceId: 'category-0', title: '생활시설', location: { question: '생활시설', reply: JSON.stringify({ displayedLayers: [{ id: 'facilities', name: '공공시설', featureCount: 3 }, { id: 'boundary', name: '사업구역', featureCount: 1 }] }), places: [] } });
  const [entry] = analysisSessionContext([log(viewed)], 'p', cases, ['spatial']);
  assert.equal(entry.contextKind, 'view_activity');
  assert.equal(entry.result, undefined);
  assert.equal(entry.location, undefined);
  assert.equal(entry.metadata.displayedLayers[0].uploadedFeatureCount, 3);
  assert.doesNotMatch(JSON.stringify(entry), /"reply"|"metrics"/);
  const calculated = analysisSessionContext([log(activity('spatial', { result: spatial }))], 'p', cases, ['spatial'])[0];
  assert.equal(calculated.contextKind, 'computed_gis_result');
  assert.equal(calculated.result.metrics.facilityCount, 6);
});

test('recorded POIs retain names/coordinates but no historical prose is promoted to computed relations', () => {
  const observed = activity('spatial', { title: '공원 검색', location: { question: '주변 공원을 보여줘', reply: '동쪽에 집중되며 보행 접근성이 좋다.', scopeMeters: 500, places: [{ id: 'park', name: '새빛 공원', coordinate: [127,37.5] }] } });
  const entry = analysisSessionContext([log(observed)], 'p', cases)[0];
  assert.equal(entry.contextKind, 'recorded_place_lookup');
  assert.equal(entry.location.places[0].name, '새빛 공원');
  assert.doesNotMatch(JSON.stringify(entry), /접근성이 좋다|동쪽에 집중/);
  assert.equal(entry.result, undefined);
});

test('compact authorized spatial samples distinguish unknown/current selection and recorded visibility without GeoJSON', () => {
  const { spatialPromptContext } = load('lib/spatial/context.js');
  const data = [{ config: { id: 'facilities', label: '공공시설', role: 'facilities', type: 'point' }, data: { type: 'FeatureCollection', features: Array.from({ length: 100 }, (_, index) => ({ type: 'Feature', id: String(index), properties: { name: `시설 ${index}`, secret: 'not-for-prompt' }, geometry: { type: 'Point', coordinates: [127 + index/1000,37.5] } })) } }];
  const context = spatialPromptContext(data, { selected: { layerId: 'facilities', featureId: '99' } }, [], true);
  assert.equal(context.visibility.status, 'unknown');
  assert.equal(context.selectedFeature.name, '시설 99');
  assert.deepEqual(context.selectedFeature.coordinate, [127.099,37.5]);
  assert.equal(context.registeredLayers[0].metadata.uploadedFeatureCount, 100);
  assert.equal(context.featureSamples.length, 2);
  assert.equal(context.boundary.available, true);
  assert.deepEqual(context.computedSpatialRelations, []);
  assert.doesNotMatch(JSON.stringify(context), /FeatureCollection|"geometry":|not-for-prompt/);
  assert.ok(JSON.stringify(context).length < 4000);
  const old = activity('spatial', { referenceId: 'category-0', location: { question: '자료 보기', reply: JSON.stringify({ displayedLayers: [{ id: 'facilities' }, { id: 'unauthorized-project-layer' }] }), places: [] } });
  const snapshot = spatialPromptContext(data, {}, [old], true);
  assert.deepEqual(snapshot.visibility.lastViewedLayerIds, ['facilities']);
  assert.equal(snapshot.visibility.status, 'last_recorded_view_only');
  assert.equal(snapshot.selectedFeature, undefined);
});

test('spatial answer prioritizes verified samples and project concerns, with no fixed headings or added model call', async t => {
  const project = load('lib/project-context-server.js'), llm = load('lib/llm/index.js'), server = load('lib/spatial/geo-server.js');
  const observed = activity('spatial', { referenceId: 'category-0', location: { question: '공공시설', reply: JSON.stringify({ displayedLayers: [{ id: 'facilities', name: '공공시설', featureCount: 3 }] }), places: [] } });
  mock(t, project, 'loadProjectContext', async () => ({ projectId: 'p', currentMaterial: '회복의 숲길을 주변 생활공간과 연결하는 사업', previousSummaries: { problem: '참여자가 보행 불편 경험을 이야기했다.' }, cases, stageHistory: [log(observed)], spatialData: { layers: [{ config: { id: 'facilities', label: '공공시설', role: 'facilities', type: 'point' }, data: { features: [{ type: 'Feature', id: 'a', properties: { name: '주민센터' }, geometry: { type: 'Point', coordinates: [127,37.5] } }] } }], boundary: {} } }));
  mock(t, server, 'projectLayers', async () => assert.fail('Selected material must reuse an already authorized dataset load'));
  let calls = 0;
  const direct = '현재 공간자료는 숲길과 주변 생활공간의 연결 방안을 검토하는 데 활용할 수 있습니다. 등록된 주민센터 위치를 확인할 수 있지만 실제 보행 접근성은 아직 판단하기 어렵습니다.';
  mock(t, llm, 'callLLM', async input => {
    calls++;
    const sent=JSON.parse(input.userText);
    assert.equal(sent.analysisSession[0].contextKind,'view_activity');
    assert.equal(sent.analysisSession[0].location,undefined);
    assert.equal(sent.spatialContext,undefined);
    assert.equal(sent.registeredSpatialContext.featureSamples[0].name,'주민센터');
    assert.equal(sent.retrievalWarnings.length,0);
    assert.match(sent.previousStageSummaries.problem,/참여자/);
    assert.match(input.systemText,/Activity is not a spatial analysis result/);
    assert.match(input.systemText,/Never compute or infer distance/);
    assert.match(input.systemText,/participant experiences as reported concerns/);
    return JSON.stringify({ ...response(), summary: direct });
  });
  const res={ setHeader(){}, status(n){this.code=n;return this}, json(body){this.body=body} };
  await load('pages/api/research/answer.js').default({method:'POST',headers:{},body:{projectId:'p',question:'이 공간 분석이 우리 사업에 어떤 의미가 있어?',selectedSources:['spatial']}},res);
  assert.equal(res.code,200); assert.equal(calls,1);
  assert.equal(res.body.analysis.answer.format,'direct');
  assert.equal(res.body.analysis.answer.summary,direct);
  assert.equal(res.body.analysis.answer.integratedInterpretation,'');
  assert.deepEqual(res.body.analysis.answer.projectImplications,[]);
  assert.equal(res.body.analysis.registeredSpatialContext,undefined); // Prompt-only, not a new saved field.
});

test('Data summary keeps layer-view counts in metadata and actual GIS metrics in a distinct computed record', async t => {
 const project=load('lib/project-context-server.js'),admin=load('lib/firebaseAdmin.js');
 const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture';t.after(()=>prior===undefined?delete process.env.OPENAI_API_KEY:process.env.OPENAI_API_KEY=prior);
 const viewed=activity('spatial',{referenceId:'category-0',location:{question:'생활시설',reply:JSON.stringify({displayedLayers:[{id:'facilities',name:'공공시설',featureCount:3}]}),places:[]}});
 const logs=[{stepId:'data',sender:'user',text:'보행 연결을 중요하게 생각해요.'},log(viewed),log(activity('spatial',{id:'calculated',result:spatial}),2)];
 mock(t,project,'loadProjectContext',async()=>({projectId:'p',user:{uid:'u'},currentMaterial:'사업 자료',previousSummaries:{},cases}));
 mock(t,admin,'adminDb',()=>({doc:()=>({get:async()=>({data:()=>({logs})})})}));
 mock(t,global,'fetch',async(_url,options)=>{
  const body=JSON.parse(options.body),input=JSON.parse(body.input.split('Input JSON: ')[1].split('\n\nReturn JSON')[0]);
  assert.equal(input.analysisActivities[0].contextKind,'view_activity');assert.equal(input.analysisActivities[0].result,undefined);assert.equal(input.analysisActivities[0].metadata.displayedLayers[0].uploadedFeatureCount,3);
  assert.equal(input.analysisActivities[1].contextKind,'computed_gis_result');assert.equal(input.analysisActivities[1].result.metrics.facilityCount,6);
  assert.match(body.input,/never summarize a layer activation as an analytical finding/);
  return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({workspaceSummary:{stageSummaries:{problem:'',data:'보행 연결을 중요하게 보며 자료 확인과 공간 분석을 진행했다.',alternatives:'',evaluation:'',report:''},overallSummary:'공간자료 검토'}})}]}]});
 });
 const res={status(n){this.code=n;return this},json(body){this.body=body}};
 await load('pages/api/workspace-summary.js').default({method:'POST',headers:{},body:{projectId:'p',currentStage:'data'}},res);assert.equal(res.code,200);
});

test('spatial answer guidance leads with feasible actions/results and knows service availability without exposing keys',async t=>{
 const {spatialPromptContext,spatialAnswerRules}=load('lib/spatial/context.js');
 const context=spatialPromptContext([],{},[],true,{nearbyPlaces:false,priority:false});
 const pointContext=spatialPromptContext([],{point:[127,37.5]},[],false,{nearbyPlaces:false,priority:false});assert.deepEqual(pointContext.selectedMapPoint.coordinate,[127,37.5]);assert.equal(pointContext.availableTools.distance,true);
 assert.equal(context.availableTools.nearbyPlaces,false);assert.equal(context.availableTools.areaStatistics,true);assert.equal(context.availableTools.priority,false);
 assert.match(spatialAnswerRules,/what this platform can do NOW/);assert.match(spatialAnswerRules,/Do not open with data insufficiency/);assert.match(spatialAnswerRules,/optionally ONE next action/);assert.match(spatialAnswerRules,/A limitation must not outweigh the actual result/);
 assert.match(spatialAnswerRules,/Never compute or infer distance/);assert.match(spatialAnswerRules,/Activity is not a spatial analysis result/);
 const project=load('lib/project-context-server.js'),llm=load('lib/llm/index.js');
 const original=process.env.KAKAO_REST_API_KEY;delete process.env.KAKAO_REST_API_KEY;t.after(()=>original===undefined?delete process.env.KAKAO_REST_API_KEY:process.env.KAKAO_REST_API_KEY=original);
 mock(t,project,'loadProjectContext',async()=>({projectId:'p',currentMaterial:'대상 가로와 생활공간의 연결',previousSummaries:{problem:'참여자는 보행 불편을 이야기했다.'},cases:[],stageHistory:[],spatialData:{layers:[],boundary:{},warnings:[]}}));
 let count=0;mock(t,llm,'callLLM',async input=>{count++;const sent=JSON.parse(input.userText);assert.equal(sent.registeredSpatialContext.availableTools.nearbyPlaces,false);assert.match(sent.previousStageSummaries.problem,/참여자/);return JSON.stringify({...response(),summary:'먼저 사업구역의 등록된 공간자료를 함께 확인할 수 있습니다.'})});
 const res={setHeader(){},status(n){this.code=n;return this},json(body){this.body=body}};
 await load('pages/api/research/answer.js').default({method:'POST',headers:{},body:{projectId:'p',question:'이 공간 분석이 우리 사업에 어떤 의미가 있어?',selectedSources:['spatial']}},res);assert.equal(res.code,200);assert.equal(count,1);assert.equal(res.body.analysis.answer.format,'direct');
});
