import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url),build=process.env.PSS_TEST_BUILD;
const routing=require(`${build}/lib/research/routing.js`),geo=require(`${build}/lib/spatial/geo-query.js`),server=require(`${build}/lib/spatial/geo-server.js`);
const evidence=require(`${build}/lib/research/evidence.js`),llm=require(`${build}/lib/llm/index.js`),papers=require(`${build}/lib/research/openalex.js`),session=require(`${build}/lib/analysis-session.js`),kakao=require(`${build}/lib/spatial/kakao-server.js`);
function mock(t,obj,key,value){const old=obj[key];obj[key]=value;t.after(()=>obj[key]=old)}
const input=(question,extra={})=>({question,selectedSources:['cases'],cases:[],projectContext:'사업 배경',provider:'openai',history:[],...extra});

test('planning expressions permit judgment without hijacking literature or basic fact routing',()=>{
 for(const q of ['어떻게 하는 게 좋을까?','이 방법 괜찮을까?','어떻게 개선할 수 있어?','너라면 어떻게 할 것 같아?','어떤 방법을 생각해볼 수 있어?','이게 우리 지역에 적합할까?','다른 대안은 없어?','해결 방법을 추천해줘','이 방법이 효과가 있을 가능성이 있어?','어떻게 해야 할까?'])assert.equal(routing.wantsImplications(q),true,q);
 assert.deepEqual(routing.resolveSources('이게 우리 지역에 적합할까?'),['project']);
 assert.deepEqual(routing.resolveSources('300m 버퍼 효과에 관한 연구 찾아줘'),['research']);
 assert.deepEqual(routing.resolveSources('왜 이 장소가 번잡한지 확인해봐'),['project','spatial']);
 assert.ok(geo.spatialToolRequest('이 장소가 왜 번잡한지 확인해봐')?.exploratory);
 for(const q of ['주변 확인해봐','이 근처 공공시설 찾아봐','300m 이내 찾아줘','여기 주변에 뭐가 있어?'])assert.equal(geo.isGeoQuestion(q),true,q);
 assert.equal(geo.parseGeoPlan('여기 주변에 뭐가 있어?').query,'편의시설');
 assert.equal(geo.parseGeoPlan('여기 주변에 외국 음식점이 몇 개야?').query,'외국 음식점');
 assert.equal(geo.parseGeoPlan('300m 이내 찾아줘').radius,300);
 assert.equal(geo.spatialConversationQuestion('확인해봐',[{role:'user',content:'여기 주변 외국 음식점 찾아줘'},{role:'assistant',content:'검색을 시도할까요?'}]),'여기 주변 외국 음식점 찾아줘');
 assert.equal(geo.spatialConversationQuestion('찾아봐',[{role:'user',content:'논문 찾아줘'}]),'찾아봐');
 assert.deepEqual(routing.resolveSources('주변 공공시설 찾아줘',['research']),['research']);
});

test('explicit research survives an empty helper query, including manual combined sources',async t=>{
 const material={id:'a',title:'사례 A',label:'사례 A',text:'A project with participation.',sourceId:'',relevanceTerms:[],documentId:'d',passageId:'p1'};
 mock(t,llm,'callLLM',async req=>JSON.stringify({sourceIds:[JSON.parse(req.userText).passages[0].sourceId],researchQuery:''}));
 const calls=[];mock(t,papers,'searchOpenAlex',async q=>{calls.push(q);return []});
 const result=await evidence.retrieveEvidence(input('사례 A에서 참여 방법이 효과 있어? 관련 연구도 찾아줘',{cases:[material],casePassages:[material],selectedSources:['cases','research']}));
 assert.equal(calls.length,1);assert.equal(result.cases.length,1);
});

