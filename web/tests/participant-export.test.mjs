import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PassThrough, Readable } from 'node:stream';
const require = createRequire(import.meta.url), root = process.env.PSS_TEST_BUILD;
const admin = require(`${root}/lib/firebaseAdmin.js`), server = require(`${root}/lib/participant-export-server.js`);
const client = require(`${root}/lib/participant-export.js`), handler = require(`${root}/pages/api/admin/participant-export.js`).default;
const mock = (t, object, name, value) => { const old = object[name]; object[name] = value; t.after(() => object[name] = old); };
function fixture(t) {
 const store = new Map(), reads = [], binaries = [];
 const put = (path,data) => store.set(path, structuredClone(data));
 const ids = [{uid:'p1',email:'one@example.com'}, {uid:'p2',email:'two@example.com'}, {uid:'unfinished',email:'unfinished@example.com'}, {uid:'admin',email:'test@snu.ac.kr'}, {uid:'manager',email:'owner@example.com'}, {uid:'system',email:'adm@snu.ac.kr'}];
 put('ppssProjects/p',{projectAdmin:'owner@example.com'});put('ppssProjects/other',{projectAdmin:'elsewhere@example.com'});
 for (const identity of ids) put(`ppssWorkspaceSummaries_p/${identity.uid}`,{role:'public',completedStages:['problem'],stageSummaries:{problem:`summary-${identity.uid}`}});
 store.delete('ppssWorkspaceSummaries_p/unfinished');
 put('users_p/unfinished/steps/problem',{logs:[{id:'unfinished-message',sender:'user',text:'not completed'}]});
 put('users_p/p1',{confirmedStageSummaries:{problem:{text:'original confirmed summary'}}});
 put('users_p/p1/steps/problem',{sessionId:'session-1',logs:[{id:'m1',sender:'user',text:'=1+2',createdAt:'2026-01-01'},{id:'m2',sender:'assistant',text:'AI response'}]});
 put('users_p/p1/steps/data',{logs:[{id:'view-1',sender:'assistant',activity:{type:'cases',referenceId:'case1',title:'Viewed case'}},{id:'m3',sender:'user',text:'two\nlines, "quoted"'}]});
 put('users_p/p1/steps/problem/chatResetArchives/old',{previous:{logs:[{id:'old-m1',sender:'user',text:'archived original'}]},resetAt:'2026-01-02'});
 put('ppssChatLogs_p/p1',{logsByStep:{problem:[{id:'legacy-m1',sender:'user',text:'legacy original'}]}});
 put('ppssGeneratedImages_p/image-1',{userId:'p1',imageId:'image-1',note:'exact original prompt',storagePath:'projects/p/generated-images/image-1.png',designMetadata:{rootImageId:'image-1',versionNumber:0}});
 put('ppssGeneratedImages_p/image-2',{userId:'p1',imageId:'image-2',note:'exact edit prompt',storagePath:'ppss-generated-images/p/image-2.png',designMetadata:{parentImageId:'image-1',versionNumber:1,editRequest:'remove a pot'}});
 put('ppssGeneratedImages_p/other-image',{userId:'p2',imageId:'other-image',note:'private-p2'});
 put('ppssGeneratedImages_other/elsewhere',{userId:'p1',note:'other project secret'});
 put('ppssEvaluations_p/eval-1',{userId:'p1',rankings:{'image-2':1,'other-image':2},reason:'original reason'});
 put('ppssEvaluations_p/eval-2',{userId:'p1',rankings:{'image-2':3}});
 put('ppssUserDesignSubmissions_p/sub-1',{userId:'p1',imageId:'image-2'});
 put('ppssEvaluationImages_p/published-1',{userId:'p1',imageId:'image-2',note:'published prompt'});
 const doc = path => ({path,id:path.split('/').at(-1),get:async()=>{reads.push(path);return snapshot(path)},collection:sub=>collection(`${path}/${sub}`)});
 const snapshot = path => ({exists:store.has(path),id:path.split('/').at(-1),ref:doc(path),data:()=>structuredClone(store.get(path))});
 const collection = (path,filters=[]) => ({
   select:()=>collection(path,filters),where:(key,op,value)=>collection(path,[...filters,[key,value]]),
   listDocuments:async()=>[...new Set([...store.keys()].filter(key=>key.startsWith(path+'/')).map(key=>path+'/'+key.slice(path.length+1).split('/')[0]))].map(doc),
   get:async()=>{reads.push(path);return {docs:[...store.keys()].filter(key=>key.startsWith(path+'/')&&!key.slice(path.length+1).includes('/')&&filters.every(([field,value])=>store.get(key)?.[field]===value)).map(snapshot)}}
 });
 const db = {doc,collection}; // Intentionally no set/update/delete/transaction methods.
 mock(t,admin,'adminDb',()=>db);
 mock(t,admin,'adminAuth',()=>({getUsers:async users=>({users:ids.filter(id=>users.some(u=>u.uid===id.uid))}),getUser:async uid=>{const user=ids.find(id=>id.uid===uid);if(!user)throw Object.assign(Error('deleted'),{code:'auth/user-not-found'});return user}}));
 mock(t,admin,'verifyUserRequest',async token=>{if(!token)throw Error('missing');return token==='reader'?ids[0]:ids.find(id=>id.uid==='manager')});
 mock(t,admin,'adminBucket',()=>({name:'fixture-bucket',file:path=>{binaries.push(path);return {getMetadata:async()=>[{size:8}],createReadStream:()=>Readable.from([Buffer.from('PNG-test')])}}}));
 return {db,store,put,reads,binaries};
}
async function route(query={projectId:'p'},token='manager',method='GET') {
 const response=new PassThrough(); const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.headers={};response.headersSent=false;
 response.setHeader=(key,value)=>response.headers[key]=value;response.status=code=>{response.statusCode=code;return response};response.json=body=>{response.body=body;return response};
 await handler({method,query,headers:token?{authorization:`Bearer ${token}`} : {}},response);
 response.bytes=Buffer.concat(chunks);return response;
}

