import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(path.join(process.env.PSS_TEST_BUILD,'loader.js'));
const load=p=>require(path.join(process.env.PSS_TEST_BUILD,p));
const geo=load('lib/spatial/geo-query.js'),kakao=load('lib/spatial/kakao-server.js'),server=load('lib/spatial/geo-server.js');
const point=(name,x=127,y=37.5,id=name)=>({type:'Feature',id,properties:{name},geometry:{type:'Point',coordinates:[x,y]}});
const layers=[{config:{id:'facilities',label:'시설',type:'point',role:'facilities'},data:{type:'FeatureCollection',features:[point('회복의 숲 타워'),point('회복의 숲 전파기지',127.001)]}}];
const user={uid:'geo-user',email:'member@example.org'};
const place=(id,x=127.001)=>({id,place_name:`검색 시설 ${id}`,x:String(x),y:'37.5',place_url:`https://place.kakao.com/${id}`,category_name:'시설',address_name:'실제 반환 주소'});
const payload=(distance=400,seconds=360)=>({status:'OK',route:{properties:{totalDistance:distance,totalTime:seconds},legs:[{steps:[{path:{points:[[127,37.5],[127.001,37.501]]}}]}]}});
function mock(t,obj,key,value){const old=obj[key];obj[key]=value;t.after(()=>obj[key]=old)}
function key(t){const previous=process.env.KAKAO_REST_API_KEY;process.env.KAKAO_REST_API_KEY='test-only-key';t.after(()=>{if(previous===undefined)delete process.env.KAKAO_REST_API_KEY;else process.env.KAKAO_REST_API_KEY=previous})}
const run=(question,context={},choices)=>server.executeGeoQuery({question,context,choices},user,'geo-project',layers);

