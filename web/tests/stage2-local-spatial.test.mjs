import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=process.env.PSS_TEST_BUILD,load=file=>require(`${root}/${file}`);
const geo=load('lib/spatial/geo-query.js'),server=load('lib/spatial/geo-server.js'),kakao=load('lib/spatial/kakao-server.js'),boundary=load('lib/spatial/boundary.js'),types=load('lib/spatial/types.js'),goals=load('lib/spatial/goals.js'),context=load('lib/spatial/context.js'),routing=load('lib/research/routing.js'),facilitation=load('lib/facilitation.js');
const mock=(t,obj,key,value)=>{const old=obj[key];obj[key]=value;t.after(()=>obj[key]=old)};
const polygon=(x0,y0,x1,y1)=>({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]}});
const active={config:{id:'uploaded-project',label:'실제 사업구역',type:'polygon',role:'boundary',datasetType:'project_boundary',source:''},data:{type:'FeatureCollection',features:[polygon(127,37,127.002,37.002)]}};
const administrative={config:{id:'district',label:'행정동 참고경계',type:'polygon',role:'boundary',internalOnly:true,source:''},data:{type:'FeatureCollection',features:[polygon(126.99,36.99,127.02,37.02)]}};
const actual=boundary.deriveBoundary(active.data),settings={activeBoundaryDatasetId:'project',defaultNearbyMeters:500};
const station={id:'station',name:'대성산업 인천주유소',source:'kakao',coordinate:[127.001,37.001],roadAddress:'인천 서구 가남로 181',category:'교통 > 주유소'};
const charging={id:'charging',name:'대성 인천주유소 전기차충전소',source:'kakao',coordinate:[127.00102,37.001],roadAddress:'인천 서구 가남로 181',category:'교통 > 전기차충전소'};

test('our area is a project polygon scope and the shop phrase remains the target, regardless of earlier conversation',()=>{
 const question='우리 지역에 외국인 대상 식료품점이나 가게가 몇 개나 있어?';
 const parsed=geo.parseGeoPlan(question);assert.equal(parsed.projectArea,true);assert.equal(parsed.origin,'사업구역');assert.equal(parsed.query,'외국 식료품점');assert.equal(parsed.nearby,true);assert.equal(parsed.locations,undefined);
 const history=[{role:'user',content:'이 동네 외국인이 너무 많아서 걱정돼'},{role:'assistant',content:'어떤 상황을 말씀하시는 건가요?'}];assert.equal(geo.spatialConversationQuestion(question,history),question);
 for(const phrase of ['우리 동네','이 동네','사업지역','사업대상지','여기 지역']){const p=geo.parseGeoPlan(`${phrase}에 약국이 몇 개 있어?`);assert.equal(p.origin,'사업구역',phrase);assert.equal(p.projectArea,true,phrase);assert.doesNotMatch(p.query,/사업구역|우리|동네/)}
 assert.equal(facilitation.requestClarification(question,history),undefined);
 assert.ok(facilitation.requestClarification('외국인 대상 가게가 몇 개 있어?'));
});

test('project area shop search runs against the actual boundary, without resolving the sentence as a place',async t=>{
 const calls=[];mock(t,kakao,'searchBoundaryPlaces',async(query,geometry)=>{calls.push({query,geometry});return{calls:1,places:[{...station,id:'grocery',name:'외국 식료품점'}]}});
 const question='우리 지역에 외국인 대상 식료품점이나 가게가 몇 개나 있어?';
 const result=await server.executeGeoQuery({question}, {uid:'u'},'p',[active,administrative],[],undefined,{boundary:actual,settings,boundaryLayerId:active.config.id});
 assert.equal(calls.length,1);assert.equal(calls[0].query,'외국 식료품점');assert.deepEqual(calls[0].geometry,actual.geometry);assert.equal(result.scopeMeters,0);assert.equal(result.places.length,1);assert.equal(result.clarify,undefined);assert.doesNotMatch(result.reply,/이 동네 외국인이/);
});

