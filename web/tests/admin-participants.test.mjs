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

test('test administrator reset uses a separate fixed-email target and leaves participant lists/statistics excluded',async t=>{
 const {db,store,put}=fixture(t),auth=admin.adminAuth();let lookups=0;
 mock(t,admin,'adminAuth',()=>({...auth,getUserByEmail:async email=>{lookups++;assert.equal(email,rbac.TEST_ADMIN_EMAIL);return {uid:'admin-uid',email:'test@snu.ac.kr'}}}));
 put('users_p/admin-uid/steps/data',{logs:[{id:'admin-message',sender:'user',text:'Synthetic admin test dialogue',createdAt:'2026-11-01T00:00:00Z'}],sessionId:'admin-session',analysisReview:{note:'preserve'}});
 put('users_p/admin-uid/steps/problem',{logs:[{id:'other-stage',sender:'user',text:'Other stage'}]});
 const before=new Map([...store].map(([key,value])=>[key,structuredClone(value)]));
 const result=await route({method:'POST',body:{projectId:'p',action:'softResetTestAdminChat',stageId:'data',userId:'p1',email:'participant01@example.com'}});
 assert.equal(result.status,200);assert.equal(lookups,1);assert.deepEqual(store.get('users_p/admin-uid/steps/data').logs,[]);assert.equal(store.get('users_p/admin-uid/steps/data').sessionId,'admin-session');assert.deepEqual(store.get('users_p/admin-uid/steps/data').analysisReview,{note:'preserve'});
 const archives=[...store].filter(([key])=>key.startsWith('users_p/admin-uid/steps/data/chatResetArchives/'));assert.equal(archives.length,1);assert.deepEqual(archives[0][1].previous,before.get('users_p/admin-uid/steps/data'));assert.equal(archives[0][1].resetBy,'owner-uid');
 for(const [key,value] of before)if(key!=='users_p/admin-uid/steps/data')assert.deepEqual(store.get(key),value,key);
 const list=await route();assert.deepEqual(list.body.summaries.map(row=>row.userId),['p1','p2']);
 for(const kind of ['evaluations','submissions','images'])assert.deepEqual((await service.participantRecords(db,'p',kind)).map(row=>row.userId),['p1','p2']);
 assert.equal(store.get('ppssWorkspaceSummaries_p/admin-uid').completedStages.includes('data'),true);
});

test('separate test-admin reset rejects unauthorized/invalid requests before resolving the target account',async t=>{
 const {store}=fixture(t),before=JSON.stringify([...store]);let lookups=0;
 mock(t,admin,'adminAuth',()=>({getUserByEmail:async()=>{lookups++;return {uid:'admin-uid',email:'test@snu.ac.kr'}}}));
 for(const options of [{token:'reader',body:{projectId:'p',stageId:'data'}},{token:null,body:{projectId:'p',stageId:'data'}},{body:{projectId:'other',stageId:'data'}},{body:{projectId:'p',stageId:'../data'}},{body:{projectId:'p',stageId:undefined}}]){
  const result=await route({method:'POST',...options,body:{action:'softResetTestAdminChat',...options.body}});assert.ok(result.status>=400);
 }
 assert.equal(lookups,0);assert.equal(JSON.stringify([...store]),before);
});

test('missing or mismatched administrator identities cannot reset any participant data',async t=>{
 const {store}=fixture(t),before=JSON.stringify([...store]);
 mock(t,admin,'adminAuth',()=>({getUserByEmail:async()=>{throw Object.assign(Error('not found'),{code:'auth/user-not-found'})}}));
 const missing=await route({method:'POST',body:{projectId:'p',action:'softResetTestAdminChat',stageId:'data'}});assert.equal(missing.status,404);
 mock(t,admin,'adminAuth',()=>({getUserByEmail:async()=>({uid:'p1',email:'participant01@example.com'})}));
 const wrong=await route({method:'POST',body:{projectId:'p',action:'softResetTestAdminChat',stageId:'data'}});assert.equal(wrong.status,403);assert.equal(JSON.stringify([...store]),before);
});