test('all eight Korean examples produce bounded structured intents without hardcoded businesses',()=>{
 const examples=[['여기서 가장 가까운 카페가 어디야?','NEAREST_PLACE'],['OO마트에서 타워까지 몇 미터야?','STRAIGHT_DISTANCE'],['전파기지 주변에 음식점 있어?','NEARBY_SEARCH'],['이 건물에서 약국까지 얼마나 걸려?','WALKING_ROUTE'],['선택한 필지에서 300m 이내 편의점 찾아줘.','RADIUS_SEARCH'],['근처에 병원 5개 보여줘.','NEARBY_SEARCH'],['OO초등학교에서 회복의 숲 타워까지 걸어서 몇 분?','WALKING_ROUTE'],['지금 선택한 건물 주변 시설을 보여줘.','NEARBY_SEARCH']];
 for(const [q,intent]of examples){const p=geo.parseGeoPlan(q);assert.equal(p.intent,intent,q);assert.ok(geo.isGeoQuestion(q));assert.ok(p.radius<=20000&&p.limit<=10)}
 assert.equal(geo.parseGeoPlan(examples[4][0]).radius,300);assert.equal(geo.parseGeoPlan(examples[5][0]).query,'병원');assert.equal(geo.parseGeoPlan(examples[2][0]).query,'음식점');
 for(const name of ['알 수 없는 상호 487','새빛 베이커리','임의약국','미등록초등학교','동네버스정류장'])assert.equal(geo.parseGeoPlan(`${name} 찾아줘`).query,name);
 assert.equal(geo.parseGeoPlan('타워에서 경로당까지 거리는?').destination,'경로당');assert.equal(geo.parseGeoPlan('타워에서 종로약국까지 거리는?').destination,'종로약국');assert.equal(geo.parseGeoPlan('Where is the nearest cafe to this building?').query,'cafe');
 assert.equal(geo.parseGeoPlan('아리랑마트 찾아줘').intent,'PLACE_SEARCH');assert.equal(geo.genericCategoryCode('아리랑마트'),undefined);
 assert.throws(()=>geo.parseGeoPlan('반경 30000m 편의점'),/invalidRadius/);assert.throws(()=>geo.parseGeoPlan('도보 181분'),/invalidRadius/);
});
test('coordinate validation, geodesic meters, representative points and real aliases',()=>{
 for(const c of [[127,91],[NaN,37],['127',37],[127]])assert.throws(()=>geo.coordinate(c));
 assert.ok(geo.calculateStraightLineDistance([127,37.5],[127.001,37.5])>80);assert.ok(geo.calculateStraightLineDistance([127,37.5],[127.001,37.5])<100);
 assert.deepEqual(geo.representativePoint(point('p')).coordinate,[127,37.5]);const altitude=point('altitude');altitude.geometry.coordinates.push(40);assert.deepEqual(geo.representativePoint(altitude).coordinate,[127,37.5]);
 const building={type:'Feature',properties:{name:'건물',entrance_lng:127.001,entrance_lat:37.501},geometry:{type:'Polygon',coordinates:[[[127,37.5],[127.002,37.5],[127.002,37.502],[127,37.502],[127,37.5]]]}};
 assert.deepEqual(geo.representativePoint(building),{coordinate:[127.001,37.501],approximate:false});delete building.properties.entrance_lng;assert.equal(geo.representativePoint(building).approximate,true);
 assert.equal(geo.internalPlaces('타워',layers,(f)=>f.id)[0].name,'회복의 숲 타워');assert.equal(geo.internalPlaces('기존 건강생활지원센터',layers,f=>f.id)[0].name,'회복의 숲 전파기지');assert.equal(geo.internalPlaces('타워',[],()=>'' ).length,0);
 assert.throws(()=>geo.parseGeoContext({selected:{layerId:'../bad',featureId:'x'}}));
});
test('Kakao normalization omits missing/invalid attributes and unsafe URLs',()=>{
 const data=kakao.normalizePlaces({documents:[place('1'),{...place('2'),x:''},{...place('null'),x:null},{...place('3'),y:'100'}, {...place('4'),distance:'',place_url:'javascript:alert(1)',road_address_name:null}]});
 assert.equal(data.length,2);assert.equal(data[1].url,undefined);assert.equal(data[1].distanceMeters,undefined);assert.equal(data[1].roadAddress,undefined);assert.equal(data[0].approximate,true);assert.throws(()=>kakao.normalizePlaces({}),/invalidResponse/);
});
test('keyword searches remain arbitrary, REST key stays in headers, named businesses are not categories',async t=>{
 key(t);const calls=[];mock(t,global,'fetch',async(url,options)=>{calls.push(new URL(url));assert.equal(options.headers.Authorization,'KakaoAK test-only-key');assert.equal(options.cache,'no-store');return Response.json({documents:[place('1')]})});
 await kakao.searchPlaces('처음 보는 상점',{center:[127,37.5]});const p=calls[0].searchParams;assert.equal(p.get('query'),'처음 보는 상점');assert.equal(p.get('x'),'127');assert.equal(p.get('y'),'37.5');assert.equal(p.has('radius'),false);assert.equal(p.get('sort'),'distance');
 await kakao.searchNearbyPlaces('아리랑마트',[127,37.5],300);assert.match(calls[1].pathname,/keyword/);assert.equal(calls[1].searchParams.get('query'),'아리랑마트');
 await kakao.searchNearbyPlaces('카페',[127,37.5],300);assert.match(calls[2].pathname,/category/);assert.equal(calls[2].searchParams.get('category_group_code'),'CE7');
});
test('nearby empty result expands once and unsupported categories use keyword API',async t=>{
 key(t);const calls=[];mock(t,global,'fetch',async url=>{calls.push(new URL(url));return Response.json({documents:[]})});
 const result=await kakao.searchNearbyPlaces('버스 정류장',[127,37.5],1000);assert.equal(result.expanded,true);assert.equal(calls.length,2);assert.equal(calls[1].searchParams.get('radius'),'3000');assert.match(calls[0].pathname,/keyword/);
});
test('missing keys, authorization, quota, malformed JSON, network and abort are explicit',async t=>{
 key(t);delete process.env.KAKAO_REST_API_KEY;await assert.rejects(()=>kakao.searchPlaces('약국'),/restMissing/);process.env.KAKAO_REST_API_KEY='test-only-key';
 for(const [status,error]of [[401,'authorization'],[403,'authorization'],[429,'quota'],[500,'network']]){mock(t,global,'fetch',async()=>new Response('',{status}));await assert.rejects(()=>kakao.searchPlaces('약국'),new RegExp(error))}
 mock(t,global,'fetch',async()=>new Response('invalid json'));await assert.rejects(()=>kakao.searchPlaces('약국'),/invalidResponse/);
 mock(t,global,'fetch',async()=>{throw new Error('connection reset')});await assert.rejects(()=>kakao.searchPlaces('약국'),/network/);
 const cancel=new AbortController();cancel.abort();await assert.rejects(()=>kakao.searchPlaces('약국',{signal:cancel.signal}),/abort/i);
});
test('walking response requires status, complete actual geometry, meters and seconds',async t=>{
 key(t);const route=kakao.parseWalkingRoute(payload());assert.equal(route.distanceMeters,400);assert.equal(route.durationSeconds,360);assert.deepEqual(route.coordinates,[[127,37.5],[127.001,37.501]]);
 for(const data of [{status:'ROUTE_RESULT_NOT_FOUND'},{status:'SAME_POINT'},payload(-1),{...payload(),status:'UNKNOWN'},payload(10,NaN),{status:'OK',route:{properties:{totalDistance:1,totalTime:1},legs:[]}}])assert.throws(()=>kakao.parseWalkingRoute(data));
 mock(t,global,'fetch',async url=>{const p=new URL(url);assert.equal(p.pathname,'/v2/routing/walk');assert.equal(p.searchParams.get('start_x'),'127');assert.equal(p.searchParams.get('start_y'),'37.5');assert.equal(p.searchParams.get('output_coord'),'WGS84');return Response.json(payload())});
 await kakao.getWalkingRoute([127,37.5],[127.001,37.501]);await assert.rejects(()=>kakao.getWalkingRoute([127,37.5],[127,37.5]),/samePoint/);
});
test('nearest walking ranking uses at most three verified routes and discloses partial search',async t=>{
 key(t);let calls=0;mock(t,global,'fetch',async url=>{if(url.includes('/local/'))return Response.json({documents:[1,2,3,4,5].map(n=>place(String(n),127+n/10000))});calls++;const x=Number(new URL(url).searchParams.get('end_x'));return Response.json(payload(x<127.00015?900:300))});
 const result=await kakao.findNearestPlaces('카페',{id:'origin',name:'현재 위치',source:'map',coordinate:[127,37.5]},1000,5,true);assert.equal(calls,3);assert.equal(result.partial,true);assert.equal(result.places[0].distanceMeters,300);assert.equal(result.places.length,3);
});
test('internal references bypass external API; generic aliases require confirmation',async t=>{
 mock(t,global,'fetch',()=>assert.fail('internal locations must not call Kakao'));
 const r=await run('타워에서 전파기지까지 몇 미터야?');assert.equal(r.origin.name,'회복의 숲 타워');assert.ok(r.straightDistanceMeters>80);assert.equal(r.route,undefined);
 const ambiguous=await run('경로당에서 전파기지까지 몇 미터야?');assert.equal(ambiguous.clarify.options.length,1);assert.equal(ambiguous.clarify.role,'origin');
 const selected=await run(ambiguous.question,{}, {'경로당':ambiguous.clarify.options[0].choiceToken});assert.ok(selected.straightDistanceMeters>80);
 const here=await run('이 건물에서 전파기지까지 몇 미터야?',{selected:{layerId:'facilities',featureId:'회복의 숲 타워'}});assert.equal(here.origin.id,'facilities:회복의 숲 타워');
 await assert.rejects(()=>run('이 건물에서 전파기지까지 몇 미터야?',{selected:{layerId:'facilities',featureId:'removed'}}),/selectionChanged/);
});
test('explicit origins override selection; ambiguity choices are signed and scope-bound',async t=>{
 key(t);mock(t,global,'fetch',async()=>Response.json({documents:[place('a'),place('b',127.002)]}));
 const context={selected:{layerId:'facilities',featureId:'removed'}};
 const question='미등록상점에서 타워까지 몇 미터야?';const r=await run(question,context);assert.equal(r.clarify.options.length,2);assert.equal(r.destination,undefined);
 const token=r.clarify.options[0].choiceToken;assert.ok(token);const selected=await run(question,context,{'미등록상점':token});assert.equal(selected.origin.id,'a');assert.ok(selected.straightDistanceMeters>0);
 await assert.rejects(()=>server.executeGeoQuery({question,choices:{'미등록상점':token}}, {uid:'other'},'geo-project',layers),/choiceExpired/);
 await assert.rejects(()=>server.executeGeoQuery({question,choices:{'미등록상점':token}},user,'other-project',layers),/choiceExpired/);
 await assert.rejects(()=>run(question,context,{'미등록상점':token+'tampered'}),/choiceExpired/);
 const signed=server.signChoice({id:'a',name:'A',source:'kakao',coordinate:[127,37.5]},'binding');assert.ok(server.verifyChoice(signed,'binding'));assert.equal(server.verifyChoice(signed,'different'),undefined);
 const before=Date.now;mock(t,Date,'now',()=>before()+6*60000);assert.equal(server.verifyChoice(signed,'binding'),undefined);
});
test('walking failure returns explicit straight distance without invented time; no fake isochrone',async t=>{
 key(t);mock(t,global,'fetch',async()=>Response.json({status:'ROUTE_RESULT_NOT_FOUND'}));
 const r=await run('타워에서 전파기지까지 걸어서 몇 분?');assert.ok(r.straightDistanceMeters>80);assert.equal(r.route,undefined);assert.match(r.reply,/직선/);assert.ok(r.warnings.length);
 mock(t,global,'fetch',()=>assert.fail('isochrones must not fabricate or request a radius'));const minutes=await run('회복의 숲 타워에서 도보 5분 거리는?');assert.equal(minutes.radiusMeters,undefined);assert.match(minutes.reply,/도보.*도달권/);
});
test('Kakao adapter renders all six geometry types, preserves holes and coordinate order without mutation',t=>{
 mock(t,global,'document',{createElement:()=>({style:{},children:[],setAttribute(){},appendChild(child){this.children.push(child)}})});
 const created=[];class Overlay{constructor(options){this.options=options;created.push(this)}setMap(){}}class LatLng{constructor(lat,lng){this.lat=lat;this.lng=lng}getLat(){return this.lat}getLng(){return this.lng}}
 const clicks=[];let prevented=0,selected=0;const sdk={LatLng,Polygon:Overlay,Polyline:Overlay,Circle:Overlay,CustomOverlay:Overlay,event:{addListener:(o,e,fn)=>clicks.push(fn),preventMap:()=>prevented++}};
 const {kakaoFeatureOverlays}=load('lib/spatial/kakao-map.js');const ring=[[127,37.5],[127.01,37.5],[127.01,37.51],[127,37.5]],hole=[[127.001,37.501],[127.002,37.501],[127.001,37.502],[127.001,37.501]];
 for(const geometry of [{type:'Point',coordinates:[127,37.5,40]},{type:'MultiPoint',coordinates:[[127,37.5],[127.01,37.51]]},{type:'LineString',coordinates:ring},{type:'MultiLineString',coordinates:[ring,ring]},{type:'Polygon',coordinates:[ring,hole]},{type:'MultiPolygon',coordinates:[[ring,hole],[ring]]}]){const feature={type:'Feature',properties:{},geometry};const original=JSON.stringify(feature);const overlays=kakaoFeatureOverlays(sdk,feature,'#123456',()=>selected++);assert.ok(overlays.length);assert.equal(JSON.stringify(feature),original);for(const o of overlays)assert.equal(o.options.strokeColor??o.options.content?.children[0].style.backgroundColor,'#123456')}
 const polygon=created.find(o=>Array.isArray(o.options.path?.[0]));assert.equal(polygon.options.path.length,2);assert.equal(polygon.options.path[0][0].getLat(),37.5);assert.equal(polygon.options.path[0][0].getLng(),127);clicks[0]();assert.equal(selected,1);assert.equal(prevented,1);
});
test('spatial API preserves membership auth, validates inputs, rate limits and never writes vendor results',async t=>{
 const context=load('lib/project-context-server.js'),api=load('pages/api/spatial/query.js'),{AccessError}=load('lib/membership/server.js');
 const response=()=>({code:0,headers:{},setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(v){this.body=v}});
 const req=body=>({method:'POST',body:{projectId:'geo-project',question:'타워에서 전파기지까지 몇 미터야?',...body}});
 mock(t,context,'loadProjectContext',async()=>{throw new AccessError(401,'로그인이 필요합니다.')});let res=response();await api.default(req(),res);assert.equal(res.code,401);
 mock(t,context,'loadProjectContext',async()=>({user,projectId:'geo-project'}));mock(t,server,'projectLayers',async()=>({layers,warnings:[]}));
 res=response();await api.default(req({context:{point:[127,1000]}}),res);assert.equal(res.code,400);
 res=response();await api.default(req({choices:{anything:{coordinate:[127,37.5]}}}),res);assert.equal(res.code,400);
 res=response();await api.default(req(),res);assert.equal(res.code,200);assert.equal(res.headers['Cache-Control'],'private, no-store');assert.ok(res.body.result.straightDistanceMeters>0);
 for(let i=0;i<12;i++)assert.equal(api.allowGeoRequest('limit-test',1000),true);assert.equal(api.allowGeoRequest('limit-test',1000),false);assert.equal(api.allowGeoRequest('limit-test',61001),true);
});

