import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),build=process.env.PSS_TEST_BUILD;
const admin=require(`${build}/lib/firebaseAdmin.js`),service=require(`${build}/lib/participants-server.js`),rbac=require(`${build}/lib/rbac.js`),handler=require(`${build}/pages/api/projects/participant-summaries.js`).default;
const mock=(t,obj,key,value)=>{const old=obj[key];obj[key]=value;t.after(()=>obj[key]=old)};
function fixture(t){
 const store=new Map(),project={projectAdmin:'owner@example.com'};
 const put=(path,data)=>store.set(path,structuredClone(data));
 put('ppssProjects/p',project);put('ppssProjects/other',{projectAdmin:'other@example.com'});
 const identities=[{uid:'admin-uid',email:'test@snu.ac.kr'},{uid:'system-uid',email:'adm@snu.ac.kr'},{uid:'owner-uid',email:'owner@example.com'},{uid:'p1',email:'participant01@example.com'},{uid:'p2',email:'participant02@example.com'}];
 for(const u of identities){put(`ppssWorkspaceSummaries_p/${u.uid}`,{completedStages:['problem','data'],stageSummaries:{data:`summary-${u.uid}`},overallSummary:`overall-${u.uid}`,role:'public'});put(`ppssEvaluations_p/${u.uid}`,{userId:u.uid,rankings:{a:1}});put(`ppssUserDesignSubmissions_p/${u.uid}`,{userId:u.uid,imageId:`image-${u.uid}`,createdAt:'2026-11-01T00:00:00Z'});put(`ppssEvaluationImages_p/${u.uid}`,{userId:u.uid,imageId:`image-${u.uid}`});}
 put('ppssWorkspaceSummaries_p/ TEST@snu.ac.kr ',{completedStages:['data'],stageSummaries:{data:'legacy admin text'}});
 put('users/p1/projectMemberships/p',{role:'participant'});
 for(const uid of ['p1','p2'])for(const stage of ['problem','data'])put(`users_p/${uid}/steps/${stage}`,{logs:[{stepId:stage,sender:'user',text:`private-${uid}`,createdAt:'2026-11-01T00:00:00Z'}]});
 const doc=path=>({path,get:async()=>snapshot(path)}),snapshot=path=>({id:path.split('/').at(-1),ref:doc(path),exists:store.has(path),data:()=>structuredClone(store.get(path))});
 const db={doc,collection:path=>({get:async()=>({docs:[...store.keys()].filter(p=>p.startsWith(path+'/')&&p.slice(path.length+1).indexOf('/')<0).map(snapshot)})}),runTransaction:async callback=>{const writes=[];await callback({get:ref=>ref.get(),set:(ref,data,options)=>writes.push([ref.path,data,options])});for(const [path,data,options] of writes)store.set(path,options?.merge?{...store.get(path),...data}:data)}};
 mock(t,admin,'adminDb',()=>db);mock(t,admin,'adminAuth',()=>({getUsers:async ids=>({users:identities.filter(u=>ids.some(id=>id.uid===u.uid))})}));mock(t,admin,'verifyUserRequest',async token=>{if(!token)throw Error('missing auth');return token==='reader'?{uid:'p1',email:'participant01@example.com'}:{uid:'owner-uid',email:'owner@example.com'}});
 return {db,store,put,project};
}
async function route({method='GET',query={projectId:'p'},body,token='manager'}={}){const result={headers:{}};await handler({method,query,body,headers:token?{authorization:`Bearer ${token}`} : {}},{setHeader(k,v){result.headers[k]=v},status(code){result.status=code;return this},json(body){result.body=body}});return result}

test('administrator UID, email legacy records and project/system managers are excluded before all aggregations',async t=>{
 const {db,store,project}=fixture(t);
 assert.equal(rbac.isResearchParticipant(' TEST@SNU.AC.KR ',project),false);assert.equal(rbac.isResearchParticipant('participant01@example.com',project),true);
 const rows=await service.participantSummaries(db,'p');assert.deepEqual(rows.map(row=>row.userId),['p1','p2']);assert.deepEqual(rows.map(row=>row.participantId),['participant01@example.com','participant02@example.com']);
 const counts=rows.reduce((acc,row)=>{for(const stage of row.summary.completedStages)acc[stage]=(acc[stage]??0)+1;return acc},{});assert.deepEqual(counts,{problem:2,data:2});assert.equal(counts.data/rows.length,1);assert.doesNotMatch(JSON.stringify(rows),/admin-uid|owner-uid|legacy admin|test@snu/);
 for(const kind of ['evaluations','submissions','images'])assert.deepEqual((await service.participantRecords(db,'p',kind)).map(row=>row.userId),['p1','p2']);
 assert.ok(store.has('ppssWorkspaceSummaries_p/admin-uid'),'administrator account and original data remain intact');
});

