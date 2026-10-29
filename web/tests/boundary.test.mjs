import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(path.join(process.env.PSS_TEST_BUILD,'test.js'));
const load=p=>require(path.join(process.env.PSS_TEST_BUILD,p));
const boundary=load('lib/spatial/boundary.js'),geo=load('lib/spatial/geo-server.js'),kakao=load('lib/spatial/kakao-server.js');
const square=(x=127,y=37.5,size=.01)=>({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]]}});
const fc=(...features)=>({type:'FeatureCollection',features});
const place=(id,coordinate)=>({id,name:id,source:'kakao',coordinate});
function mock(t,obj,key,value){const previous=obj[key];obj[key]=value;t.after(()=>obj[key]=previous)}
function key(t){const prior=process.env.KAKAO_REST_API_KEY;process.env.KAKAO_REST_API_KEY='boundary-fixture';t.after(()=>prior===undefined?delete process.env.KAKAO_REST_API_KEY:process.env.KAKAO_REST_API_KEY=prior)}
test('boundary validation accepts Polygon/MultiPolygon, rejects malformed rings, self-crossing and unconfirmed CRS',()=>{
 assert.equal(boundary.boundaryGeoJSON(square(),'EPSG:4326',true).features.length,1);
 const multi={...square(),geometry:{type:'MultiPolygon',coordinates:[square().geometry.coordinates,square(127.02).geometry.coordinates]}};assert.equal(boundary.boundaryGeoJSON(multi,'EPSG:4326',true).features[0].geometry.type,'MultiPolygon');
 assert.throws(()=>boundary.boundaryGeoJSON(square(),undefined,true),/confirmCrs/);
 assert.throws(()=>boundary.boundaryGeoJSON({...square(),crs:{properties:{name:'EPSG:5179'}}},'EPSG:4326',true),/unsupportedCrs/);
 assert.throws(()=>boundary.boundaryGeoJSON({...square(),geometry:{type:'Point',coordinates:[127,37.5]}},'EPSG:4326',true));
 const crossed=square();crossed.geometry.coordinates[0]=[[127,37.5],[127.01,37.51],[127,37.51],[127.01,37.5],[127,37.5]];assert.throws(()=>boundary.boundaryGeoJSON(crossed,'EPSG:4326',true));
});
test('explicit Web Mercator converts a copy; projected coordinates are never guessed to be WGS84',()=>{
 const {toMercator}=require('@turf/turf'),original=toMercator(square());original.crs={properties:{name:'EPSG:3857'}};const before=JSON.stringify(original),converted=boundary.boundaryGeoJSON(original,undefined,true);assert.equal(JSON.stringify(original),before);assert.ok(Math.abs(converted.features[0].geometry.coordinates[0][0][0]-127)<.000001);
 assert.throws(()=>boundary.boundaryGeoJSON(original,'EPSG:4326',true),/crsMismatch/);delete original.crs;assert.throws(()=>boundary.boundaryGeoJSON(original,'EPSG:4326',true));
});
test('derived union avoids double-counting and buffers the entire irregular boundary including holes',()=>{
 const one=boundary.deriveBoundary(fc(square())),overlap=boundary.deriveBoundary(fc(square(),square(127.005)));
 assert.ok(overlap.areaSqm>one.areaSqm*1.4&&overlap.areaSqm<one.areaSqm*1.6);assert.equal(overlap.bbox[0],127);
 const elongated=boundary.deriveBoundary(fc(square(127,37.5,.05))),inside=place('inside',[127.049,37.549]),near=place('near edge',[127.052,37.549]),far=place('far',[127.07,37.549]);
 assert.deepEqual(boundary.filterBoundaryPlaces([inside,near,far],boundary.boundaryScope(elongated,0)).map(p=>p.id),['inside']);assert.deepEqual(boundary.filterBoundaryPlaces([inside,near,far],boundary.boundaryScope(elongated,500)).map(p=>p.id),['inside','near edge']);
 const between=place('700m from edge',[127.058,37.549]);assert.equal(boundary.filterBoundaryPlaces([between],boundary.boundaryScope(elongated,500)).length,0);assert.equal(boundary.filterBoundaryPlaces([between],boundary.boundaryScope(elongated,1000)).length,1);
 const donut=square();donut.geometry.coordinates.push([[127.002,37.502],[127.008,37.502],[127.008,37.508],[127.002,37.508],[127.002,37.502]]);assert.equal(boundary.filterBoundaryPlaces([place('hole',[127.005,37.505])],boundary.deriveBoundary(fc(donut)).geometry).length,0);
});
test('boundary search sends bounded geographic windows, paginates, deduplicates and filters exact polygon',async t=>{
 key(t);const shape=boundary.deriveBoundary(fc(square())),calls=[];
 mock(t,global,'fetch',async url=>{const u=new URL(url);calls.push(u);return Response.json({meta:{is_end:calls.length>1},documents:[{id:'inside',place_name:'임의 상호',x:'127.005',y:'37.505'},{id:'outside',place_name:'다른 지역',x:'128',y:'38'}]})});
 const found=await kakao.searchBoundaryPlaces('미등록 상점',shape.geometry);assert.equal(found.places.length,1);assert.equal(calls.length,2);assert.ok(calls[0].searchParams.has('rect'));assert.equal(calls[0].searchParams.get('query'),'미등록 상점');assert.equal(calls[1].searchParams.get('page'),'2');assert.equal(found.partial,true);
});
test('scoped query uses active boundary, 500/1000m options, and explicit external origins bypass it',async t=>{
 key(t);const b=boundary.deriveBoundary(fc(square())),calls=[];
 mock(t,global,'fetch',async url=>{const u=new URL(url);calls.push(u);return Response.json({meta:{is_end:true},documents:[{id:'local',place_name:'선택 장소',x:'127.005',y:'37.505'}]})});
 const run=(question,context={})=>geo.executeGeoQuery({question,context},{uid:'u'},'p',[],[],undefined,{boundary:b,settings:{activeBoundaryDatasetId:'b',defaultNearbyMeters:500}});
 const r=await run('근처 카페 찾아줘');assert.equal(r.scopeMeters,500);assert.ok(calls[0].searchParams.has('rect'));assert.ok(r.warnings.length);
 const extended=await run('근처 카페 찾아줘',{scopeMeters:1000});assert.equal(extended.scopeMeters,1000);
 calls.length=0;await run('서울역 근처 카페 찾아줘');assert.ok(calls.length>=2);assert.ok(calls.every(u=>!u.searchParams.has('rect')));
});
test('chat overview uses actual project data and measured area, never a POI or invented road width',async t=>{
 mock(t,global,'fetch',()=>assert.fail('project overview must not call external search'));
 const data=fc(square()),b=boundary.deriveBoundary(data),layers=[{config:{id:'uploaded-boundary',type:'polygon',role:'boundary',label:'사업 경계'},data}];
 const r=await geo.executeGeoQuery({question:'사업구역 면적은?'},{uid:'u'},'p',layers,[],undefined,{boundary:b,settings:{activeBoundaryDatasetId:'boundary',defaultNearbyMeters:500}});assert.ok(r.computedResult.metrics.areaSqm>0);assert.equal(r.computedResult.metrics.roadWidth,undefined);
});
test('private review context distinguishes source facts from personal ideas and never claims consensus',()=>{
 const {reviewContext}=load('lib/spatial/analysis-review.js');const text=reviewContext({findings:[{kind:'observation',text:'어두운 것 같아요'}],summary:{issues:'확인 필요'}});assert.match(text,/not instructions or community consensus/);assert.match(text,/not verified spatial facts/);assert.match(text,/어두운/);const selected=reviewContext({findings:[{kind:'location',text:'선택 위치',location:{layerId:'uploaded-facilities',featureId:'tower',coordinate:[127,37.5]}}],summary:{}});assert.match(selected,/featureId/);assert.match(selected,/127/);
});

test('irregular/disjoint regions filter bounding-box false positives and all components retain a search window',()=>{
 const l={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[127,37.5],[127.03,37.5],[127.03,37.502],[127.002,37.502],[127.002,37.53],[127,37.53],[127,37.5]]]}};
 const region=boundary.deriveBoundary(fc(l));assert.equal(boundary.filterBoundaryPlaces([place('bbox only',[127.02,37.52])],region.geometry).length,0);assert.equal(boundary.filterBoundaryPlaces([place('far along arm',[127.001,37.529])],boundary.boundaryScope(region,500)).length,1);
 const parts=[0,1,2,3].map(i=>[[[127+i*.1,37.5],[127.05+i*.1,37.5],[127.05+i*.1,37.501],[127+i*.1,37.501],[127+i*.1,37.5]]]);
 const multi={type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:parts}},windows=boundary.searchWindows(multi);assert.ok(windows.length<=4);for(const polygon of parts)for(const [x,y]of polygon[0])assert.ok(windows.some(([x1,y1,x2,y2])=>x>=x1&&x<=x2&&y>=y1&&y<=y2));
});