test('automatic source routing covers unknown names and never adds sources to manual choices',()=>{
 const {resolveSources,sourceRoutingQuestion}=load('lib/research/routing.js');
 for(const q of ['임의상점 찾아줘','임의상점은 어디야?','Find an unregistered shop','근처 버스 정류장','여기서 가장 가까운 카페는?']){assert.deepEqual(resolveSources(q),['project','spatial']);assert.ok(geo.isGeoQuestion(q))}
 assert.equal(geo.parseGeoPlan('임의상점은 어디야?').query,'임의상점');
 assert.deepEqual(resolveSources('약국 찾아줘',['cases']),['cases']);assert.deepEqual(resolveSources('약국 찾아줘',['research']),['research']);assert.deepEqual(resolveSources('주민 참여 연구를 찾아줘'),['research']);
 const history=[{role:'user',content:'주민 참여 연구를 찾아줘'}];assert.equal(sourceRoutingQuestion('이 건물에서 가장 가까운 카페는?',history),'이 건물에서 가장 가까운 카페는?');
});
test('own geometry cache rechecks authorization and invalidates changed dataset revisions',async t=>{
 const datasets=load('lib/spatial/dataset-server.js'),admin=load('lib/firebaseAdmin.js');let reads=0,allowed=true,revision='one';
 mock(t,admin,'adminDb',()=>({}));mock(t,admin,'adminBucket',()=>({}));
 mock(t,datasets,'listDatasets',async()=>{if(!allowed)throw new Error('access revoked');return {datasets:[{projectId:'geo-cache',datasetId:'cache-fixture',name:'시설',geometryType:'point',type:'public_facilities',revisionId:revision}]}});
 mock(t,datasets,'readDataset',async()=>{reads++;return {data:{type:'FeatureCollection',features:[point('저장된 시설')]}}});
 assert.equal((await server.projectLayers(user,'geo-cache')).layers.length,1);assert.equal((await server.projectLayers(user,'geo-cache')).layers.length,1);assert.equal(reads,1);
 revision='two';await server.projectLayers(user,'geo-cache');assert.equal(reads,2);allowed=false;await assert.rejects(()=>server.projectLayers(user,'geo-cache'),/access revoked/);assert.equal(reads,2);
});
test('when all walking candidates fail, fallback ranks straight distances and never adds durations',async t=>{
 key(t);mock(t,global,'fetch',async url=>Response.json(url.includes('/local/')?{documents:[place('a'),place('b',127.002)]}:{status:'ROUTE_RESULT_NOT_FOUND'}));
 const result=await run('여기서 도보로 가장 가까운 약국은?',{point:[127,37.5]});assert.equal(result.ranking,'straight');assert.equal(result.route,undefined);assert.equal(result.places.length,2);assert.match(result.reply,/직선/);assert.ok(result.warnings.length);
});
test('walking ranking reports route quota errors while retaining available straight distances',async t=>{
 key(t);mock(t,global,'fetch',async url=>url.includes('/local/')?Response.json({documents:[place('a')]}):new Response('',{status:429}));
 const result=await run('도보로 가장 가까운 약국은?',{point:[127,37.5]});assert.equal(result.ranking,'straight');assert.ok(result.warnings.some(w=>/한도/.test(w)));assert.equal(result.route,undefined);
});
test('spatial API cancels external work when the client disconnects',async t=>{
 const {EventEmitter}=require('node:events');const context=load('lib/project-context-server.js'),api=load('pages/api/spatial/query.js');
 mock(t,context,'loadProjectContext',async()=>({user,projectId:'cancel-project'}));let signal;
 mock(t,server,'projectLayers',async(u,p,s)=>{signal=s;return new Promise((resolve,reject)=>s.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}))});
 const req=Object.assign(new EventEmitter(),{method:'POST',body:{question:'타워 찾아줘'}}),res=Object.assign(new EventEmitter(),{writableEnded:false,setHeader(){},status(){assert.fail('cancelled response must not be sent')}});
 const finished=api.default(req,res);await new Promise(resolve=>setImmediate(resolve));res.emit('close');await finished;assert.equal(signal.aborted,true);assert.equal(req.listenerCount('aborted'),0);assert.equal(res.listenerCount('close'),0);
});
test('location hierarchy uses selected feature before boundary, boundary before map, and explicit map center correctly',async t=>{
 key(t);mock(t,global,'fetch',async()=>Response.json({documents:[]}));
 const boundary={config:{id:'boundary',role:'boundary',label:'사업 경계',type:'polygon'},data:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[126,36],[126.01,36],[126.01,36.01],[126,36.01],[126,36]]]}}]}};
 const all=[...layers,boundary],query=(q,context)=>server.executeGeoQuery({question:q,context},user,'geo-project',all);
 let r=await query('근처 카페 찾아줘',{selected:{layerId:'facilities',featureId:'회복의 숲 타워'},mapCenter:[128,38]});assert.deepEqual(r.origin.coordinate,[127,37.5]);
 r=await query('근처 카페 찾아줘',{mapCenter:[128,38]});assert.equal(r.origin.id,'project-center');assert.equal(r.origin.approximate,true);
 r=await query('현재 지도 중심에서 카페 찾아줘',{selected:{layerId:'facilities',featureId:'removed'},mapCenter:[128,38]});assert.deepEqual(r.origin.coordinate,[128,38]);
 const empty=await server.executeGeoQuery({question:'근처 카페 찾아줘'},user,'geo-project',[]);assert.match(empty.reply,/기준 위치/);
});
