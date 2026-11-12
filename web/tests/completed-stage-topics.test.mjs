import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),load=p=>require(`${process.env.PSS_TEST_BUILD}/${p}`),server=load('lib/stage-topics-server.js'),admin=load('lib/firebaseAdmin.js'),llm=load('lib/llm/index.js'),context=load('lib/project-context-server.js');
const api=load('pages/api/stage-topics.js').default;
const fixture=JSON.parse(readFileSync(new URL('./fixtures/topic-dialogue-17.json',import.meta.url),'utf8'));
const mock=(t,o,k,v)=>{const old=o[k];o[k]=v;t.after(()=>o[k]=old)};
const stages=['problem','data','alternatives','evaluation','report'];
function setup(t,tag,{stage='problem',completed=true,proof='workspace',legacy=false,denied=false,date='2030-01-01T00:00:00Z'}={}){
 for(const key of ['PPSS_TOPIC_DERIVED_WRITES_ENABLED','PPSS_RESEARCH_BACKUP_VERIFIED_AT','PPSS_RESEARCH_RESTORE_VERIFIED_AT','PPSS_TOPIC_RULES_VERIFIED_AT']){const old=process.env[key];delete process.env[key];t.after(()=>old===undefined?delete process.env[key]:process.env[key]=old)}
 const pid='normal-'+tag,uid='resident',docs=new Map(),writes=[],logs=fixture.logs.map(log=>({...log,stepId:stage}));
 const sourcePath=legacy?`ppssChatLogs_${pid}/${uid}`:`users_${pid}/${uid}/steps/${stage}`;
 docs.set(sourcePath,legacy?{logsByStep:{[stage]:logs},updatedAt:date}:{logs,updatedAt:date,...(proof==='step'?{completed}:{})});
 docs.set(`users_${pid}/${uid}`,{confirmedStageSummaries:{[stage]:{text:'보존할 검토 요약',confirmedAt:date}},...(proof==='personal'?{completedStages:completed?[stage]:[]}:{} )});
 docs.set(`ppssWorkspaceSummaries_${pid}/${uid}`,{stageSummaries:{[stage]:'보존할 단계 요약'},completedStages:completed&&proof==='workspace'?[stage]:[],updatedAt:date});
 if(proof==='locks')docs.set(`ppssStageLocks_${pid}/${uid}`,{lockedStages:{[stage]:completed},updatedAt:date});
 const sourceSnapshot=()=>JSON.stringify([...docs].filter(([path])=>!path.startsWith('ppssDerivedStageTopics/')));let original=sourceSnapshot();
 const ref=path=>({path,get:async()=>{if(denied&&path.startsWith('ppssDerivedStageTopics/'))throw{code:7};return{exists:docs.has(path),data:()=>structuredClone(docs.get(path))}},create:async data=>{assert.ok(path.startsWith('ppssDerivedStageTopics/'));if(docs.has(path))throw{code:6};writes.push(path);docs.set(path,structuredClone(data))}});
 let serial=Promise.resolve();const db={doc:ref,runTransaction(fn){const work=serial.then(()=>fn({get:r=>r.get(),set(r,v){assert.ok(r.path.startsWith('ppssDerivedStageTopics/'));writes.push(r.path);docs.set(r.path,structuredClone(v))},update(r,v){assert.ok(r.path.startsWith('ppssDerivedStageTopics/'));writes.push(r.path);docs.set(r.path,{...docs.get(r.path),...structuredClone(v)})}}));serial=work.catch(()=>{});return work}};
 mock(t,admin,'adminDb',()=>db);mock(t,context,'loadProjectContext',async()=>({projectId:pid,user:{uid}}));
 return{pid,uid,stage,sourcePath,docs,writes,checkpoint(){original=sourceSnapshot()},preserved(){assert.equal(sourceSnapshot(),original)}};
}
function result(req){const input=JSON.parse(req.userText);assert.equal(input.dialogue.filter(turn=>turn.role==='user').length,17);return JSON.stringify({topics:[['녹지 관리와 책임 분담','화분을 꾸준히 관리하면서 주민과 상인의 부담을 나누고 싶다고 말씀하셨어요.',[2,3,4,5,6,7,8]],['골목길 보행 안전','차가 걷는 길을 막거나 빠르게 지나가 불안해서 보행공간이 먼저 필요하다고 말씀하셨어요.',[9,10,11]],['주차 공간 유지 우려','주차를 모두 없애는 것은 걱정되며 가게 이용객이 차를 세울 곳도 필요하다고 말씀하셨어요.',[12,13]],['쓰레기 배출 자리 구분','쓰레기가 걷는 길을 막지 않도록 배출하는 자리를 구분하고 싶다고 말씀하셨어요.',[14,15,16]]].map(([title,summary,ids])=>({title,summary,places:[],openQuestion:'',references:ids.map(id=>{const turn=input.dialogue.find(turn=>turn.messageId.endsWith(`user-${id}`));return{sourceIndex:turn.sourceIndex,quote:turn.content}})}))})}
async function invoke(body={}){const res={setHeader(){},status(n){this.code=n;return this},json(v){this.body=v}};await api({method:'POST',body:{currentStage:'data',uid:'other-user',...body}},res);return res}
const fresh=()=>{delete require.cache[require.resolve(`${process.env.PSS_TEST_BUILD}/lib/stage-topics-server.js`)];return load('lib/stage-topics-server.js')};
test('new completions prepare normally by default, and next-stage entry only reads the saved result',async t=>{
 const f=setup(t,'new');let calls=0;mock(t,llm,'callLLM',async req=>{calls++;return result(req)});assert.equal(server.topicWritesEnabled(),true);
 let res=await invoke({currentStage:'problem',action:'extract'});assert.equal(res.code,200);assert.equal(res.body.status,'ready');assert.equal(calls,1);const writes=f.writes.length;
 for(let i=0;i<5;i++){res=await invoke();assert.equal(res.body.status,'ready');assert.equal(res.body.topics.length,4);assert.ok(res.body.topics.every(topic=>topic.references.length>1))}
 assert.equal(calls,1);assert.equal(f.writes.length,writes);assert.ok([...f.docs].filter(([p])=>p.startsWith('ppssDerivedStageTopics/')).every(([,data])=>data.oneTimeBackfill===undefined));f.preserved();
});
test('all four stage transitions work for new future-dated completions with no backup-confirmation environment variables',async t=>{
 for(const stage of stages.slice(0,-1)){const f=setup(t,'transition-'+stage,{stage});let calls=0;mock(t,llm,'callLLM',async req=>{calls++;assert.equal(JSON.parse(req.userText).sourceStage,stage);return result(req)});assert.equal((await invoke({currentStage:stage,action:'extract'})).body.status,'ready');const res=await invoke({currentStage:stages[stages.indexOf(stage)+1]});assert.equal(res.body.topics.length,4);assert.ok(res.body.topics.every(topic=>topic.sourceStage===stage));assert.equal(calls,1);f.preserved()}
});
test('missing summaries from any completed account recover without re-completion or a date cutoff',async t=>{
 for(const date of ['2026-01-01T00:00:00Z','2026-11-12T00:00:00Z','2030-01-01T00:00:00Z']){const f=setup(t,'missing-'+date,{date});let calls=0;mock(t,llm,'callLLM',async req=>{calls++;return result(req)});const res=await invoke();assert.equal(res.body.status,'ready');assert.equal(res.body.topics.length,4);assert.equal(calls,1);assert.equal((await invoke()).body.status,'ready');assert.equal(calls,1);f.preserved()}
});
test('incomplete stages do not call the model; committing completion then prepares and persists once',async t=>{
 const f=setup(t,'incomplete',{completed:false});let calls=0;mock(t,llm,'callLLM',async req=>{calls++;return result(req)});assert.equal((await invoke()).body.reason,'stage_not_completed');const rejected=await invoke({currentStage:'problem',action:'extract',force:true});assert.equal(rejected.code,409);assert.equal(rejected.body.status,'not_completed');assert.equal(calls,0);assert.equal(f.writes.length,0);f.preserved();
 f.docs.get(`ppssWorkspaceSummaries_${f.pid}/${f.uid}`).completedStages.push('problem');f.checkpoint();assert.equal((await invoke({currentStage:'problem',action:'extract'})).body.status,'ready');assert.equal((await invoke()).body.topics.length,4);assert.equal(calls,1);f.preserved();
});
test('simultaneous requests and separate server instances still share one durable preparation lease',async t=>{
 const f=setup(t,'parallel'),other=fresh();let calls=0;mock(t,llm,'callLLM',async req=>{calls++;await new Promise(resolve=>setTimeout(resolve,20));return result(req)});
 const states=await Promise.all(Array.from({length:12},async(_,i)=>{const service=i%2?other:server;return service.readWithCompletedStageRepair(f.pid,f.uid,'problem',await service.readStoredStageTopicState(f.pid,f.uid,'problem'))}));assert.equal(calls,1);assert.ok(states.every(state=>['ready','processing'].includes(state.status)));assert.equal((await other.readStoredStageTopicState(f.pid,f.uid,'problem')).topics.length,4);f.preserved();
});
test('legacy and current completion formats are read-only inputs to the same normal generation path',async t=>{
 for(const proof of ['workspace','personal','step','locks']){const f=setup(t,'format-'+proof,{proof,legacy:proof==='locks'});mock(t,llm,'callLLM',async req=>result(req));assert.equal((await invoke()).body.status,'ready');f.preserved()}
});
test('a failed preparation is not regenerated on every visit, and explicit retry retains the cooldown',async t=>{
 const f=setup(t,'failed');let calls=0,fail=true;mock(t,llm,'callLLM',async req=>{calls++;if(fail)throw Error('private provider text');return result(req)});let res=await invoke();assert.equal(res.body.status,'failed');for(let i=0;i<4;i++)assert.equal((await invoke()).body.status,'failed');assert.equal(calls,1);assert.ok(!JSON.stringify(res.body).includes('private provider text'));assert.equal((await invoke({currentStage:'problem',action:'extract'})).body.status,'cooldown');
 const pointer=[...f.docs].find(([path])=>path.includes('prepared-v2-'))[1];pointer.retryAfter=Date.now()-1;assert.equal((await invoke()).body.status,'failed');assert.equal(calls,1);fail=false;res=await invoke({currentStage:'problem',action:'extract'});assert.equal(res.body.status,'ready');assert.equal(calls,2);assert.equal((await invoke()).body.topics.length,4);assert.equal(calls,2);f.preserved();
});
test('actual storage access denial cannot be bypassed by a client flag and never invokes an unpersistable model call',async t=>{
 const f=setup(t,'denied',{denied:true});mock(t,llm,'callLLM',()=>assert.fail('no unpersistable output'));const res=await invoke({oneTimeAuthorization:'stage1-workshop-20261111'});assert.equal(res.body.status,'failed');assert.equal(res.body.reason,'save_failed');assert.equal(f.writes.length,0);f.preserved();
});
test('explicit operational disable remains respected while missing configuration no longer disables the feature',async t=>{
 const f=setup(t,'kill-switch');process.env.PPSS_TOPIC_DERIVED_WRITES_ENABLED='false';mock(t,llm,'callLLM',()=>assert.fail('honor explicit operator disable'));const res=await invoke();assert.equal(res.body.status,'blocked');assert.equal(res.body.reason,'preparation_disabled');assert.equal((await invoke({currentStage:'problem',action:'extract'})).code,503);assert.equal(f.writes.length,0);f.preserved();
});
test('existing successful one-off records remain readable unchanged after the normal pipeline takes over',async t=>{
 const f=setup(t,'old-marker');let calls=0;mock(t,llm,'callLLM',async req=>{calls++;return result(req)});await invoke();for(const [path,data]of f.docs)if(path.startsWith('ppssDerivedStageTopics/'))data.oneTimeBackfill='stage1-workshop-20261111';const before=JSON.stringify([...f.docs]);assert.equal((await fresh().readStoredStageTopics(f.pid,f.uid,'problem')).length,4);assert.equal((await invoke()).body.status,'ready');assert.equal(calls,1);assert.equal(JSON.stringify([...f.docs]),before);f.preserved();
});
test('different participants never share a cached preparation or each other\'s original references',async t=>{
 const f=setup(t,'isolated');const second='second-resident';f.docs.set(`users_${f.pid}/${second}/steps/problem`,{logs:fixture.logs.map(log=>({...log,id:'second-'+log.id}))});f.docs.set(`ppssWorkspaceSummaries_${f.pid}/${second}`,{completedStages:['problem']});f.checkpoint();let calls=0;mock(t,llm,'callLLM',async req=>{calls++;return result(req)});
 const [a,b]=await Promise.all([server.readWithCompletedStageRepair(f.pid,f.uid,'problem',await server.readStoredStageTopicState(f.pid,f.uid,'problem')),server.readWithCompletedStageRepair(f.pid,second,'problem',await server.readStoredStageTopicState(f.pid,second,'problem'))]);assert.equal(calls,2);assert.ok(a.topics.every(topic=>topic.references.every(ref=>!ref.messageId.startsWith('second-'))));assert.ok(b.topics.every(topic=>topic.references.every(ref=>ref.messageId.startsWith('second-'))));assert.equal(await server.resolveStoredTopic(f.pid,second,'problem',a.topics[0].id),undefined);f.preserved();
});
test('a model speech-card output is rejected rather than stored as a normal semantic summary',async t=>{
 const f=setup(t,'bad-output');let calls=0;mock(t,llm,'callLLM',async req=>{calls++;const value=JSON.parse(result(req));value.topics[0].title='이전 단계 발언 1';return JSON.stringify(value)});const res=await invoke();assert.equal(res.body.status,'failed');assert.equal(res.body.topics.length,0);assert.equal((await invoke()).body.status,'failed');assert.equal(calls,1);f.preserved();
});