test('new real-world examples fall back to OpenAlex without substituting an unrelated case',async t=>{
 mock(t,llm,'callLLM',async()=>JSON.stringify({sourceIds:[],researchQuery:''}));
 const calls=[];mock(t,papers,'searchOpenAlex',async q=>{calls.push(q);return []});
 const material={id:'a',title:'도로 사업',label:'도로',text:'도로 포장에 관한 기록.'};
 const result=await evidence.retrieveEvidence(input('지속가능하게 운영되는 마을 텃밭 사례를 찾아줘',{cases:[material],casePassages:[]}));
 assert.equal(result.cases.length,0);assert.equal(calls.length,1);assert.match(calls[0],/actual implemented case studies/);assert.ok(result.warnings.some(w=>/no general web case-search/.test(w.message)));
});

test('a semantic miss in registered documents triggers literature rather than unrelated material',async t=>{
 mock(t,llm,'callLLM',async()=>JSON.stringify({sourceIds:[],researchQuery:''}));let count=0;mock(t,papers,'searchOpenAlex',async()=>{count++;return []});
 const material={id:'a',title:'포장 사례',label:'포장',text:'포장 기록',sourceId:'',relevanceTerms:[],documentId:'d',passageId:'p1'};
 const result=await evidence.retrieveEvidence(input('지속가능한 텃밭의 실제 사례 찾아줘',{cases:[material],casePassages:[material]}));assert.equal(result.cases.length,0);assert.equal(count,1);
});

test('viewed paper ID is re-opened directly and recent references do not jump to a later case activity',async t=>{
 const activities=[{type:'research',referenceId:'https://openalex.org/W123',title:'Selected paper'},{type:'cases',referenceId:'a',title:'Other case'}];
 assert.match(session.analysisSessionQuestion('방금 검색한 논문에서 효과적인 방법은?',activities),/^Research: Selected paper/);
 assert.equal(session.analysisSessionQuestion('여기가 대성주유소야',activities),'여기가 대성주유소야');
 const urls=[];mock(t,global,'fetch',async url=>{urls.push(new URL(url));return Response.json({id:'https://openalex.org/W123',display_name:'Selected paper',abstract_inverted_index:{Verified:[0],abstract:[1]},authorships:[]})});
 const result=await evidence.retrieveEvidence(input('이 논문의 방법을 알려줘',{selectedSources:['research'],selectedPaperId:'https://openalex.org/W123'}));
 assert.equal(urls.length,1);assert.equal(urls[0].pathname,'/works/W123');assert.equal(result.papers[0].openAlexId,'https://openalex.org/W123');
 await assert.rejects(()=>papers.readOpenAlexPaper('https://attacker.invalid/W123'));
});

test('named pins stay coordinate-bound and are used as search origins without a second name lookup',async t=>{
 const coordinate=[126.6735,37.4957],context={point:coordinate,pointLabel:'대성주유소'};
 assert.equal(geo.mapPointLabel('여기가 대성주유소야'),'대성주유소');assert.equal(geo.mapPointLabel('여기가 어디야?'),undefined);
 assert.deepEqual(geo.parseGeoContext(context),context);assert.throws(()=>geo.parseGeoContext({pointLabel:'missing coordinate'}));
 const named=await server.executeGeoQuery({question:'여기가 대성주유소야',context:{point:coordinate}}, {uid:'u'},'p',[]);
 assert.deepEqual(named.origin.coordinate,coordinate);assert.equal(named.origin.name,'대성주유소');assert.equal(named.origin.source,'map');assert.equal(named.resolvedPlaces[0].id,'map-point');
 const buffered=await server.executeGeoQuery({question:'여기 300m 버퍼를 실행해줘',context},{uid:'u'},'p',[]);assert.equal(buffered.computedResult.type,'buffer');assert.equal(buffered.computedResult.parameters.distanceMeters,300);assert.ok(buffered.computedResult.metrics.areaSqm>270000);assert.ok(buffered.computedResult.metrics.areaSqm<290000);
 for(const name of ['대성주유소','여기','아까 말한 곳'])assert.deepEqual((await server.resolvePlaceReference(name,context,[],()=>assert.fail('must not replace the selected coordinate')))[0].coordinate,coordinate);
 const dir=new URL('../public/data/projects/project-1773405285635/',import.meta.url),config=JSON.parse(fs.readFileSync(new URL('config.json',dir))),boundaryTools=require(`${build}/lib/spatial/boundary.js`);
 const layers=config.layers.map(c=>({config:c,data:JSON.parse(fs.readFileSync(new URL(c.source.split('/').at(-1),dir)))})),boundary=boundaryTools.deriveBoundary(layers[0].data);
 let searches=0;mock(t,kakao,'searchBoundaryPlaces',async q=>{searches++;assert.equal(q,'외국 음식점');return {calls:1,places:[{id:'restaurant',name:'실제 검색 후보',source:'kakao',coordinate:[126.6736,37.4958]}]}});
 const result=await server.executeGeoQuery({question:'대성주유소 근처 외국 음식점이 몇 개야?',context},{uid:'u'},config.projectId,layers,[],undefined,{boundary,boundaryLayerId:config.boundaryLayerId,placeSearch:config.placeSearch});
 assert.equal(searches,1);assert.deepEqual(result.origin.coordinate,coordinate);assert.equal(result.places.length,1);
});