test('failed admin reset transaction preserves the original chat instead of partially clearing it',async t=>{
 const {db,store,put}=fixture(t);put('users_p/admin-uid/steps/data',{logs:[{id:'original',text:'preserved'}]});const before=JSON.stringify([...store]);
 mock(t,admin,'adminAuth',()=>({getUserByEmail:async()=>({uid:'admin-uid',email:'test@snu.ac.kr'})}));
 db.runTransaction=async callback=>{await callback({get:ref=>ref.get(),set(){}});throw Error('fixture commit failed')};
 const result=await route({method:'POST',body:{projectId:'p',action:'softResetTestAdminChat',stageId:'data'}});assert.equal(result.status,503);assert.equal(JSON.stringify([...store]),before);
});

test('evaluation descriptions use exact submitted revision and chronological edits, never returning internal prompt fields or altering records',async t=>{
 const {store,put}=fixture(t),design=require(`${build}/lib/design-alternatives-server.js`);
 const elements=[{text:'골목 보행 연결과 길 안내 개선',origin:'ai',basis:'내부 근거'},{text:'갈림길에 작은 방향 안내판',origin:'participant',basis:'원본 발언'}];
 put(design.designRef('p','p1','revision:submitted-r').path,{direction:{interventions:elements}});
 put(design.designRef('p','p1','direction').path,{direction:{interventions:[{text:'제출 이후 다른 설계 방향',origin:'ai'}]}});
 put('ppssGeneratedImages_p/root',{userId:'p1',imageId:'root',note:'DESIGN TRANSLATION private source',designMetadata:{directionRevision:'submitted-r'}});
 put('ppssGeneratedImages_p/edit-1',{userId:'p1',imageId:'edit-1',note:'PHOTO-BASED URBAN DESIGN',designMetadata:{parentImageId:'root',editRequest:'간판의 개성은 유지해주세요'}});
 put('ppssGeneratedImages_p/final',{userId:'p1',imageId:'final',downloadUrl:'https://image.test/final',note:'RESIDENT DESIGN INPUT: private original',designMetadata:{parentImageId:'edit-1',directionRevision:'submitted-r',editRequest:'안내판을 더 작게 해주세요',modelSettings:{size:'1536x1024'}}});
 put('ppssEvaluationImages_p/p1',{userId:'p1',imageId:'final',note:'DESIGN TRANSLATION original unchanged',downloadUrl:'https://image.test/final'});
 const before=JSON.stringify([...store]);const result=await route({query:{projectId:'p',kind:'images'},token:'reader'});assert.equal(result.status,200);
 const image=result.body.images.find(row=>row.imageId==='final');assert.equal(image.note,undefined);
 assert.deepEqual(image.description.elements,elements.map(({text,origin})=>({text,origin})));
 assert.deepEqual(image.description.editRequests,['간판의 개성은 유지해주세요','안내판을 더 작게 해주세요']);assert.equal(image.description.aspectRatio,1.5);
 assert.doesNotMatch(JSON.stringify(result.body),/DESIGN TRANSLATION|PHOTO-BASED|private original|내부 근거|제출 이후 다른 설계/);assert.equal(JSON.stringify([...store]),before);
});
test('legacy evaluation prompt sections are parsed conservatively; missing or failed descriptions never expose prompt prose',async t=>{
 const {db,store,put}=fixture(t);const original='DESIGN TRANSLATION\nConfirmed resident-reviewed direction: '+JSON.stringify([{text:'보행통로 색의 연속성 확보',origin:'ai',basis:'internal'}])+'\nLatest request: visualize';
 put('ppssEvaluationImages_p/p1',{userId:'p1',imageId:'missing-canonical',note:original});
 put('ppssEvaluationImages_p/p2',{userId:'p2',imageId:'plain',note:'Full internal instructions without reliable structured design data'});
 const result=await route({query:{projectId:'p',kind:'images'}});assert.equal(result.status,200);
 assert.equal(result.body.images[0].description.elements[0].text,'보행통로 색의 연속성 확보');assert.equal(result.body.images[1].description.status,'missing');assert.ok(result.body.images.every(image=>image.note===undefined));
 const doc=db.doc;db.doc=path=>path.startsWith('ppssGeneratedImages_p/')?{get:async()=>{throw Error('fixture read error')}}:doc(path);
 const failed=await route({query:{projectId:'p',kind:'images'}});assert.equal(failed.status,200);assert.ok(failed.body.images.every(image=>image.description.status==='error'));
 assert.equal(store.get('ppssEvaluationImages_p/p1').note,original);
});
test('description traversal cannot read another participant direction through a forged parent link',async t=>{
 const {put}=fixture(t);
 put('ppssEvaluationImages_p/p1',{userId:'p1',imageId:'a'});
 put('ppssGeneratedImages_p/a',{userId:'p1',imageId:'a',designMetadata:{parentImageId:'foreign',editRequest:'작은 안내판 요청'}});
 put('ppssGeneratedImages_p/foreign',{userId:'p2',imageId:'foreign',note:'Confirmed resident-reviewed direction: [{"text":"다른 주민의 비공개 방향","origin":"participant"}]'});
 const result=await route({query:{projectId:'p',kind:'images'},token:'reader'});
 assert.doesNotMatch(JSON.stringify(result.body),/비공개 방향/);assert.equal(result.body.images[0].description.historyIncomplete,true);
});