test('export listing includes unfinished step-only accounts, excludes administrators, and is scoped/read-only',async t=>{
 const {store}=fixture(t),before=JSON.stringify([...store]);const result=await route();
 assert.equal(result.statusCode,200);assert.deepEqual(result.body.participants.map(row=>row.userId),['p1','p2','unfinished']);
 assert.match(result.headers['Cache-Control'],/no-store/);assert.equal(JSON.stringify([...store]),before);
});

test('one participant export preserves current/legacy/archived conversations, IDs, all evaluations, image versions and prompts',async t=>{
 const {store,binaries}=fixture(t),before=JSON.stringify([...store]);const result=await route({projectId:'p',userId:'p1'});
 assert.equal(result.statusCode,200);const data=result.body;assert.equal(data.userId,'p1');assert.equal(data.participantId,'one@example.com');
 assert.equal(data.steps.length,5);assert.equal(data.steps[0].document.data.sessionId,'session-1');assert.equal(data.steps[0].archives[0].data.previous.logs[0].id,'old-m1');
 assert.equal(data.legacyChat.data.logsByStep.problem[0].id,'legacy-m1');assert.equal(data.evaluations.length,2);assert.equal(data.evaluations[0].data.reason,'original reason');
 assert.deepEqual(data.generatedImages.map(row=>row.id),['image-1','image-2']);assert.equal(data.generatedImages[1].data.designMetadata.parentImageId,'image-1');
 assert.equal(data.submissions[0].data.imageId,'image-2');assert.equal(data.summary.data.completedStages[0],'problem');
 assert.doesNotMatch(JSON.stringify(data),/private-p2|other project secret|summary-p2/);assert.equal(binaries.length,0,'metadata does not load binary files');assert.equal(JSON.stringify([...store]),before);
});

test('new/incomplete users and deleted legacy identities export existing data without requiring completion',async t=>{
 const {put}=fixture(t);assert.equal((await route({projectId:'p',userId:'unfinished'})).statusCode,200);
 put('users_p/deleted-user/steps/data',{logs:[{id:'deleted-m',sender:'user',text:'still preserved'}]});
 assert.equal((await route({projectId:'p',userId:'deleted-user'})).statusCode,200);
 assert.equal((await route({projectId:'p',userId:'absent'})).statusCode,404);
});

test('export API denies anonymous/nonmanager/foreign-project/path traversal requests before loading private documents',async t=>{
 const {reads,store}=fixture(t),before=JSON.stringify([...store]);
 for(const [query,token,method,status] of [
  [{projectId:'p',userId:'p1'},null,'GET',401], [{projectId:'p',userId:'p1'},'reader','GET',403],
  [{projectId:'other',userId:'p1'},'manager','GET',403], [{projectId:'../p'},'manager','GET',400],
  [{projectId:'p',userId:'p1/steps/data'},'manager','GET',400], [{projectId:'p',userId:['p1','p2']},'manager','GET',400],
  [{projectId:'p',userId:'admin'},'manager','GET',403], [{projectId:'p'},'manager','POST',405],
 ]) { const result=await route(query,token,method);assert.equal(result.statusCode,status); }
 assert.ok(!reads.includes('users_p/p1/steps/problem'));assert.equal(JSON.stringify([...store]),before);
});