test('manager participant list provides display IDs while ordinary participants do not receive emails',async t=>{
 fixture(t);const response=await route();assert.equal(response.status,200);assert.equal(response.body.summaries.length,2);assert.equal(response.body.summaries[0].participantId,'participant01@example.com');assert.match(response.headers['Cache-Control'],/no-store/);
 const reader=await route({token:'reader'});assert.equal(reader.status,200);assert.ok(reader.body.summaries.every(row=>!row.participantId));
 assert.equal((await route({token:null})).status,401);assert.equal((await route({query:{projectId:'other'},token:'reader'})).status,403);
});

test('soft reset archives only one participant/stage, retaining all completion, summary, uploads and other participant data',async t=>{
 const {store}=fixture(t),before=new Map([...store].map(([key,value])=>[key,structuredClone(value)]));
 const result=await route({method:'POST',body:{projectId:'p',action:'softResetChat',userId:'p1',stageId:'data'}});assert.equal(result.status,200);assert.deepEqual(store.get('users_p/p1/steps/data').logs,[]);assert.ok(store.get('users_p/p1/steps/data').chatResetAt);
 const archives=[...store].filter(([key])=>key.startsWith('users_p/p1/steps/data/chatResetArchives/'));assert.equal(archives.length,1);assert.deepEqual(archives[0][1].previous,before.get('users_p/p1/steps/data'));
 for(const [key,value] of before)if(key!=='users_p/p1/steps/data')assert.deepEqual(store.get(key),value,key);
});

test('reset denies participants, invalid stages, other projects and arbitrary user paths without writes',async t=>{
 const {store}=fixture(t),before=JSON.stringify([...store]);
 for(const options of [{token:'reader',body:{projectId:'p',userId:'p1',stageId:'data'}},{body:{projectId:'other',userId:'p1',stageId:'data'}},{body:{projectId:'p',userId:'p2/steps/data',stageId:'data'}},{body:{projectId:'p',userId:'p1',stageId:'invalid'}},{body:{projectId:'p',userId:'admin-uid',stageId:'data'}},{body:{projectId:'p',userId:'missing',stageId:'data'}}]){const response=await route({method:'POST',...options,body:{action:'softResetChat',...options.body}});assert.ok(response.status>=400)}
 assert.equal(JSON.stringify([...store]),before);
});

test('a stale client cannot restore archived messages after soft reset',()=>{
 const {mergeStepChatLogs}=require(`${build}/lib/chat-history.js`);
 const old={sender:'user',text:'old',createdAt:'2026-11-01T00:00:00Z'},legacy={sender:'user',text:'legacy'},fresh={sender:'user',text:'new',createdAt:'2026-11-09T12:01:00Z'};
 assert.deepEqual(mergeStepChatLogs([], [old,legacy,fresh], '2026-11-09T12:00:00Z'),[fresh]);
 assert.deepEqual(mergeStepChatLogs([old], [old,fresh], '2026-11-09T12:00:00Z'),[fresh]);
 assert.equal(mergeStepChatLogs([old], [legacy,fresh]).length,3);
});

test('executive-summary LLM input contains only eligible participant counts and responses',async t=>{
 const {db,store}=fixture(t),firebase=require(`${build}/lib/firebase.js`),executive=require(`${build}/pages/api/admin/executive-summary.js`).default;
 const originalCollection=db.collection;db.collection=path=>({...originalCollection(path),add:async data=>{store.set(`${path}/generated`,data);return {id:'generated'}}});
 mock(t,admin,'verifyAdminRequest',async()=>({uid:'owner-uid',email:'owner@example.com'}));mock(t,firebase,'loadBackgroundKnowledge',async()=>null);
 const key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture';t.after(()=>{if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key});
 let received;mock(t,global,'fetch',async(url,options)=>{received=JSON.parse(options.body);return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({keywords:['보행','녹지'],conclusion:'참여자 종합'})}]}]})});
 const result={};await executive({method:'POST',headers:{authorization:'Bearer manager'},body:{projectId:'p',stageId:'data'}},{status(code){result.status=code;return this},json(body){result.body=body}});
 assert.equal(result.status,200);const prompt=received.input[1].content;assert.match(prompt,/"participants":2/);assert.match(prompt,/summary-p1/);assert.match(prompt,/summary-p2/);assert.doesNotMatch(prompt,/summary-admin|summary-system|summary-owner|legacy admin/);assert.equal(store.get('ppssExecutiveSummaries_p/generated').participantFilterVersion,rbac.PARTICIPANT_FILTER_VERSION);
});
