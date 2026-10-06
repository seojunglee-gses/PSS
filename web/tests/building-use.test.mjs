import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),root=process.env.PSS_DATASET_BUILD;
const server=require(root+'/lib/spatial/building-use-server.js');
const shared=require(root+'/lib/spatial/building-use.js');
const loader=require(root+'/lib/spatial/loader.js');
const engine=require(root+'/lib/spatial/engine.js');
const {parseSpatialResult}=require(root+'/lib/spatial/context.js');
const api=require(root+'/pages/api/spatial/building-use-codes.js').default;
const geometry={type:'Polygon',coordinates:[[[126,37],[126.01,37],[126.01,37.01],[126,37.01],[126,37]]]};
const data=properties=>({type:'FeatureCollection',features:properties.map((p,i)=>({type:'Feature',id:String(i),geometry,properties:p}))});
const config={id:'buildings',label:'건물',source:'/data/projects/uses/buildings.geojson',type:'polygon',role:'buildings'};
function route(method,body){const r={};api({method,body},{setHeader(){},status(n){r.status=n;return this},json(v){r.body=v}});return r}
test('server lookup preserves 694 exact five-character codes, notes and unknown-code boundaries',()=>{
 const lookup=JSON.parse(readFileSync(new URL('../data/reference/building_use_codes.json',import.meta.url),'utf8'));
 assert.equal(Object.keys(lookup).length,694);for(const code of Object.keys(lookup))assert.match(code,/^[0-9]{5}$/);
 assert.equal(server.lookupBuildingUse('03000').name,'제1종근린생활시설');assert.equal(server.lookupBuildingUse('14000').name,'업무시설');assert.match(server.lookupBuildingUse('03000').note,/2009/);
 for(const code of ['3000','XXXXX','03000 ','','__proto__','99999'])assert.equal(server.lookupBuildingUse(code),undefined);
});
test('normalization preserves original attributes and codes; aliases and unmatched codes never infer a use',()=>{
 const original=data([{use_code:'03000',use_name:'조작된 이름',extra:7},{mainPurpsCd:'14000'},{main_purps_cd:'02000'},{용도코드:'04000'},{use_code:'XXXXX'},{use_code:3000},{use_code:'3000',mainPurpsCd:'03000'},null]);
 const snapshot=JSON.stringify(original),normalized=server.normalizeBuildingData(original);assert.equal(JSON.stringify(original),snapshot);assert.equal(normalized.features[0].properties.extra,7);assert.equal(normalized.features[0].properties.use_name,'제1종근린생활시설');assert.equal(normalized.features[1].properties.mainPurpsCd,'14000');assert.equal(normalized.features[1].properties.use_name,'업무시설');assert.equal(normalized.features[2].properties.use_name,'공동주택');assert.equal(normalized.features[3].properties.use_name,'제2종근린생활시설');
 for(const i of [4,5,6,7])assert.equal(normalized.features[i].properties.use_name,'용도 정보 없음');assert.equal(normalized.features[5].properties.use_code,'3000');assert.equal(normalized.features[4].properties.use_code,'XXXXX');
});
test('reference API resolves requested codes only, rejects table uploads and numeric/legacy codes',()=>{
 const r=route('POST',{codes:['03000','14000','03000','99999']});assert.equal(r.status,200);assert.deepEqual(Object.keys(r.body.uses).sort(),['03000','14000']);assert.equal(r.body.uses['03000'].name,'제1종근린생활시설');assert.equal(route('GET',{}).status,405);
 for(const body of [{codes:[3000]},{codes:['3000']},{codes:['XXXXX']},{data:'Excel table'},null])assert.equal(route('POST',body).status,400);
});
test('static building loader uses server names and existing popup fields; non-building layers are unchanged',async t=>{
 const old=global.fetch;const requests=[];global.fetch=async(url,options)=>{requests.push(String(url));if(String(url).includes('building-use-codes'))return Response.json(route('POST',JSON.parse(options.body)).body);return Response.json(data([{use_code:'03000'},{use_code:'XXXXX'}]))};t.after(()=>{global.fetch=old});
 const loaded=await loader.loadLayer(config);assert.equal(loaded.data.features[0].properties.use_name,'제1종근린생활시설');assert.equal(loaded.data.features[1].properties.use_name,'용도 정보 없음');assert.deepEqual(loaded.config.displayFields,['use_name','use_code']);assert.equal(loaded.config.fieldLabels.use_name,'건물 용도');assert.ok(requests.includes('/api/spatial/building-use-codes'));await loader.loadLayer(config);assert.equal(requests.filter(r=>r.includes('building-use-codes')).length,1);
 const other=await loader.loadLayer({...config,id:'green',role:'green',source:'/data/projects/uses/green.geojson'});assert.equal(other.data.features[0].properties.use_name,undefined);assert.equal(other.config.displayFields,undefined);assert.equal(requests.filter(r=>r.includes('building-use-codes')).length,1);
});
test('building statistics, restored summaries and AI context retain codes and canonical Korean names',()=>{
 const normalized=server.normalizeBuildingData(data([{use_code:'03000'},{use_code:'03000'},{use_code:'14000'},{use_code:'XXXXX'}]));
 const result=engine.resultFor('uses','area',[{config,data:normalized}],normalized.features[0]);assert.equal(result.metrics.buildingCount,4);assert.equal(result.buildingUses[0].use_code,'03000');assert.equal(result.buildingUses[0].use_name,'제1종근린생활시설');assert.equal(result.buildingUses[0].count,2);assert.equal(result.buildingUses.find(g=>g.use_code==='XXXXX').use_name,'용도 정보 없음');assert.deepEqual(parseSpatialResult(JSON.parse(JSON.stringify(result))).buildingUses,result.buildingUses);
 const forged={...result,buildingUses:result.buildingUses.map(g=>({...g,use_name:'지어낸 이름'}))};const request={spatialContext:server.canonicalBuildingContext(parseSpatialResult(forged))};assert.equal(request.spatialContext.buildingUses[0].use_name,'제1종근린생활시설');assert.equal(request.spatialContext.buildingUses.find(g=>g.use_code==='XXXXX').use_name,'용도 정보 없음');
 assert.throws(()=>parseSpatialResult({...result,buildingUses:[{use_code:'03000',use_name:'시설',count:100}]}),/Invalid building/);
});
test('compact use summaries disclose truncation while keeping full building totals',()=>{
 const normalized=server.normalizeBuildingData(data(Array.from({length:25},(_,i)=>({use_code:String(10000+i)}))));const result=engine.resultFor('uses','area',[{config,data:normalized}],normalized.features[0]);assert.equal(result.metrics.buildingCount,25);assert.equal(result.buildingUses.length,20);assert.match(result.notes.join(' '),/5개 코드는 요약에서 제외/);assert.equal(parseSpatialResult(result).buildingUses.length,20);
});
