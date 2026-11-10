import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),load=p=>require(`${process.env.PSS_TEST_BUILD}/${p}`);
const server=load('lib/stage-topics-server.js'),llm=load('lib/llm/index.js'),admin=load('lib/firebaseAdmin.js');
const {previousStage,topicContext}=load('lib/stage-topics.js');
const mock=(t,obj,key,value)=>{const old=obj[key];obj[key]=value;t.after(()=>obj[key]=old)};
const rawTopic=(quote='대성주유소 옆 골목에 차가 들어와 불편해요.')=>({title:'주유소 주변 골목길',summary:'골목으로 들어오는 차 때문에 불편하다고 말씀하셨어요.',places:['대성주유소'],openQuestion:'차가 들어오는 길과 걷는 길은 어떻게 연결될까요?',references:[{sourceIndex:0,quote}]});
function fixture(t,tag,{logs,summary}={}){
 const uid=`user-${tag}`,pid=`project-${tag}`,writes=[],docs=new Map();
 const stageLogs=logs??[{id:'original-message-id',sessionId:'original-session',sender:'user',text:'대성주유소 옆 골목에 차가 들어와 불편해요.',createdAt:'2026-01-01T00:00:00Z'},{sender:'assistant',text:'주민 캠페인은 어떨까요?'},{sender:'user',text:'캠페인보다 걸을 공간을 확보하고 싶어요.'}];
 docs.set(`users_${pid}/${uid}/steps/problem`,{logs:stageLogs,completed:true,untouched:'original'});
 docs.set(`users_${pid}/${uid}`,{confirmedStageSummaries:{problem:{text:summary??'기존 확인 요약 원문',confirmedAt:'2026-01-01'}},completedStages:['problem']});
 docs.set(`ppssWorkspaceSummaries_${pid}/${uid}`,{stageSummaries:{problem:summary??'기존 공유 요약 원문'},completedStages:['problem'],overallSummary:'기존 종합 요약'});
 const original=structuredClone([...docs]);
 mock(t,admin,'adminDb',()=>({doc:path=>({get:async()=>({exists:docs.has(path),data:()=>structuredClone(docs.get(path))}),create:async data=>{assert.ok(path.startsWith('ppssDerivedStageTopics/'),'source documents must never be written');writes.push(path);assert.ok(!docs.has(path));docs.set(path,structuredClone(data))},set(){assert.fail('no set/update/delete of source documents')},update(){assert.fail('no source update')},delete(){assert.fail('no source delete')}})}));
 return {uid,pid,docs,writes,assertPreserved(){assert.deepEqual([...docs].filter(([path])=>!path.startsWith('ppssDerivedStageTopics/')),original)}};
}
function gate(t,enabled){for(const key of ['PPSS_TOPIC_DERIVED_WRITES_ENABLED','PPSS_RESEARCH_BACKUP_VERIFIED_AT','PPSS_RESEARCH_RESTORE_VERIFIED_AT','PPSS_TOPIC_RULES_VERIFIED_AT']){const old=process.env[key];t.after(()=>old===undefined?delete process.env[key]:process.env[key]=old);delete process.env[key]}if(enabled){process.env.PPSS_TOPIC_DERIVED_WRITES_ENABLED='true';process.env.PPSS_RESEARCH_BACKUP_VERIFIED_AT='2026-01-01';process.env.PPSS_RESEARCH_RESTORE_VERIFIED_AT='2026-01-02';process.env.PPSS_TOPIC_RULES_VERIFIED_AT='2026-01-02'}}

test('existing workshop dialogue, IDs, summaries and completion state are read-only; repeated lazy reads share one extraction',async t=>{
 gate(t,false);const f=fixture(t,'read-only');let calls=0;
 mock(t,llm,'callLLM',async req=>{calls++;assert.match(req.systemText,/never attribute assistant proposals/);return JSON.stringify({topics:[rawTopic()]})});
 const all=await Promise.all(Array.from({length:4},()=>server.readStageTopics(f.pid,f.uid,'problem')));
 assert.equal(calls,1);assert.equal(f.writes.length,0);f.assertPreserved();
 assert.equal(all[0][0].sourceKind,'dialogue');assert.equal(all[0][0].sourceStage,'problem');assert.equal(all[0][0].references[0].messageId,'original-message-id');assert.equal(all[0][0].references[0].sessionId,'original-session');assert.equal(all[0][0].references[0].createdAt,'2026-01-01T00:00:00Z');
});

