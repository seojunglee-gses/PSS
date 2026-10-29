import test, {before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {Firestore,Timestamp} from 'firebase-admin/firestore';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc} from 'firebase/firestore';
const require=createRequire(import.meta.url),build=process.env.PSS_DATASET_BUILD;
assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Use only a local Firestore emulator.');
const db=new Firestore({projectId:'demo-pss-membership'});
const server=require(build+'/lib/spatial/dataset-server.js');
const membership=require(build+'/lib/membership/server.js');
const {parseDataset,parseCsv,datasetLayer}=require(build+'/lib/spatial/datasets.js');
const loader=require(build+'/lib/spatial/loader.js');
const adminModule=require(build+'/lib/firebaseAdmin.js');
const handler=require(build+'/pages/api/projects/spatial-datasets.js').default;
const owner={uid:'owner',email:'owner@example.com'}, admin={uid:'admin',email:'adm@snu.ac.kr'}, participant={uid:'reader',email:'reader@example.com'}, stranger={uid:'stranger',email:'other-owner@example.com'};
const collection='ppssSpatialDatasets_p1';
const polygon={type:'FeatureCollection',features:[{type:'Feature',properties:{name:'한글 경계'},geometry:{type:'Polygon',coordinates:[[[126,37],[126.01,37],[126.01,37.01],[126,37.01],[126,37]]]}}]};
const upload=(overrides={})=>({action:'upload',projectId:'p1',name:'대상지',type:'project_boundary',sourceCrs:'EPSG:4326',fileName:'경계.geojson',data:Buffer.from(JSON.stringify(polygon)).toString('base64'),...overrides});
let env,objects,saves,deletes,downloads,bucket,afterSave;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-pss-membership',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}})});
after(async()=>{await env.cleanup();await db.terminate()});
beforeEach(async()=>{
 await env.clearFirestore();await db.doc('ppssProjects/p1').set({projectId:'p1',projectAdmin:owner.email});await db.doc('ppssProjects/p2').set({projectId:'p2',projectAdmin:stranger.email});await db.doc('users/reader/projectMemberships/p1').set({role:'participant',projectId:'p1'});
 objects=new Map();saves=[];deletes=[];downloads=[];afterSave=undefined;
 bucket={file:path=>({save:async(bytes,options)=>{objects.set(path,Buffer.from(bytes));saves.push({path,options});if(afterSave)await afterSave()},download:async()=>{downloads.push(path);if(!objects.has(path))throw Object.assign(Error('missing fixture file'),{code:404});return [objects.get(path)]},delete:async()=>{deletes.push(path);objects.delete(path)}})};
});
async function saved(user=owner,overrides={}){const {datasetId}=await server.mutateDataset(db,bucket,user,upload(overrides));return (await db.doc(collection+'/'+datasetId).get()).data()}
async function route(method,body={},query={},token='owner'){
 const result={headers:{}};const res={setHeader:(k,v)=>result.headers[k]=v,status(n){result.status=n;return this},json(data){result.body=data;return this}};
 const original={db:adminModule.adminDb,bucket:adminModule.adminBucket,verify:adminModule.verifyUserRequest};adminModule.adminDb=()=>db;adminModule.adminBucket=()=>bucket;adminModule.verifyUserRequest=async t=>{if(t!==token||t==='bad')throw Error('bad token');return owner};
 try{await handler({method,body,query,headers:{authorization:token?'Bearer '+token:undefined}},res);return result}finally{adminModule.adminDb=original.db;adminModule.adminBucket=original.bucket;adminModule.verifyUserRequest=original.verify}
}
test('original bytes stay in Storage; only project metadata and server timestamp go to Firestore',async()=>{
 const d=await saved();assert.equal(objects.get(d.storagePath).toString(),JSON.stringify(polygon));assert.equal(d.projectId,'p1');assert.equal(d.name,'대상지');assert.equal(d.fileName,'경계.geojson');assert.equal(d.geometryType,'polygon');assert(d.uploadedAt instanceof Timestamp);assert.equal(d.uploadedBy,owner.uid);assert.equal(d.data,undefined);assert.equal(d.downloadUrl,undefined);assert.match(d.storagePath,new RegExp('^ppss-spatial-datasets/p1/'+d.datasetId+'/'+d.revisionId+'/original.geojson$'));assert.equal(saves[0].options.metadata.cacheControl,'private, no-store');assert.equal(saves[0].options.metadata.metadata,undefined);
 assert.equal((await server.listDatasets(db,participant,'p1')).canManage,false);assert.equal((await server.listDatasets(db,owner,'p1')).canManage,true);assert.deepEqual((await server.readDataset(db,bucket,participant,'p1',d.datasetId,d.revisionId)).data,polygon);
});
test('uploaded building GeoJSON stores its normalized result once and reuses it without changing the original',async()=>{
 const source={...polygon,features:polygon.features.map(f=>({...f,properties:{use_code:'03000',use_name:'사용자가 넣은 이름'}}))};const original=JSON.stringify(source);
 const d=await saved(owner,{type:'buildings',data:Buffer.from(original).toString('base64')});assert.equal(objects.get(d.storagePath).toString(),original);
 const result=await server.readDataset(db,bucket,participant,'p1',d.datasetId,d.revisionId);assert.equal(result.data.features[0].properties.use_code,'03000');assert.equal(result.data.features[0].properties.use_name,'제1종근린생활시설');assert.equal(objects.get(d.storagePath).toString(),original);
 await server.readDataset(db,bucket,participant,'p1',d.datasetId,d.revisionId);assert.equal(saves.length,2);assert.deepEqual(downloads,[d.normalizedStoragePath,d.normalizedStoragePath]);assert.match(d.buildingUseVersion,/^[a-f0-9]{64}$/);
 await server.mutateDataset(db,bucket,owner,{action:'delete',projectId:'p1',datasetId:d.datasetId,expectedRevisionId:d.revisionId});assert.equal(objects.size,0);
});
test('legacy building uploads get one persisted normalization and subsequent reads reuse it',async()=>{
 const d=await saved(owner,{type:'buildings'});objects.delete(d.normalizedStoragePath);const {normalizedStoragePath,normalizedId,buildingUseVersion,...legacy}=d;await db.doc(collection+'/'+d.datasetId).set(legacy);const before=saves.length;
 await server.readDataset(db,bucket,participant,'p1',d.datasetId,d.revisionId);const cached=(await db.doc(collection+'/'+d.datasetId).get()).data();assert.ok(cached.normalizedStoragePath);assert.equal(saves.length,before+1);
 await server.readDataset(db,bucket,participant,'p1',d.datasetId,d.revisionId);assert.equal(saves.length,before+1);assert.deepEqual(downloads,[d.storagePath,cached.normalizedStoragePath]);
});
test('changed code-table versions and missing derived files rebuild once and clean the old result',async()=>{
 const d=await saved(owner,{type:'buildings'});const oldVersion='0'.repeat(64),oldPath=d.normalizedStoragePath.replace(d.buildingUseVersion,oldVersion);objects.set(oldPath,objects.get(d.normalizedStoragePath));objects.delete(d.normalizedStoragePath);await db.doc(collection+'/'+d.datasetId).update({buildingUseVersion:oldVersion,normalizedStoragePath:oldPath});
 await server.readDataset(db,bucket,owner,'p1',d.datasetId,d.revisionId);let current=(await db.doc(collection+'/'+d.datasetId).get()).data();assert.equal(current.buildingUseVersion,d.buildingUseVersion);assert.equal(objects.has(oldPath),false);assert.equal(objects.size,2);
 objects.delete(current.normalizedStoragePath);await server.readDataset(db,bucket,owner,'p1',d.datasetId,d.revisionId);const repaired=(await db.doc(collection+'/'+d.datasetId).get()).data();assert.notEqual(repaired.normalizedId,current.normalizedId);assert.equal(objects.size,2);
});
test('first-read caching rechecks membership and cleans a derived result when access is revoked mid-write',async()=>{
 const d=await saved(owner,{type:'buildings'});objects.delete(d.normalizedStoragePath);const {normalizedStoragePath,normalizedId,buildingUseVersion,...legacy}=d;await db.doc(collection+'/'+d.datasetId).set(legacy);
 afterSave=async()=>await db.doc('users/reader/projectMemberships/p1').update({revoked:true});await assert.rejects(server.readDataset(db,bucket,participant,'p1',d.datasetId,d.revisionId),e=>e.status===403);assert.equal(objects.size,1);assert.equal((await db.doc(collection+'/'+d.datasetId).get()).data().normalizedStoragePath,undefined);
});
test('concurrent first reads commit one derived result and clean the losing temporary file',async()=>{
 const d=await saved(owner,{type:'buildings'});objects.delete(d.normalizedStoragePath);const {normalizedStoragePath,normalizedId,buildingUseVersion,...legacy}=d;await db.doc(collection+'/'+d.datasetId).set(legacy);
 await Promise.all([server.readDataset(db,bucket,participant,'p1',d.datasetId,d.revisionId),server.readDataset(db,bucket,owner,'p1',d.datasetId,d.revisionId)]);const current=(await db.doc(collection+'/'+d.datasetId).get()).data();assert.ok(objects.has(current.normalizedStoragePath));assert.equal(objects.size,2);
});
test('only project/platform admins can mutate; local planner flags grant nothing',async()=>{
 for(const user of [participant,stranger])await assert.rejects(server.mutateDataset(db,bucket,user,upload({role:'planners',isAdmin:true})),e=>e.status===403);
 assert.equal(saves.length,0);await saved(admin);assert.equal(saves.length,1);
 const d=await saved();for(const user of [participant,stranger])for(const action of ['replace','delete'])await assert.rejects(server.mutateDataset(db,bucket,user,upload({action,datasetId:d.datasetId,expectedRevisionId:d.revisionId})),e=>e.status===403);
});
test('the existing create/enter/update project flow immediately controls spatial uploads without extra permissions',async()=>{
 await membership.mutateProject(db,admin,{action:'create',projectId:'new-project',project:{projectName:'새 사업',projectAdmin:' OWNER@example.COM ',accessCode:'1234',workspaceContent:{}}});
 const entered=await membership.enterProject(db,owner,'new-project');assert.equal(entered.project.projectId,'new-project');assert.equal((await db.doc('users/owner/projectMemberships/new-project').get()).exists,false);
 assert.equal((await server.listDatasets(db,owner,'new-project')).canManage,true);await saved(owner,{projectId:'new-project'});assert.equal((await db.collection('ppssSpatialPermissions_new-project').get()).size,0);
 await membership.mutateProject(db,owner,{action:'update',projectId:'new-project',project:{projectAdmin:participant.email}});
 await assert.rejects(saved(owner,{projectId:'new-project'}),e=>e.status===403);assert.equal((await server.listDatasets(db,participant,'new-project')).canManage,true);await saved(participant,{projectId:'new-project'});
});
test('retired spatial permissions are ignored and grant/revoke API actions are no longer supported',async()=>{
 await db.doc('ppssSpatialPermissions_p1/reader').set({projectId:'p1',uid:'reader',email:participant.email,grantedBy:owner.uid});
 const list=await server.listDatasets(db,participant,'p1');assert.equal(list.canManage,false);assert.equal(list.canGrant,undefined);assert.equal(list.permissions,undefined);await assert.rejects(saved(participant),e=>e.status===403);
 for(const action of ['grant','revoke'])assert.equal((await route('POST',{action,projectId:'p1',email:participant.email,uid:participant.uid})).status,400);assert.equal(saves.length,0);
});
test('retired permission documents remain private and cannot be forged by Firestore clients',async()=>{
 await db.doc('ppssSpatialPermissions_p1/reader').set({projectId:'p1',uid:'reader'});
 for(const user of [participant,owner,admin]){const client=env.authenticatedContext(user.uid,{email:user.email}).firestore();await assertFails(setDoc(doc(client,'ppssSpatialPermissions_p1','reader'),{projectId:'p1',uid:'reader'}));await assertFails(getDoc(doc(client,'ppssSpatialPermissions_p1','reader')))}
});
test('ownership changes during upload reject commit and clean the unreferenced file',async()=>{
 afterSave=async()=>await db.doc('ppssProjects/p1').update({projectAdmin:'new-owner@example.com'});
 await assert.rejects(server.mutateDataset(db,bucket,owner,upload()),e=>e.status===403);assert.equal(objects.size,0);assert.equal((await db.collection(collection).get()).size,0);
});
test('replacement keeps the dataset ID, switches versions, removes the old file, and rejects stale revisions',async()=>{
 const first=await saved();const next={...upload({fileName:'수정.json'}),action:'replace',datasetId:first.datasetId,expectedRevisionId:first.revisionId};await server.mutateDataset(db,bucket,owner,next);const d=(await db.doc(collection+'/'+first.datasetId).get()).data();assert.equal(d.datasetId,first.datasetId);assert.notEqual(d.revisionId,first.revisionId);assert.equal(d.fileName,'수정.json');assert.equal(objects.has(first.storagePath),false);assert.equal(objects.has(d.storagePath),true);
 await assert.rejects(server.mutateDataset(db,bucket,owner,next),e=>e.status===409);assert.equal(objects.size,1);await assert.rejects(server.readDataset(db,bucket,participant,'p1',d.datasetId,first.revisionId),e=>e.status===409);
});
test('delete removes the metadata and original; no other project or revoked reader can read it',async()=>{
 const d=await saved();await assert.rejects(server.readDataset(db,bucket,stranger,'p1',d.datasetId,d.revisionId),e=>e.status===403);await db.doc('users/reader/projectMemberships/p1').update({revoked:true});await assert.rejects(server.readDataset(db,bucket,participant,'p1',d.datasetId,d.revisionId),e=>e.status===403);
 await server.mutateDataset(db,bucket,owner,{action:'delete',projectId:'p1',datasetId:d.datasetId,expectedRevisionId:d.revisionId});assert.equal((await db.doc(collection+'/'+d.datasetId).get()).exists,false);assert.equal(objects.size,0);await assert.rejects(server.readDataset(db,bucket,owner,'p1',d.datasetId,d.revisionId),e=>e.status===404);
});
test('Firestore readers must be joined; all direct client metadata writes are denied, including admins',async()=>{
 const d=await saved();const reader=env.authenticatedContext(participant.uid,{email:participant.email}).firestore();const strangerDb=env.authenticatedContext(stranger.uid,{email:stranger.email}).firestore();const managerDb=env.authenticatedContext(owner.uid,{email:owner.email}).firestore();await assertSucceeds(getDoc(doc(reader,collection,d.datasetId)));await assertFails(getDoc(doc(strangerDb,collection,d.datasetId)));await assertFails(setDoc(doc(reader,collection,'fake'),{role:'admin'}));await assertFails(setDoc(doc(managerDb,collection,'fake'),{projectId:'p1'}));
});
test('CSV quoted fields, BOM and coordinate points work; non-spatial tables remain stored without fake geometry',async()=>{
 const csv='\uFEFFname,longitude,latitude\r\n"시설, 하나",126.9,37.5\r\n"두 ""시설""",127,37.6\r\n';assert.equal(parseCsv(csv)[1][0],'시설, 하나');const d=await saved(owner,{type:'public_facilities',fileName:'시설.csv',data:Buffer.from(csv).toString('base64')});assert.equal(d.geometryType,'point');const read=await server.readDataset(db,bucket,participant,'p1',d.datasetId,d.revisionId);assert.deepEqual(read.data.features[0].geometry.coordinates,[126.9,37.5]);assert.equal(read.data.features[1].properties.name,'두 "시설"');
 const table=await saved(owner,{type:'other',fileName:'통계.csv',data:Buffer.from('name,count\n시설,5').toString('base64')});assert.equal(table.geometryType,null);assert.equal(datasetLayer({...table,uploadedAt:''}),null);assert.equal((await server.readDataset(db,bucket,participant,'p1',table.datasetId,table.revisionId)).data,null);
});
test('unsupported files, invalid coordinate/type/CSV schemas and path spoofing never create records',async()=>{
 for(const patch of [{fileName:'map.shp'},{fileName:'map.zip'},{fileName:'../map.json'},{type:'unknown'},{data:''},{data:'%%%bad'},{fileName:'map.csv',data:Buffer.from('lon,lat\n,37').toString('base64')},{fileName:'map.csv',data:Buffer.from('lon,lat\n200,37').toString('base64')},{fileName:'map.csv',data:Buffer.from('a,a\n1,2').toString('base64')},{fileName:'map.csv',data:Buffer.from('lon,lat\n126,37').toString('base64')},{data:Buffer.from('not json').toString('base64')}])await assert.rejects(server.mutateDataset(db,bucket,owner,upload(patch)),e=>e.status===400);
 assert.equal(objects.size,0);assert.equal((await db.collection(collection).get()).size,0);assert.throws(()=>parseDataset(JSON.stringify({...polygon,features:[{...polygon.features[0],geometry:{type:'Point',coordinates:[400000,200000]}}]}),'json','other'));
});
test('authenticated uploaded layers merge with static config and bypass shared cache; table warnings remain visible',async t=>{
 const d=await saved();const table=await saved(owner,{type:'other',fileName:'table.csv',data:Buffer.from('name,count\none,1').toString('base64')});const old=global.fetch;let reads=0;global.fetch=async(url,options)=>{if(String(url).endsWith('config.json'))return new Response('',{status:404});assert.equal(options.headers.Authorization,'Bearer fixture');if(String(url).includes('datasetId=')){reads++;return Response.json(await server.readDataset(db,bucket,participant,'p1',d.datasetId,d.revisionId))}return Response.json(await server.listDatasets(db,participant,'p1'))};t.after(()=>{global.fetch=old});const cfg=await loader.loadSpatialConfig('p1',undefined,'fixture');assert.equal(cfg.layers.length,1);assert.equal(cfg.layers[0].role,'boundary');assert.match(cfg.datasetWarnings[0],/좌표가 없는 CSV/);const a=await loader.loadLayer(cfg.layers[0],'fixture');assert.deepEqual(a.data,polygon);await loader.loadLayer(cfg.layers[0],'fixture');assert.equal(reads,2);await assert.rejects(loader.loadLayer(cfg.layers[0]),/로그인/);assert.equal(table.geometryType,null);
});
test('API rejects missing/invalid authentication and validates methods before file access',async()=>{
 assert.equal((await route('GET',{}, {projectId:'p1'},'')).status,401);assert.equal((await route('GET',{}, {projectId:'p1'},'bad')).status,401);assert.equal((await route('PUT')).status,405);assert.equal((await route('GET',{},{})).status,400);const r=await route('POST',upload());assert.equal(r.status,200);assert.equal(r.headers['Cache-Control'],'private, no-store');assert.equal((await route('GET',{}, {projectId:'p1'})).body.datasets.length,1);
});
test('cross-project storage references and a 21st dataset are rejected with file cleanup',async()=>{
 const d=await saved();await db.doc(collection+'/'+d.datasetId).update({storagePath:'ppss-spatial-datasets/p2/stolen'});await assert.rejects(server.readDataset(db,bucket,owner,'p1',d.datasetId,d.revisionId),e=>e.status===400);await assert.rejects(server.mutateDataset(db,bucket,owner,{action:'delete',projectId:'p1',datasetId:d.datasetId,expectedRevisionId:d.revisionId}),e=>e.status===400);
 for(let i=1;i<20;i++)await db.doc(collection+'/seed'+i).set({projectId:'p1'});const before=objects.size;await assert.rejects(server.mutateDataset(db,bucket,owner,upload()),e=>e.status===400);assert.equal(objects.size,before);assert.equal((await db.collection(collection).get()).size,20);
});