test('active project boundary wins over district references and only one boundary enters layer controls',()=>{
 const layers=[administrative.config,active.config,{...active.config,id:'uploaded-inactive'}];
 assert.equal(types.projectBoundaryLayerId(layers,'project','district'),'uploaded-project');
 assert.equal(types.projectBoundaryLayerId(layers,null,'district'),undefined);
 assert.equal(types.projectBoundaryLayerId(layers,'missing','district'),undefined);
 for(const category of [null,1,2,3])assert.deepEqual(goals.spatialCategoryLayerIds(layers,category,'project','district'),['uploaded-project']);
 const legacy={...administrative.config,id:'legacy',internalOnly:false};assert.equal(types.projectBoundaryLayerId([legacy],null,'legacy'),'legacy');
});

test('server project-layer loading uses the selected uploaded geometry and retains administrative reference internally',async t=>{
 const admin=load('lib/firebaseAdmin.js'),datasets=load('lib/spatial/dataset-server.js');
 const projectId='project-1773405285635',dataset={projectId,datasetId:'project',revisionId:'local-test',name:'실제 사업구역',type:'other',geometryType:'polygon'};
 mock(t,admin,'adminDb',()=>({}));mock(t,admin,'adminBucket',()=>({}));mock(t,datasets,'listDatasets',async()=>({datasets:[dataset],spatialSettings:settings}));mock(t,datasets,'readDataset',async()=>({data:active.data}));
 const result=await server.projectLayers({uid:'u'},projectId);assert.equal(result.boundaryLayerId,'uploaded-project');assert.equal(result.layers.find(l=>l.config.id==='uploaded-project').config.role,'boundary');assert.deepEqual(result.boundary.bbox,actual.bbox);assert.ok(result.layers.find(l=>l.config.id==='gajwa1-boundary').config.internalOnly);
});

test('co-located subfeatures form one station group, while unrelated tenants and explicit charging searches remain distinct',()=>{
 const grouped=geo.groupPlaceCandidates([charging,station],'대성주유소 어디야?');assert.equal(grouped.length,1);assert.equal(grouped[0].id,station.id);assert.equal(grouped[0].name,station.name);assert.deepEqual(grouped[0].coordinate,station.coordinate);assert.ok(grouped[0].relatedCategories.includes('주유소'));assert.ok(grouped[0].relatedCategories.includes('전기차충전소'));
 assert.equal(geo.groupPlaceCandidates([charging,station],'전기차 충전소 찾아줘').length,2);
 assert.equal(geo.groupPlaceCandidates([station,{...charging,id:'other',name:'다른 주유소 전기차충전소'}],'주유소 위치').length,2);
 assert.equal(geo.groupPlaceCandidates([station,{...station,id:'tenant',name:'다른 상점'}],'찾기').length,2);
 assert.equal(geo.groupPlaceCandidates([station,{...charging,coordinate:[127.01,37.01]}],'주유소 위치').length,2);
});

test('station location resolution deduplicates before presenting choices',async t=>{
 mock(t,kakao,'searchBoundaryPlaces',async()=>({calls:1,places:[station,charging]}));
 const result=await server.executeGeoQuery({question:'대성주유소 어디야?'},{uid:'u'},'p',[active],[],undefined,{boundary:actual,settings,boundaryLayerId:active.config.id});
 assert.equal(result.places.length,1);assert.equal(result.places[0].id,'station');assert.equal(result.clarify,undefined);
});

test('selected-place planning concerns use spatial context instead of POI keyword execution',()=>{
 for(const q of ['여기는 쉼터로 어때?','여기에 만들면 어때?','여기 문제가 뭐야?','이 주변이 차량 때문에 너무 복잡해']){
  assert.ok(geo.isSelectedPlaceDiscussion(q),q);assert.equal(geo.isGeoQuestion(q),false,q);assert.deepEqual(routing.resolveSources(q),['project','spatial']);
 }
 assert.equal(geo.isSelectedPlaceDiscussion('여기는 녹지로 바꾼 효과 연구가 있어?'),false);assert.deepEqual(routing.resolveSources('여기는 녹지로 바꾼 효과 연구가 있어?'),['research']);
 assert.ok(geo.isGeoQuestion('여기 주변 주유소 찾아줘'));
 assert.ok(geo.isGeoQuestion('여기 300m 이내 약국 찾아줘'));
 const current=context.spatialPromptContext([active,administrative],{point:[127.0019,37.001],pointLabel:'선택 지점'},[],true,{nearbyPlaces:true,priority:false,boundary:actual});
 assert.deepEqual(current.selectedMapPoint.coordinate,[127.0019,37.001]);assert.equal(current.computedSpatialRelations[0].inside,true);assert.equal(current.computedSpatialRelations[0].directionFromCenter,'east');assert.ok(current.computedSpatialRelations[0].boundaryDistanceMeters<15);assert.ok(current.computedSpatialRelations[0].boundaryDistanceMeters>5);assert.equal(current.availableTools.nearbyPlaces,true);
 const unknown=context.spatialPromptContext([active],{point:[127.001,37.001]},[],false);assert.deepEqual(unknown.computedSpatialRelations,[]);
});