test('Stage 5 synthesis prioritizes participant spatial themes, preserves source differences, and saves a new emphasized summary only',async t=>{
 const {db,store,put}=fixture(t),firebase=require(`${build}/lib/firebase.js`),executive=require(`${build}/pages/api/admin/executive-summary.js`).default;
 put('ppssWorkspaceSummaries_p/p1',{completedStages:['problem','data','alternatives','evaluation'],stageSummaries:{problem:'시장 앞 골목에서 차를 피해 걷는 게 불편하다.',data:'그늘이 있는 보행길을 원한다.',alternatives:'보행 가장자리 그늘과 진입 안내를 제안했다.',evaluation:'보행공간이 이어지는 안을 1순위로 선택했다.',report:'확인함. ㅇ'}});
 put('ppssWorkspaceSummaries_p/p2',{completedStages:['problem','data','alternatives','evaluation'],stageSummaries:{problem:'상점 앞 주차와 배달 접근이 필요하다.',data:'그늘도 필요하지만 주차 축소는 원하지 않는다.',alternatives:'주차 구획을 정리하고 조명은 집 안에 비치지 않게 조정하자.',evaluation:'차량 접근을 유지하는 안을 선호했다.'}});
 put('ppssExecutiveSummaries_p/old',{stageId:'report',stageSummaries:{decision:'기존 종합 요약 원문'},createdAt:'2026-01-01'});
 const before=JSON.stringify([...store]);const originalCollection=db.collection;
 const added=[];db.collection=path=>({...originalCollection(path),add:async data=>{added.push({path,data});return {id:'new-report'}}});
 mock(t,admin,'verifyAdminRequest',async()=>({uid:'owner-uid',email:'owner@example.com'}));
 mock(t,firebase,'loadBackgroundKnowledge',async()=>({curatedText:'2018년 초안 문서. 현장 실측 및 소유권 검토 안내.'}));
 const key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture';t.after(()=>key===undefined?delete process.env.OPENAI_API_KEY:process.env.OPENAI_API_KEY=key);
 const conclusion='참여자들은 **보행 안전**과 **일상적인 접근성**을 중요한 요구로 제시했다.\n\n공간개선 아이디어로 **그늘이 이어지는 보행길**과 **주차 구획 정리**가 논의되었다.\n\n다만 **보행공간 확보와 주차 유지**의 우선순위에는 차이가 있었으며, **야간 조명과 주거환경**을 함께 고려하는 의견도 있었다.\n\n이를 연결하면 **걷는 안전과 차량 접근을 함께 고려하는 골목 개선**을 지역의 계획 방향으로 살펴볼 수 있다.';
 let calls=0;
 mock(t,global,'fetch',async(url,options)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');const request=JSON.parse(options.body);assert.equal(request.model,'gpt-6.1-sol');
  const system=request.input[0].content,user=request.input[1].content;
  assert.match(system,/Stage 5 participant-centered synthesis/);assert.match(system,/Apply these accuracy rules silently/);
  assert.match(system,/4–5 paragraphs/);assert.match(system,/2–4 short, meaningful phrases/);assert.match(system,/last paragraph must emphasize/);
  assert.match(system,/A concrete, important minority need/);assert.match(system,/rankings into positive judgments or consensus/);
  assert.match(system,/Do not routinely discuss silence/);assert.match(system,/Each stageSummary entry groups ONE participant/);
  assert.match(user,/up to 5 grounded Korean keywords/);
  const input=JSON.parse(user.split('Input JSON: ')[1].split('\n\nReturn JSON')[0]);assert.equal(input.participants,2);assert.equal(input.stageSummary.length,2);
  assert.match(input.stageSummary[0],/시장 앞 골목/);assert.match(input.stageSummary[0],/확인함\. ㅇ/);assert.match(input.stageSummary[1],/집 안에 비치지/);
  assert.doesNotMatch(user,/summary-admin|summary-system|summary-owner|legacy admin/);
  return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({keywords:['보행 안전','주차 접근성','그늘','주거환경'],conclusion})}]}]});
 });
 const result={};await executive({method:'POST',headers:{authorization:'Bearer manager'},body:{projectId:'p',stageId:'report'}},{status(code){result.status=code;return this},json(body){result.body=body}});
 assert.equal(result.status,200);assert.equal(calls,1);assert.equal(result.body.stageSummaries.decision,conclusion);assert.equal(result.body.keywords.length,4);
 assert.equal(added.length,1);assert.equal(added[0].path,'ppssExecutiveSummaries_p');assert.equal(added[0].data.stageId,'report');
 for(const stage of ['problemDefinition','dataAnalysis','designAlternatives','designEvaluation'])assert.equal(result.body.stageSummaries[stage],'');
 assert.equal(JSON.stringify([...store]),before,'all source records and existing summaries remain unchanged');
});
test('Stage 1–4 executive-summary prompts retain their existing rules without Stage 5 style changes',async t=>{
 const {db,store}=fixture(t),firebase=require(`${build}/lib/firebase.js`),executive=require(`${build}/pages/api/admin/executive-summary.js`).default;
 const {evidenceAttributionRules}=require(`${build}/lib/facilitation.js`);const before=JSON.stringify([...store]);
 mock(t,admin,'verifyAdminRequest',async()=>({uid:'owner-uid',email:'owner@example.com'}));mock(t,firebase,'loadBackgroundKnowledge',async()=>null);
 const key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture';t.after(()=>key===undefined?delete process.env.OPENAI_API_KEY:process.env.OPENAI_API_KEY=key);
 let calls=0;mock(t,global,'fetch',async(_url,options)=>{calls++;const request=JSON.parse(options.body);assert.ok(request.input[0].content.endsWith(evidenceAttributionRules));assert.doesNotMatch(request.input[0].content,/Stage 5 participant-centered|4–5 paragraphs|2–4 short, meaningful/);assert.match(request.input[1].content,/Return exactly 5 keywords/);return Response.json({error:{message:'synthetic stop before saving'}},{status:503})});
 for(const stage of ['problem','data','alternatives','evaluation']){const result={};await executive({method:'POST',headers:{authorization:'Bearer manager'},body:{projectId:'p',stageId:stage}},{status(code){result.status=code;return this},json(body){result.body=body}});assert.equal(result.status,500)}
 assert.equal(calls,4);assert.equal(JSON.stringify([...store]),before);
});
