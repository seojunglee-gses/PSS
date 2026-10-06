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
const upload=(overrides={})=>({action:'upload',projectId:'p1',name:'대상지',type:'project_boundary',fileName:'경계.geojson',data:Buffer.from(JSON.stringify(polygon)).toString('base64'),...overrides});
let env,objects,saves,deletes,bucket,afterSave;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-pss-membership',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}})});
after(async()=>{await env.cleanup();await db.terminate()});
beforeEach(async()=>{
 await env.clearFirestore();await db.doc('ppssProjects/p1').set({projectId:'p1',projectAdmin:owner.email});await db.doc('ppssProjects/p2').set({projectId:'p2',projectAdmin:stranger.email});await db.doc('users/reader/projectMemberships/p1').set({role:'participant',projectId:'p1'});
 objects=new Map();saves=[];deletes=[];afterSave=undefined;
 bucket={file:path=>({save:async(bytes,options)=>{objects.set(path,Buffer.from(bytes));saves.push({path,options});if(afterSave)await afterSave()},download:async()=>{if(!objects.has(path))throw Error('missing fixture file');return [objects.get(path)]},delete:async()=>{deletes.push(path);objects.delete(path)}})};
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