test('Stage 2 converts missing conditions to local observation and conditional branches, respecting explicit refusals',()=>{
 const history=[{role:'assistant',content:'사람들이 이곳을 자주 이용하나요?'}];
 const prompt=facilitation.facilitationInstructions('data','지금은 차가 많이 지나는 곳이야',history);
 assert.match(prompt,/Adaptive follow-up policy: OPTIONAL/);assert.match(prompt,/materially help adapt, compare or develop/);assert.match(prompt,/Never end at a bare uncertainty/);assert.match(prompt,/how a relevant condition would change the idea/);assert.match(prompt,/revise\/remove\/combine/);assert.match(prompt,/Do not always finish with a question/);
 assert.equal(facilitation.followUpPolicy("이 위치는 쉼터로 어때?",history,"data").mode,"optional");
 assert.equal(facilitation.followUpPolicy("이 공원 면적은 얼마야?",history,"data").mode,"none");
 assert.match(facilitation.facilitationInstructions('data','질문하지 말아줘',history),/Adaptive follow-up policy: NONE/);
 assert.ok(!facilitation.facilitationInstructions('problem','문제를 정리해줘').includes('Never end at a bare uncertainty'));
});

test('current selected point reaches the answer API without reusing metrics from a different historical selection',async t=>{
 const loader=load('lib/project-context-server.js'),llm=load('lib/llm/index.js'),handler=load('pages/api/research/answer.js').default;
 const activity={id:'old',projectId:'p',type:'spatial',referenceId:'old-result',title:'old place',result:{projectId:'p',type:'area',timestamp:new Date().toISOString(),layerIds:['old'],parameters:{},metrics:{areaSqm:999999},notes:[]}};
 mock(t,loader,'loadProjectContext',async()=>({projectId:'p',user:{uid:'u'},currentMaterial:'텃밭을 녹지와 쉼터로 바꾸는 방향을 논의 중',previousSummaries:{problem:'관리 부담'},cases:[],stageHistory:[{stepId:'data',activity}],spatialData:{layers:[active,administrative],boundary:actual}}));
 mock(t,llm,'callLLM',async req=>{const data=JSON.parse(req.userText);assert.equal(data.spatialContext,undefined);assert.deepEqual(data.registeredSpatialContext.selectedMapPoint.coordinate,[127.0019,37.001]);assert.equal(data.registeredSpatialContext.computedSpatialRelations[0].inside,true);assert.match(req.systemText,/at most ONE concrete, non-leading question/);return JSON.stringify({summary:'선택 지점은 사업구역 안입니다. **녹지와 짧은 쉼터**, **완충녹지와 보행공간**을 비교할 수 있습니다. 주변은 사람들이 자주 걷는 곳인가요?',caseFindings:[],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'',projectImplications:[],limitations:''})});
 const result={};await handler({method:'POST',headers:{},body:{question:'여기는 쉼터로 어때?',selectedSources:[],spatialSelection:{point:[127.0019,37.001]}}},{setHeader(){},status(code){result.status=code;return this},json(body){result.body=body}});
 assert.equal(result.status,200);assert.match(result.body.reply,/주변은 사람들이 자주 걷는 곳인가요/);
});