test('image downloads require manager rights, exact owner and project-scoped storage; never fetch arbitrary URLs',async t=>{
 const {binaries,put,store}=fixture(t),before=JSON.stringify([...store]);
 const response=await route({projectId:'p',userId:'p1',imageId:'image-1'});assert.equal(response.bytes.toString(),'PNG-test');assert.equal(response.headers['X-PPSS-Image-Extension'],'png');
 assert.equal((await route({projectId:'p',userId:'p2',imageId:'image-1'})).statusCode,404);
 assert.equal((await route({projectId:'p',userId:'p1',imageId:'image-1'},'reader')).statusCode,403);
 assert.equal(JSON.stringify([...store]),before);assert.equal(binaries.length,1);
 put('ppssGeneratedImages_p/bad',{userId:'p1',storagePath:'projects/other/generated-images/secret.png'});
 assert.equal((await route({projectId:'p',userId:'p1',imageId:'bad'})).statusCode,404);assert.equal(binaries.length,1);
 for(const path of ['projects/p/generated-images/../../secret.png','projects/p/generated-images/x\\evil.png','projects/p/generated-images/file.html'])assert.throws(()=>server.exportImagePath('p',{storagePath:path},'fixture-bucket'));
 assert.equal(server.exportImagePath('p',{downloadUrl:'https://firebasestorage.googleapis.com/v0/b/fixture-bucket/o/projects%2Fp%2Fgenerated-images%2Flegacy.jpg?alt=media&token=secret'},'fixture-bucket'),'projects/p/generated-images/legacy.jpg');
 for(const url of ['http://localhost/private','https://evil.test/v0/b/fixture-bucket/o/projects%2Fp%2Fgenerated-images%2Fx.png','https://firebasestorage.googleapis.com/v0/b/other-bucket/o/projects%2Fp%2Fgenerated-images%2Fx.png'])assert.throws(()=>server.exportImagePath('p',{downloadUrl:url},'fixture-bucket'));
});

test('download limit and storage failures produce isolated errors without modifying source data',async t=>{
 const {store}=fixture(t),before=JSON.stringify([...store]);
 mock(t,admin,'adminBucket',()=>({name:'fixture-bucket',file:()=>({getMetadata:async()=>[{size:21*1024*1024}],createReadStream:()=>{throw Error('must not read')}})}));
 assert.equal((await route({projectId:'p',userId:'p1',imageId:'image-1'})).statusCode,413);
 mock(t,admin,'adminBucket',()=>({name:'fixture-bucket',file:()=>({getMetadata:async()=>{throw Error('private storage failure')}})}));
 const response=await route({projectId:'p',userId:'p1',imageId:'image-1'});assert.equal(response.statusCode,503);assert.doesNotMatch(JSON.stringify(response.body),/private storage failure/);assert.equal(JSON.stringify([...store]),before);
});

test('ZIP input preserves raw records, protects CSV formulas, and separates explicit activity from resident dialogue',async t=>{
 fixture(t);const data=(await route({projectId:'p',userId:'p1'})).body,before=JSON.stringify(data);const files=client.participantExportFiles(data),read=name=>new TextDecoder().decode(files[name]);
 assert.match(read('conversation.json'),/"text": "=1\+2"/);assert.match(read('conversation.csv'),/"'=1\+2"/);assert.match(read('conversation.csv'),/two\nlines, ""quoted""/);
 assert.match(read('conversation.csv'),/legacy-m1/);assert.match(read('conversation.csv'),/old-m1/);
 assert.equal(JSON.parse(read('activity-logs.json')).entries.length,1);assert.equal(JSON.parse(read('activity-logs.json')).entries[0].log.activity.title,'Viewed case');
 assert.match(read('rankings.csv'),/eval-1/);assert.match(read('rankings.csv'),/eval-2/);assert.equal(read('images/001-image-1-prompt.txt'),'exact original prompt');assert.equal(read('images/002-image-2-prompt.txt'),'exact edit prompt');
 assert.match(read('images/002-image-2.json'),/"parentImageId": "image-1"/);assert.equal(JSON.stringify(data),before);
 const {zipSync,unzipSync}=require('fflate');const zip=zipSync(Object.fromEntries(Object.entries(files).map(([name,value])=>['001-one@example.com/'+name,value])),{level:0});
 const restored=unzipSync(zip);assert.equal(new TextDecoder().decode(restored['001-one@example.com/images/002-image-2-prompt.txt']),'exact edit prompt');
 assert.ok(!client.exportFileName('../../a/b').includes('/'));
});