test('active boundary is one project-owned reference, administrator-only, and removal preserves all files',async()=>{
 const a=await saved(),b=await saved(owner,{name:'다른 경계'}),building=await saved(owner,{type:'buildings'});
 const assign={action:'boundary-settings',projectId:'p1',activeBoundaryDatasetId:a.datasetId,defaultNearbyMeters:500,expectedBoundaryId:null};
 for(const user of [participant,stranger])await assert.rejects(server.mutateDataset(db,bucket,user,assign),e=>e.status===403);
 await server.mutateDataset(db,bucket,owner,assign);let settings=(await server.listDatasets(db,participant,'p1')).spatialSettings;assert.equal(settings.activeBoundaryDatasetId,a.datasetId);assert.equal(settings.defaultNearbyMeters,500);
 await assert.rejects(server.mutateDataset(db,bucket,owner,{...assign,activeBoundaryDatasetId:b.datasetId,expectedBoundaryId:a.datasetId}),e=>e.status===409);
 await server.mutateDataset(db,bucket,owner,{...assign,activeBoundaryDatasetId:b.datasetId,expectedBoundaryId:a.datasetId,confirmBoundaryChange:true,defaultNearbyMeters:1000});
 await assert.rejects(server.mutateDataset(db,bucket,owner,{...assign,expectedBoundaryId:a.datasetId,confirmBoundaryChange:true}),e=>e.status===409);
 await assert.rejects(server.mutateDataset(db,bucket,owner,{...assign,activeBoundaryDatasetId:null,expectedBoundaryId:b.datasetId}),e=>e.status===409);
 await server.mutateDataset(db,bucket,owner,{...assign,activeBoundaryDatasetId:null,expectedBoundaryId:b.datasetId,confirmBoundaryChange:true});
 settings=(await server.listDatasets(db,owner,'p1')).spatialSettings;assert.equal(settings.activeBoundaryDatasetId,null);assert.equal(objects.has(a.storagePath),true);assert.equal((await db.doc(collection+'/'+building.datasetId).get()).exists,true);
 await assert.rejects(server.mutateDataset(db,bucket,stranger,{...assign,projectId:'p2'}),e=>e.status===400);
});
test('active boundary replacement/deletion require confirmation and invalidate derived metadata',async()=>{
 const a=await saved(),building=await saved(owner,{type:'buildings'});
 await server.mutateDataset(db,bucket,owner,{action:'boundary-settings',projectId:'p1',activeBoundaryDatasetId:a.datasetId,expectedBoundaryId:null,defaultNearbyMeters:500});
 const larger=JSON.parse(JSON.stringify(polygon));larger.features[0].geometry.coordinates[0]=[[126,37],[126.02,37],[126.02,37.02],[126,37.02],[126,37]];
 const replace=upload({action:'replace',datasetId:a.datasetId,expectedRevisionId:a.revisionId,data:Buffer.from(JSON.stringify(larger)).toString('base64')});
 await assert.rejects(server.mutateDataset(db,bucket,owner,replace),e=>e.status===409);assert.ok(objects.has(a.storagePath));
 await server.mutateDataset(db,bucket,owner,{...replace,confirmBoundaryChange:true});const next=(await db.doc(collection+'/'+a.datasetId).get()).data();assert.ok(next.boundaryMetadata.areaSqm>a.boundaryMetadata.areaSqm*3.9);assert.notEqual(next.revisionId,a.revisionId);assert.equal((await server.listDatasets(db,owner,'p1')).spatialSettings.activeBoundaryDatasetId,a.datasetId);
 const remove={action:'delete',projectId:'p1',datasetId:a.datasetId,expectedRevisionId:next.revisionId};await assert.rejects(server.mutateDataset(db,bucket,owner,remove),e=>e.status===409);await server.mutateDataset(db,bucket,owner,{...remove,confirmBoundaryChange:true});assert.equal((await server.listDatasets(db,owner,'p1')).spatialSettings.activeBoundaryDatasetId,null);assert.equal((await db.doc(collection+'/'+building.datasetId).get()).exists,true);
});
test('boundary uploads require reliable/confirmed CRS and preserve projected original bytes',async()=>{
 await assert.rejects(server.mutateDataset(db,bucket,owner,upload({sourceCrs:undefined})),e=>e.status===400&&/confirmCrs/.test(e.message));
 const {toMercator}=require('@turf/turf'),mercator=toMercator(polygon),raw=JSON.stringify(mercator);
 const projected=await saved(owner,{sourceCrs:'EPSG:3857',data:Buffer.from(raw).toString('base64')});assert.equal(objects.get(projected.storagePath).toString(),raw);assert.equal(projected.sourceCrs,'EPSG:3857');const parsed=(await server.readDataset(db,bucket,participant,'p1',projected.datasetId,projected.revisionId)).data;assert.ok(Math.abs(parsed.features[0].geometry.coordinates[0][0][0]-126)<1e-6);
 const legacy=await saved();await db.doc(collection+'/'+legacy.datasetId).update({sourceCrs:require('firebase-admin/firestore').FieldValue.delete()});const assign={action:'boundary-settings',projectId:'p1',activeBoundaryDatasetId:legacy.datasetId,defaultNearbyMeters:0,expectedBoundaryId:null};await assert.rejects(server.mutateDataset(db,bucket,owner,assign),e=>e.status===400);await server.mutateDataset(db,bucket,owner,{...assign,sourceCrs:'EPSG:4326'});assert.equal((await server.listDatasets(db,owner,'p1')).spatialSettings.activeBoundaryDatasetId,legacy.datasetId);
});
async function reviewRoute(user,body,method='POST'){
 const api=require(build+'/pages/api/projects/analysis-review.js').default,original={verify:adminModule.verifyUserRequest,db:adminModule.adminDb,bucket:adminModule.adminBucket};
 adminModule.verifyUserRequest=async()=>user;adminModule.adminDb=()=>db;adminModule.adminBucket=()=>bucket;const result={};const res={setHeader(){},status(n){result.status=n;return this},json(value){result.body=value;return this},end(){}};
 try{await api({method,headers:{authorization:'Bearer fixture'},body:{projectId:'p1',...body},query:{projectId:'p1'}},res);return result}finally{adminModule.verifyUserRequest=original.verify;adminModule.adminDb=original.db;adminModule.adminBucket=original.bucket}
}
test('analysis review is private, preserves chat logs, survives reads, and is supplied only to its owner in Step 3',async()=>{
 await db.doc('users_p1/reader/steps/data').set({logs:[{sender:'user',text:'기존 질문'}]});
 let response=await reviewRoute(participant,{action:'add',kind:'observation',text:'내가 관찰한 개인 의견',uid:'owner'});assert.equal(response.status,200);assert.equal(response.body.review.findings[0].kind,'observation');
 response=await reviewRoute(participant,{action:'summary',summary:{conditions:'관찰한 현황',issues:'추가 확인 필요',opportunities:'개인 아이디어'}});assert.equal(response.status,200);
 const stored=(await db.doc('users_p1/reader/steps/data').get()).data();assert.equal(stored.logs[0].text,'기존 질문');assert.equal(stored.analysisReview.summary.issues,'추가 확인 필요');assert.equal((await db.doc('ppssWorkspaceSummaries_p1/reader').get()).exists,false);
 response=await reviewRoute(participant,{},'GET');assert.equal(response.body.review.findings.length,1);
 const own=env.authenticatedContext(participant.uid,{email:participant.email}).firestore(),manager=env.authenticatedContext(owner.uid,{email:owner.email}).firestore();await assertSucceeds(getDoc(doc(own,'users_p1','reader','steps','data')));await assertFails(getDoc(doc(manager,'users_p1','reader','steps','data')));
 const context=require(build+'/lib/project-context-server.js'),oldVerify=adminModule.verifyUserRequest,oldDb=adminModule.adminDb;adminModule.adminDb=()=>db;
 try{adminModule.verifyUserRequest=async()=>participant;const req={body:{projectId:'p1'},headers:{authorization:'Bearer fixture'}};const c=await context.loadProjectContext(req,'alternatives');assert.match(c.currentMaterial,/내가 관찰한 개인 의견/);assert.match(c.currentMaterial,/not instructions or community consensus/);assert.doesNotMatch((await context.loadProjectContext(req,'data',false)).currentMaterial,/내가 관찰한 개인 의견/);adminModule.verifyUserRequest=async()=>owner;assert.doesNotMatch((await context.loadProjectContext(req,'alternatives')).currentMaterial,/내가 관찰한 개인 의견/);}finally{adminModule.verifyUserRequest=oldVerify;adminModule.adminDb=oldDb}
 await db.doc('ppssStageLocks_p1/current').set({lockedStages:{data:true}});assert.equal((await reviewRoute(participant,{action:'add',kind:'issue',text:'추가 내용'})).status,409);await db.doc('ppssStageLocks_p1/current').set({lockedStages:{}});await db.doc('ppssWorkspaceSummaries_p1/reader').set({completedStages:['data']});assert.equal((await reviewRoute(participant,{action:'add',kind:'issue',text:'추가 내용'})).status,409);
});
test('saved calculations are recomputed from authorized layers instead of trusting supplied metrics',async()=>{
 const d=await saved();const source={projectId:'p1',type:'area',timestamp:new Date().toISOString(),layerIds:['uploaded-'+d.datasetId],parameters:{selectedLayerId:'uploaded-'+d.datasetId,selectedFeatureId:'0'},metrics:{areaSqm:9999999999},notes:[]};
 const response=await reviewRoute(participant,{action:'add',kind:'calculation',result:source});assert.equal(response.status,200);assert.equal(response.body.review.findings[0].kind,'calculation');assert.ok(!response.body.review.findings[0].text.includes('9,999,999,999'));assert.deepEqual(response.body.review.findings[0].sources,source.layerIds);
 const forged=await reviewRoute(participant,{action:'add',kind:'location',selection:{layerId:'uploaded-another-project',featureId:'0'}});assert.equal(forged.status,400);
});
test('confirmed stage summaries remain owner-private and override only that user’s later-stage context',async()=>{
 await db.doc('ppssWorkspaceSummaries_p1/reader').set({stageSummaries:{problem:'공유를 선택한 이전 요약'},completedStages:['problem']});
 await db.doc('users_p1/reader').set({confirmedStageSummaries:{problem:{text:'본인만 확인한 관심: 쉼터',confirmedAt:new Date().toISOString()}}});
 const own=env.authenticatedContext(participant.uid,{email:participant.email}).firestore(),manager=env.authenticatedContext(owner.uid,{email:owner.email}).firestore();await assertSucceeds(getDoc(doc(own,'users_p1','reader')));await assertSucceeds(setDoc(doc(own,'users_p1','reader'),{confirmedStageSummaries:{data:{text:'본인만 확인한 자료 분석',confirmedAt:new Date().toISOString()}}},{merge:true}));assert.ok((await db.doc('users_p1/reader').get()).data().confirmedStageSummaries.problem);await assertFails(getDoc(doc(manager,'users_p1','reader')));
 const context=require(build+'/lib/project-context-server.js'),oldVerify=adminModule.verifyUserRequest,oldDb=adminModule.adminDb;adminModule.adminDb=()=>db;
 try{adminModule.verifyUserRequest=async()=>participant;const req={body:{projectId:'p1'},headers:{authorization:'Bearer fixture'}};assert.match((await context.loadProjectContext(req,'alternatives')).previousSummaries.problem,/본인만/);adminModule.verifyUserRequest=async()=>owner;assert.ok(!(await context.loadProjectContext(req,'alternatives')).previousSummaries.problem);}finally{adminModule.verifyUserRequest=oldVerify;adminModule.adminDb=oldDb}
 assert.equal((await db.doc('ppssWorkspaceSummaries_p1/reader').get()).data().stageSummaries.problem,'공유를 선택한 이전 요약');
});