test('reference boundary polygons are faint and do not install feature-selection click handlers',()=>{
 const {kakaoFeatureOverlays}=load('lib/spatial/kakao-map.js');let style,listeners=0;
 const sdk={LatLng:class {constructor(y,x){this.y=y;this.x=x}},Polygon:class {constructor(options){style=options}},event:{addListener(){listeners++}}};
 kakaoFeatureOverlays(sdk,active.data.features[0],'#2563eb',()=>assert.fail('a boundary is not selectable'),false,1,true);
 assert.ok(style.fillOpacity<=0.03);assert.equal(style.strokeOpacity,1);assert.equal(listeners,0);
 kakaoFeatureOverlays(sdk,active.data.features[0],'#2563eb',()=>{},false,1,false);assert.equal(listeners,1);
});

test('client layer loading selects the same active boundary without exposing the internal district layer in controls',async t=>{
 const {readFileSync}=require('node:fs'),loader=load('lib/spatial/loader.js'),projectId='project-1773405285635';
 const raw=JSON.parse(readFileSync(new URL('../public/data/projects/'+projectId+'/config.json',import.meta.url),'utf8'));
 mock(t,global,'fetch',async url=>String(url).startsWith('/api/')?Response.json({datasets:[{projectId,datasetId:'project',revisionId:'r1',type:'other',geometryType:'polygon',name:'실제 사업구역'}],spatialSettings:settings}):Response.json(raw));
 const config=await loader.loadSpatialConfig(projectId,undefined,'fixture');assert.equal(config.boundaryLayerId,'uploaded-project');assert.equal(config.layers.find(l=>l.id==='uploaded-project').role,'boundary');assert.deepEqual(goals.spatialCategoryLayerIds(config.layers,null,'project',config.boundaryLayerId).filter(id=>id!==config.placeSearch.roadLayerId),['uploaded-project']);
});

test('default project search stays on the project polygon; explicit district searches use only the internal administrative scope',async t=>{
 const previous=process.env.KAKAO_REST_API_KEY;process.env.KAKAO_REST_API_KEY='fixture-scope-key';t.after(()=>{if(previous===undefined)delete process.env.KAKAO_REST_API_KEY;else process.env.KAKAO_REST_API_KEY=previous});
 const calls=[],far={...station,id:'district-place',name:'동네 가게',coordinate:[127.019,37.019]};
 mock(t,kakao,'searchBoundaryPlaces',async(query,geometry)=>{calls.push({query,geometry});return{calls:1,places:[far]}});
 const options={boundary:actual,settings,boundaryLayerId:active.config.id,placeSearch:{regionName:'인천 가좌1동',roadLayerId:'not-loaded',roadNames:['가정로126번길'],radiusMeters:500}};
 await server.executeGeoQuery({question:'약국 찾아줘'},{uid:'u'},'p',[active,administrative],[],undefined,options);assert.deepEqual(calls[0].geometry,actual.geometry);
 calls.length=0;await server.executeGeoQuery({question:'가좌1동 전체 가게 찾아줘'},{uid:'u'},'p',[active,administrative],[],undefined,options);assert.deepEqual(calls[0].geometry,administrative.data.features[0]);
});

test('genuinely conflicting project/district scopes ask a concrete choice and recover the original target',async t=>{
 mock(t,kakao,'searchBoundaryPlaces',()=>assert.fail('scope must be resolved before searching'));
 const question='우리 동네 가좌1동 전체 약국을 찾아줘',options={boundary:actual,settings,boundaryLayerId:active.config.id,placeSearch:{regionName:'인천 가좌1동',roadLayerId:'not-loaded',roadNames:['가정로126번길'],radiusMeters:500}};
 const result=await server.executeGeoQuery({question},{uid:'u'},'p',[active,administrative],[],undefined,options);assert.match(result.reply,/사업구역 안.*아니면 가좌1동 전체/);
 const history=[{role:'user',content:question},{role:'assistant',content:result.reply}];
 assert.match(geo.spatialConversationQuestion('사업구역 안으로 찾아줘',history),/^사업구역 안 약국/);
 assert.match(geo.spatialConversationQuestion('가좌1동 전체로 찾아줘',history),/^가좌1동 전체 약국/);
 const explicit=geo.parseGeoPlan('사업구역 말고 가좌1동 전체 약국 찾아줘');assert.equal(explicit.projectArea,undefined);assert.doesNotMatch(explicit.query,/말고/);
});