test('spatial interpretation runs after actual results and falls back to the real result on model failure',async t=>{
 const context=require(`${build}/lib/project-context-server.js`),handler=require(`${build}/pages/api/spatial/query.js`).default;
 const order=[];mock(t,context,'loadProjectContext',async()=>({projectId:'planning-check',user:{uid:'planning-user'},currentMaterial:'참여자가 보행 편의를 개선하고 싶다고 말했다.',previousSummaries:{problem:'사용자의 관심: 보행 편의'},stageHistory:[]}));
 mock(t,server,'projectLayers',async()=>({layers:[],warnings:[],boundary:undefined,settings:{},priority:undefined}));
 mock(t,server,'executeGeoQuery',async()=>{order.push('tool');return {question:'이 장소가 왜 번잡한지 확인해봐',intent:'EXISTING_GIS_QUERY',reply:'실제 실행 결과: 면적 100m²',places:[],warnings:[],computedResult:{projectId:'planning-check',type:'area',timestamp:new Date().toISOString(),layerIds:[],parameters:{},metrics:{areaSqm:100},notes:[]}}});
 mock(t,llm,'callLLM',async req=>{order.push('interpret');const data=JSON.parse(req.userText);assert.equal(data.spatialContext.metrics.areaSqm,100);assert.match(req.systemText,/conditional planning reasoning/);return JSON.stringify({summary:'혼잡 원인은 단정할 수 없지만 보행·하역 동선을 나누는 방안을 검토할 만합니다.',caseFindings:[],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'',projectImplications:[],limitations:''})});
 const req={method:'POST',body:{projectId:'planning-check',question:'이 장소가 왜 번잡한지 확인해봐',context:{},locale:'ko'},headers:{}};
 const response=()=>({setHeader(){},status(code){this.code=code;return this},json(body){this.body=body}});
 const res=response();await handler(req,res);assert.deepEqual(order,['tool','interpret']);assert.match(res.body.result.reply,/검토할 만/);assert.equal(res.body.result.computedResult.metrics.areaSqm,100);
 mock(t,llm,'callLLM',async()=>{throw Error('provider unavailable')});const fallback=response();await handler({...req,body:{...req.body,projectId:'planning-check'}},fallback);assert.equal(fallback.body.result.reply,'실제 실행 결과: 면적 100m²');
});

test('new-case discovery checks registered bodies semantically before falling back to literature',async t=>{
 const material={id:'garden',title:'Community Garden',label:'Garden',text:'Residents share ongoing planting and maintenance responsibilities.'};
 mock(t,llm,'callLLM',async req=>{const data=JSON.parse(req.userText);assert.ok(data.passages.some(p=>p.text===material.text));return JSON.stringify({sourceIds:[data.passages[0].sourceId],researchQuery:''})});
 mock(t,papers,'searchOpenAlex',()=>assert.fail('a matching actual registered example needs no fallback search'));
 const result=await evidence.retrieveEvidence(input('지속가능하게 운영되는 마을 텃밭 사례를 찾아줘',{cases:[material],casePassages:[]}));assert.equal(result.cases[0].id,'garden');
 assert.equal(session.isPaperReference('이 논문 말고 다른 논문 찾아줘'),false);
});