test('derived persistence requires explicit backup AND restore verification and writes only a separate immutable document',async t=>{
 assert.equal(server.topicWritesEnabled({}),false);assert.equal(server.topicWritesEnabled({PPSS_TOPIC_DERIVED_WRITES_ENABLED:'true',PPSS_RESEARCH_BACKUP_VERIFIED_AT:'2026-01-01'}),false);
 assert.equal(server.topicWritesEnabled({PPSS_TOPIC_DERIVED_WRITES_ENABLED:'true',PPSS_RESEARCH_BACKUP_VERIFIED_AT:'garbage',PPSS_RESEARCH_RESTORE_VERIFIED_AT:'2026-01-01'}),false);
 gate(t,true);const f=fixture(t,'derived');let calls=0;mock(t,llm,'callLLM',async()=>{calls++;return JSON.stringify({topics:[rawTopic()]})});
 const first=await server.readStageTopics(f.pid,f.uid,'problem');assert.equal(f.writes.length,1);f.assertPreserved();
 delete require.cache[require.resolve(`${process.env.PSS_TEST_BUILD}/lib/stage-topics-server.js`)];
 const fresh=load('lib/stage-topics-server.js');assert.deepEqual(await fresh.readStageTopics(f.pid,f.uid,'problem'),first);assert.equal(calls,1);assert.equal(f.writes.length,1);f.assertPreserved();
});

test('already completed accounts fall back to the existing summary without rerunning or overwriting completion',async t=>{
 gate(t,false);const quote='이전 요약에는 골목 보행환경을 살펴봤다고 기록되어 있다.';const f=fixture(t,'summary',{logs:[],summary:quote});
 mock(t,llm,'callLLM',async req=>{assert.equal(JSON.parse(req.userText).sourceKind,'summary');return JSON.stringify({topics:[{...rawTopic(quote),title:'골목 보행환경',summary:'기존 요약에 골목 보행환경 논의가 기록되어 있어요.',places:[]}]})});
 const topics=await server.readStageTopics(f.pid,f.uid,'problem');assert.equal(topics[0].sourceKind,'summary');assert.match(topicContext(topics[0],'data'),/do not pretend the original resident utterance/);f.assertPreserved();assert.equal(f.writes.length,0);
});

test('missing source data returns an empty list and does not create topics or call AI',async t=>{
 gate(t,false);const f=fixture(t,'empty',{logs:[],summary:''});mock(t,llm,'callLLM',()=>assert.fail('no invented topics'));
 assert.deepEqual(await server.readStageTopics(f.pid,f.uid,'problem'),[]);assert.equal(f.writes.length,0);f.assertPreserved();
});

test('assistant-only citations, invented places and duplicate titles are rejected',()=>{
 const source=[{sourceIndex:0,role:'user',content:'대성주유소 옆 골목에 차가 들어와 불편해요.'},{sourceIndex:1,role:'assistant',content:'공원 조성은 어떨까요?'}];
 assert.throws(()=>server.validateTopics([{...rawTopic(),references:[{sourceIndex:1,quote:'공원 조성'}]}],source,'problem','hash','dialogue'),/주민 발언/);
 assert.throws(()=>server.validateTopics([{...rawTopic(),places:['언급하지 않은 공원']}],source,'problem','hash','dialogue'),/언급되지 않은 장소/);
 assert.throws(()=>server.validateTopics([rawTopic(),rawTopic()],source,'problem','hash','dialogue'),/출처/);
});

test('all four transitions read only the authenticated participant topics without invoking AI',async t=>{
 const context=load('lib/project-context-server.js'),api=load('pages/api/stage-topics.js').default;
 mock(t,context,'loadProjectContext',async(req,stage)=>({projectId:'own-project',user:{uid:'own-user'},currentMaterial:'현재 단계 자료',previousSummaries:{},stageHistory:[]}));
 mock(t,admin,'adminDb',()=>assert.fail('no unmocked database access'));
 mock(t,load('lib/stage-topics-server.js'),'readStoredStageTopics',async(pid,uid,stage)=>{assert.equal(pid,'own-project');assert.equal(uid,'own-user');return [{...rawTopic(),id:'topic',sourceKind:'dialogue',sourceStage:stage,sourceHash:'hash'}]});
 mock(t,llm,'callLLM',async req=>{assert.match(req.systemText,/UI topic selection, not a resident utterance/);assert.match(req.systemText,/not agreement/);assert.match(req.systemText,/This text endpoint has not executed tools/);return '앞서 말씀하신 골목길 이야기를 이어가 볼 수 있어요.'});
 for(const [from,to]of [['problem','data'],['data','alternatives'],['alternatives','evaluation'],['evaluation','report']]){
  assert.equal(previousStage(to),from);const res={setHeader(){},status(n){this.code=n;return this},json(v){this.body=v}};
  await api({method:'POST',headers:{},body:{currentStage:to,action:'read',topicId:'topic',uid:'someone-else'}},res);assert.equal(res.code,200);assert.equal(res.body.topics[0].sourceStage,from);assert.equal(res.body.reply,undefined);
 }
});

