import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),load=p=>require(`${process.env.PSS_TEST_BUILD}/${p}`);
const context=load('lib/project-context-server.js'),llm=load('lib/llm/index.js'),alex=load('lib/research/openalex.js'),external=load('lib/research/external-cases.js'),geo=load('lib/spatial/geo-server.js'),caseSources=load('lib/research/case-sources-server.js'),retrieval=load('lib/research/evidence.js');
const routing=load('lib/research/routing.js'),query=load('lib/spatial/geo-query.js'),follow=load('lib/research/follow-up.js'),admin=load('lib/firebaseAdmin.js');
const handler=load('pages/api/research/answer.js').default;
const mock=(t,obj,key,value)=>{const old=obj[key];obj[key]=value;t.after(()=>obj[key]=old)};
const answer=summary=>({summary,caseFindings:[],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'',projectImplications:[],limitations:''});
const paper={sourceId:'R:W701',openAlexId:'https://openalex.org/W701',title:'Pedestrian priority streets',authors:[],year:2024,abstract:'Street reallocation improved walking conditions; loading access required local adaptation.',doi:null,journal:null,citationCount:1,openAccess:true,topics:[],usedInAnswer:true};
const caseItem={id:'external-fixture',sourceId:'C:WEB701',title:'Synthetic alley project',label:'Synthetic alley project',text:'A planting strip separated walking space from parking; loading access was retained.',relevanceTerms:[],origin:'external',url:'https://planning.example.gov/alley',evidenceLevel:'page',retrievedAt:'2026-01-01'};
const savedLog=(sender,text,extra={})=>({stepId:'data',sender,text,...extra});
function setup(t,logs=[]){
 const saved=structuredClone(logs),original=structuredClone(saved);
 const counts={papers:0,web:0,gis:0,passages:0,model:0,layers:0},sent=[];
 const ctx={projectId:'fixture',user:{uid:'resident-fixture'},currentMaterial:'사업 목표는 기존 골목에서 보행 공간과 녹지를 함께 확보하는 것입니다.',previousSummaries:{problem:'주차 때문에 걷는 길이 좁다는 주민 의견'},cases:[],stageHistory:saved};
 mock(t,context,'loadProjectContext',async()=>ctx);
 mock(t,admin,'adminDb',()=>assert.fail('No research record write or production DB access'));
 mock(t,global,'fetch',()=>assert.fail('Tests must not call a live provider'));
 mock(t,alex,'searchOpenAlex',async()=>{counts.papers++;return [structuredClone(paper)]});
 mock(t,external,'searchExternalCases',async()=>{counts.web++;return [structuredClone(caseItem)]});
 mock(t,caseSources,'readCasePassages',async()=>{counts.passages++;return []});
 mock(t,geo,'projectLayers',async()=>{counts.layers++;return {layers:[],warnings:[]}});
 mock(t,llm,'callLLM',async input=>{counts.model++;const data=JSON.parse(input.userText);sent.push({input,data});
  const cite=data.papers.length?' [R:W701]':data.cases.length?' [C:WEB701]':'';
  return JSON.stringify(answer(`**주차 구획 옆 보행 공간 확보**를 검토할 수 있어요.${cite} 물건을 내리는 자리는 남겨 두는 조합도 함께 살펴볼 수 있어요.`));
 });
 const call=async(question,selectedSources=[])=>{const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};await handler({method:'POST',headers:{},body:{question,selectedSources,history:[{role:'user',content:'stale client text'}]}},res);return res};
 t.after(()=>assert.deepEqual(saved,original,'Original dialogue must stay unchanged'));
 return {ctx,counts,sent,call};
}
test('1: an ordinary alley idea develops one spatial combination without automatic paper/case/GIS calls',async t=>{
 const f=setup(t,[savedLog('user','골목의 주차 일부를 녹지로 바꾸고 싶어요.')]);
 const r=await f.call('골목의 주차 일부를 녹지로 바꾸고 싶어요.');assert.equal(r.code,200);assert.equal(f.counts.model,1);assert.equal(f.counts.papers+f.counts.web+f.counts.gis+f.counts.layers,0);
 assert.match(r.body.reply,/보행 공간 확보/);assert.match(f.sent[0].input.systemText,/one useful physical refinement or combination/);assert.match(f.sent[0].input.systemText,/2–3 short sentences/);assert.equal(f.sent[0].data.previousStageSummaries.problem,'주차 때문에 걷는 길이 좁다는 주민 의견');
 assert.deepEqual(routing.resolveSources('다른 대안은 없어?'),['project']);
});
test('2: an explicit map request enters the existing GIS engine and forwards actual computed area once',async t=>{
 const f=setup(t),real=geo.executeGeoQuery;
 const boundary=load('lib/spatial/boundary.js');
 const layer={config:{id:'boundary',label:'사업구역',type:'polygon',role:'boundary',source:''},data:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[127,37.5],[127.01,37.5],[127.01,37.51],[127,37.51],[127,37.5]]]}}]}};
 const b=boundary.deriveBoundary(layer.data);
 mock(t,geo,'projectLayers',async()=>({layers:[layer],warnings:[],boundary:b,settings:{activeBoundaryDatasetId:'boundary',defaultNearbyMeters:500},boundaryLayerId:'boundary'}));
 mock(t,geo,'executeGeoQuery',async(...args)=>{f.counts.gis++;return real(...args)});
 const question='가정로126번길 지도에서 사업구역 면적을 계산해줘';assert.equal(query.isGeoQuestion(question),true);assert.ok(routing.resolveSources(question).includes('spatial'));
 const r=await f.call(question);assert.equal(r.code,200);assert.equal(f.counts.gis,1);assert.equal(f.counts.model,1);assert.ok(f.sent[0].data.spatialContext.metrics.areaSqm>0);assert.match(f.sent[0].data.spatialQueryResult.reply,/㎡|m²/);assert.equal(f.counts.papers+f.counts.web,0);
 const combined=await f.call('지도에서 사업구역 면적을 계산해줘. 보행자 우선도로 효과 논문도 찾아줘');assert.equal(combined.code,200);assert.equal(f.counts.gis,2);assert.equal(f.counts.papers,1);assert.equal(f.counts.model,2);assert.ok(f.sent[1].data.spatialContext.metrics.areaSqm>0);assert.equal(f.sent[1].data.papers[0].abstract,paper.abstract);
});
test('3: a pedestrian-priority research request retrieves one paper and passes its actual abstract/citation',async t=>{
 const f=setup(t);const r=await f.call('보행자 우선도로의 효과를 다룬 논문을 찾아줘');assert.equal(r.code,200);assert.equal(f.counts.papers,1);assert.equal(f.counts.web,0);assert.equal(f.counts.model,1);assert.equal(f.sent[0].data.papers[0].abstract,paper.abstract);assert.equal(r.body.analysis.answer.sources[0].openAlexId,paper.openAlexId);assert.match(r.body.reply,/R:W701/);
});
test('4: an overseas-case reference request uses external search without an unrelated registered-document detour',async t=>{
 const f=setup(t);f.ctx.cases=[{id:'registered',title:'등록 사례',label:'등록 사례',text:'등록된 본문'}];
 const r=await f.call('해외 골목개선 사례를 참고하고 싶어요.');assert.equal(r.code,200);assert.equal(f.counts.web,1);assert.equal(f.counts.passages,0);assert.equal(f.counts.papers,0);assert.equal(f.sent[0].data.cases[0].text,caseItem.text);assert.equal(r.body.analysis.answer.sources[0].url,caseItem.url);
});
test('5: applying the viewed case reuses cited excerpts and local conversation instead of re-searching',async t=>{
 const evidence={question:'해외 사례',selectedSources:['cases'],cases:[caseItem],papers:[],warnings:[]};
 const logs=[savedLog('user','주차 때문에 골목을 걷기 불편해요.'),savedLog('assistant','식재 띠를 보행 공간과 연결한 사례예요. [C:WEB701]',{analysis:{selectedSources:['cases'],answer:{...answer('식재 띠와 주차를 나눴습니다. [C:WEB701]'),sources:[{sourceId:caseItem.sourceId,kind:'cases',title:caseItem.title,url:caseItem.url}]},evidence}})];
 const f=setup(t,logs);const r=await f.call('이 사례를 우리 골목에 적용하려면 어떻게 해?');assert.equal(r.code,200);assert.equal(f.counts.web+f.counts.papers+f.counts.passages,0);assert.equal(f.counts.model,1);assert.equal(f.sent[0].data.cases[0].text,caseItem.text);assert.equal(f.sent[0].data.history[0].content,logs[0].text);assert.match(f.sent[0].input.systemText,/Reused evidence retains its original scope and date/);
});
test('6: failed GIS and paper tools disclose failures while one answer uses the preserved project/dialogue',async t=>{
 const f=setup(t,[savedLog('user','걸을 길을 남기는 것이 중요해요.')]);
 mock(t,geo,'projectLayers',async()=>{throw Error('PRIVATE GIS failure')});mock(t,alex,'searchOpenAlex',async()=>{f.counts.papers++;throw Error('PRIVATE HTTP 429')});
 const r=await f.call('지도에서 사업구역을 분석하고 보행자 우선도로 효과 논문도 찾아줘');assert.equal(r.code,200);assert.equal(f.counts.model,1);assert.equal(f.counts.papers,1);assert.match(r.body.reply,/공간 분석을 완료하지 못/);assert.match(r.body.reply,/연구논문 검색을 완료하지 못/);assert.doesNotMatch(r.body.reply,/PRIVATE|HTTP 429/);assert.equal(r.body.analysis.answer.sources.length,0);assert.equal(f.sent[0].data.history[0].content,'걸을 길을 남기는 것이 중요해요.');
});
test('7: a resident objection develops the revised idea without another list or unrequested tool calls',async t=>{
 const logs=[savedLog('user','길가에 나무를 심고 싶어요.'),savedLog('assistant','식재 띠로 걸을 자리를 구분해볼 수 있어요.')];const f=setup(t,logs);
 const r=await f.call('나무는 관리가 어려워서 싫어요. 대신 걷는 공간 표시만 하고 싶어요.');assert.equal(r.code,200);assert.equal(f.counts.papers+f.counts.web+f.counts.layers,0);assert.equal(f.sent[0].data.history[0].content,logs[0].text);assert.match(f.sent[0].input.systemText,/revise it when they object/);assert.match(f.sent[0].input.systemText,/Do not replace their idea with a fresh solution list/);
});
test('mixed explicit cases and research keep both sources; earlier map results are explanations, not new executions',async t=>{
 const f=setup(t);const r=await f.call('사례의 설계 방법과 보행자 우선도로 효과 논문을 같이 비교해줘');assert.equal(r.code,200);assert.equal(f.counts.papers,1);assert.ok(r.body.analysis.selectedSources.includes('cases'));assert.ok(r.body.analysis.selectedSources.includes('research'));
 assert.equal(query.requestsSpatialAnalysis('이 공간 분석이 우리 사업에 어떤 의미가 있어?'),false);
 assert.equal(query.requestsSpatialAnalysis('보행자 우선도로의 효과를 분석해주는 논문을 찾아줘'),false);
 assert.equal(query.requestsSpatialAnalysis('여기 쉼터를 만들면 어떨지 지도에서 분석해줘'),true);
 assert.equal(query.requestsSpatialAnalysis('지도 분석을 실행하지 말고 방법만 설명해줘'),false);
 assert.equal(routing.wantsNewCases('이 사례와 비슷한 해외 사례를 참고하고 싶어요'),true);assert.equal(routing.wantsNewCases('이 해외 사례를 우리 골목에 적용하려면 어떻게 해?'),false);
});
test('a case-document lookup failure retains registered body and discloses the failure without breaking chat',async t=>{
 const f=setup(t);f.ctx.cases=[{id:'registered',title:'골목 사례',label:'골목 사례',text:'보행 구획을 표시한 등록된 사례 본문'}];
 mock(t,caseSources,'readCasePassages',async()=>{throw Error('PRIVATE document failure')});
 mock(t,llm,'callLLM',async input=>{f.counts.model++;const data=JSON.parse(input.userText);assert.match(data.cases[0].text,/등록된 사례 본문/);return JSON.stringify(answer('등록된 본문에는 보행 구획 표시가 나와요. [C:1]'))});
 const r=await f.call('골목 사례의 설계 방법을 알려줘');assert.equal(r.code,200);assert.match(r.body.reply,/사례 문서 검색을 완료하지 못/);assert.doesNotMatch(r.body.reply,/PRIVATE/);assert.equal(f.counts.model,1);
});

test('a deliberate manual source restriction remains in force and explicitly explains an unexecuted search',async t=>{
 const f=setup(t);const r=await f.call('보행자 우선도로 효과 논문을 찾아줘',['project']);assert.equal(r.code,200);assert.equal(f.counts.papers,0);assert.match(r.body.reply,/현재 자료 선택에 학술 연구가 없어/);assert.match(r.body.reply,/실행하지 않았어요/);assert.match(r.body.reply,/자동 선택/);
});