test('normal chat context resolves the topic server-side from the same project/user and rejects foreign IDs',async t=>{
 const context=load('lib/project-context-server.js'),topicServer=load('lib/stage-topics-server.js');
 mock(t,admin,'verifyUserRequest',async()=>({uid:'context-owner',email:'resident@example.test'}));
 mock(t,admin,'adminDb',()=>({doc:path=>({get:async()=>({exists:true,data:()=>path==='ppssProjects/context-project'?{projectName:'본인 사업',projectAdmin:'admin@example.test',workspaceContent:{data:{text:'현재 자료',cases:[]}}}:path==='users/context-owner/projectMemberships/context-project'?{role:'participant'}:{}})})}));
 mock(t,topicServer,'resolveStoredTopic',async(pid,uid,stage,id)=>{assert.equal(pid,'context-project');assert.equal(uid,'context-owner');assert.equal(stage,'problem');return id==='owned-topic'?{...rawTopic(),id:'owned-topic',sourceKind:'dialogue',sourceStage:'problem',sourceHash:'owned'}:undefined});
 const req={headers:{authorization:'Bearer mock-token'},body:{projectId:'context-project',continuityTopicId:'owned-topic'}};
 const result=await context.loadProjectContext(req,'data');assert.match(result.continuityContext,/대성주유소/);assert.match(result.continuityContext,/not a new participant statement/);assert.doesNotMatch(result.currentMaterial,/대성주유소/);
 await assert.rejects(()=>context.loadProjectContext({...req,body:{...req.body,continuityTopicId:'other-user-topic'}},'data'),/다시 확인/);
});

test('failed topic validation never persists a partial result or changes sources, and retry can recover',async t=>{
 gate(t,true);const f=fixture(t,'failed-extraction');let attempts=0;
 mock(t,llm,'callLLM',async()=>{attempts++;return JSON.stringify({topics:[attempts===1?{...rawTopic(),references:[{sourceIndex:1,quote:'주민 캠페인'}]}:rawTopic()]})});
 await assert.rejects(()=>server.readStageTopics(f.pid,f.uid,'problem'),/불러오지 못/);assert.equal(f.writes.length,0);f.assertPreserved();
 assert.equal((await server.readStageTopics(f.pid,f.uid,'problem')).length,1);assert.equal(attempts,2);assert.equal(f.writes.length,1);f.assertPreserved();
});

test('legacy logsByStep and fenced JSON produce personalized topics without writing original records',async t=>{
 gate(t,false);const f=fixture(t,'legacy-read',{logs:[]});f.docs.set(`ppssChatLogs_${f.pid}/${f.uid}`,{logsByStep:{problem:[{sender:'Planner',text:'대성주유소 옆 골목에 차가 들어와 불편해요.',id:'legacy-message'}]}});
 const before=structuredClone([...f.docs]);mock(t,llm,'callLLM',async()=> '```json\n'+JSON.stringify({topics:[rawTopic()]})+'\n```');
 const topics=await server.readStageTopics(f.pid,f.uid,'problem');assert.equal(topics[0].references[0].messageId,'legacy-message');assert.deepEqual([...f.docs],before);assert.equal(f.writes.length,0);
});
test('blank confirmed summary cannot hide a populated workspace summary',async t=>{
 gate(t,false);const f=fixture(t,'blank-confirmed',{logs:[],summary:'대성주유소 옆 골목에 차가 들어와 불편해요.'});f.docs.get(`users_${f.pid}/${f.uid}`).confirmedStageSummaries.problem.text='  ';
 mock(t,llm,'callLLM',async()=>JSON.stringify({topics:[rawTopic()]}));const result=await server.readStageTopics(f.pid,f.uid,'problem');assert.equal(result.length,1);assert.equal(result[0].sourceKind,'summary');assert.equal(f.writes.length,0);
});
test('source data with an empty extraction is an error rather than no prior data',async t=>{
 gate(t,false);const f=fixture(t,'empty-extraction');mock(t,llm,'callLLM',async()=>JSON.stringify({topics:[]}));await assert.rejects(()=>server.readStageTopics(f.pid,f.uid,'problem'),/불러오지 못/);f.assertPreserved();
});

test('denied derived-store access still permits read-only extraction from authorized original records',async t=>{
 gate(t,true);const f=fixture(t,'derived-denied'),db=admin.adminDb();
 mock(t,admin,'adminDb',()=>({doc:path=>path.startsWith('ppssDerivedStageTopics/')?{get:async()=>{throw Object.assign(Error('permission denied'),{code:7})},create(){assert.fail('never attempt writes after derived read denial')}}:db.doc(path)}));
 mock(t,llm,'callLLM',async()=>JSON.stringify({topics:[rawTopic()]}));
 assert.equal((await server.readStageTopics(f.pid,f.uid,'problem')).length,1);assert.equal(f.writes.length,0);f.assertPreserved();
});
