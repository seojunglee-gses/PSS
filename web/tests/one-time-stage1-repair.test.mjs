import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),load=p=>require(`${process.env.PSS_TEST_BUILD}/${p}`),server=load('lib/stage-topics-server.js'),admin=load('lib/firebaseAdmin.js'),llm=load('lib/llm/index.js'),context=load('lib/project-context-server.js');
const api=load('pages/api/stage-topics.js').default;
const fixture=JSON.parse(readFileSync(new URL('./fixtures/topic-dialogue-17.json',import.meta.url),'utf8'));
const mock=(t,o,k,v)=>{const old=o[k];o[k]=v;t.after(()=>o[k]=old)};
const oldDate=new Date(server.LEGACY_STAGE1_COMPLETED_BEFORE-86400000).toISOString(),futureDate=new Date(server.LEGACY_STAGE1_COMPLETED_BEFORE+86400000).toISOString();
function setup(t,tag,{proof='confirmed',completed=true,sourceChanged=false,legacy=false,denied=false}={}){
 for(const key of ['PPSS_TOPIC_DERIVED_WRITES_ENABLED','PPSS_RESEARCH_BACKUP_VERIFIED_AT','PPSS_RESEARCH_RESTORE_VERIFIED_AT','PPSS_TOPIC_RULES_VERIFIED_AT']){const old=process.env[key];delete process.env[key];t.after(()=>old===undefined?delete process.env[key]:process.env[key]=old)}
 const pid='oneoff-'+tag,uid='resident',docs=new Map(),writes=[];
 if(legacy)docs.set(`ppssChatLogs_${pid}/${uid}`,{logsByStep:{problem:structuredClone(fixture.logs)},updatedAt:oldDate});
 else docs.set(`users_${pid}/${uid}/steps/problem`,{logs:structuredClone(fixture.logs),...(proof==='unknown'?{}:{updatedAt:sourceChanged?futureDate:oldDate})});
 const completionDate=proof==='after'?futureDate:oldDate;
 docs.set(`users_${pid}/${uid}`,proof==='confirmed'||proof==='after'?{confirmedStageSummaries:{problem:{text:'보존할 검토 요약',confirmedAt:completionDate}}}:{preserved:true});
 docs.set(`ppssWorkspaceSummaries_${pid}/${uid}`,{stageSummaries:{problem:'보존할 단계 요약'},completedStages:completed&&proof!=='locks'?['problem']:[],...(proof==='workspace'||proof==='after'?{updatedAt:completionDate}:{})});
 if(proof==='locks')docs.set(`ppssStageLocks_${pid}/${uid}`,{lockedStages:{problem:completed},updatedAt:oldDate});
 const original=JSON.stringify([...docs]);
 const ref=path=>({path,get:async()=>{if(denied&&path.startsWith('ppssDerivedStageTopics/'))throw{code:7};return{exists:docs.has(path),data:()=>structuredClone(docs.get(path))}},create:async data=>{assert.ok(path.startsWith('ppssDerivedStageTopics/'));if(docs.has(path))throw{code:6};writes.push(path);docs.set(path,structuredClone(data))}});
 let serial=Promise.resolve();const db={doc:ref,runTransaction(fn){const work=serial.then(()=>fn({get:r=>r.get(),set(r,v){assert.ok(r.path.startsWith('ppssDerivedStageTopics/'));writes.push(r.path);docs.set(r.path,structuredClone(v))},update(r,v){assert.ok(r.path.startsWith('ppssDerivedStageTopics/'));writes.push(r.path);docs.set(r.path,{...docs.get(r.path),...structuredClone(v)})}}));serial=work.catch(()=>{});return work}};
 mock(t,admin,'adminDb',()=>db);mock(t,context,'loadProjectContext',async()=>({projectId:pid,user:{uid}}));
 return{pid,uid,docs,writes,preserved(){assert.equal(JSON.stringify([...docs].filter(([path])=>!path.startsWith('ppssDerivedStageTopics/'))),original)}};
}
function result(req){const input=JSON.parse(req.userText);assert.equal(input.dialogue.filter(turn=>turn.role==='user').length,17);return JSON.stringify({topics:[['녹지 관리와 책임 분담','화분을 꾸준히 관리하면서 주민과 상인의 부담을 나누고 싶다고 말씀하셨어요.',[2,3,4,5,6,7,8]],['골목길 보행 안전','차가 걷는 길을 막거나 빠르게 지나가 불안해서 보행공간이 먼저 필요하다고 말씀하셨어요.',[9,10,11]],['주차 공간 유지 우려','주차를 모두 없애는 것은 걱정되며 가게 이용객이 차를 세울 곳도 필요하다고 말씀하셨어요.',[12,13]],['쓰레기 배출 자리 구분','쓰레기가 걷는 길을 막지 않도록 배출하는 자리를 구분하고 싶다고 말씀하셨어요.',[14,15,16]]].map(([title,summary,ids])=>({title,summary,places:[],openQuestion:'',references:ids.map(id=>{const turn=input.dialogue.find(turn=>turn.messageId===`synthetic-user-${id}`);return{sourceIndex:turn.sourceIndex,quote:turn.content}})}))})}
async function invoke(body={}){const res={setHeader(){},status(n){this.code=n;return this},json(v){this.body=v}};await api({method:'POST',body:{currentStage:'data',uid:'other-user',...body}},res);return res}
const fresh=()=>{delete require.cache[require.resolve(`${process.env.PSS_TEST_BUILD}/lib/stage-topics-server.js`)];return load('lib/stage-topics-server.js')};
test('the authorized existing Stage 1 cohort repairs automatically once with all global write gates unset',async t=>{
 const f=setup(t,'automatic');let calls=0;mock(t,llm,'callLLM',async req=>{calls++;return result(req)});assert.equal(server.topicWritesEnabled(),false);
 let res=await invoke();assert.equal(res.code,200);assert.equal(res.body.status,'ready');assert.equal(res.body.topics.length,4);assert.equal(calls,1);assert.ok(res.body.topics.every(topic=>topic.references.length>1));
 const stored=[...f.docs].filter(([path])=>path.startsWith('ppssDerivedStageTopics/'));assert.ok(stored.every(([,data])=>data.oneTimeBackfill===server.LEGACY_STAGE1_REPAIR));
 const before=f.writes.length;for(let i=0;i<5;i++)assert.equal((await invoke()).body.status,'ready');assert.equal(calls,1);assert.equal(f.writes.length,before);assert.equal(server.topicWritesEnabled(),false);f.preserved();
});
test('separate instances and simultaneous legacy visits share one durable preparation lease',async t=>{
 const f=setup(t,'parallel'),other=fresh();let calls=0;mock(t,llm,'callLLM',async req=>{calls++;await new Promise(resolve=>setTimeout(resolve,20));return result(req)});
 const states=await Promise.all(Array.from({length:12},async(_,i)=>{const service=i%2?other:server;return service.readWithLegacyStage1Repair(f.pid,f.uid,await service.readStoredStageTopicState(f.pid,f.uid,'problem'))}));assert.equal(calls,1);assert.ok(states.every(state=>['ready','processing'].includes(state.status)));assert.equal((await other.readStoredStageTopicState(f.pid,f.uid,'problem')).topics.length,4);f.preserved();
});
test('workspace and lock completion records support old accounts and legacy conversation storage without re-completion',async t=>{
 for(const proof of ['workspace','locks']){const f=setup(t,'old-'+proof,{proof,legacy:true});mock(t,llm,'callLLM',async req=>result(req));assert.equal((await invoke()).body.status,'ready');f.preserved()}
});
test('new completions, incomplete accounts, changed source dialogue and unproven completion dates are excluded',async t=>{
 for(const options of [{proof:'after'},{completed:false},{sourceChanged:true},{proof:'unknown'}]){const f=setup(t,'excluded-'+JSON.stringify(options),options);mock(t,llm,'callLLM',()=>assert.fail('the exception must not become a permanent bypass'));const res=await invoke({force:true,oneTimeAuthorization:server.LEGACY_STAGE1_REPAIR});assert.equal(res.body.status,'blocked');assert.equal(f.writes.length,0);assert.equal((await invoke({currentStage:'problem',action:'extract',force:true})).code,503);f.preserved()}
});
test('other stages keep the ordinary zero-model read policy and cannot use a client-supplied exception flag',async t=>{
 const f=setup(t,'other-stage');mock(t,llm,'callLLM',()=>assert.fail('only the problem-to-data repair is authorized'));const res=await invoke({currentStage:'alternatives',oneTimeAuthorization:server.LEGACY_STAGE1_REPAIR});assert.equal(res.body.status,'empty');assert.equal((await invoke({currentStage:'data',action:'extract',force:true})).code,503);assert.equal(f.writes.length,0);f.preserved();
});
test('a failed one-off repair does not re-run AI on every visit; explicit retry remains bounded',async t=>{
 const f=setup(t,'failed');let calls=0,fail=true;mock(t,llm,'callLLM',async req=>{calls++;if(fail)throw Error('private provider text');return result(req)});
 let res=await invoke();assert.equal(res.body.status,'failed');assert.equal(res.body.oneTimeBackfill,true);assert.equal(calls,1);
 for(let i=0;i<4;i++)assert.equal((await invoke()).body.status,'failed');assert.equal(calls,1);assert.ok(!JSON.stringify(res.body).includes('private provider text'));
 const pointer=[...f.docs].find(([path])=>path.includes('prepared-v2-'))[1];pointer.retryAfter=Date.now()-1;assert.equal((await invoke()).body.status,'failed');assert.equal(calls,1);
 fail=false;res=await invoke({currentStage:'problem',action:'extract'});assert.equal(res.body.status,'ready');assert.equal(calls,2);assert.equal((await invoke()).body.topics.length,4);assert.equal(calls,2);f.preserved();
});
test('the one-off authorization never bypasses actual derived-store access denial or exposes administrator instructions',async t=>{
 const f=setup(t,'denied',{denied:true});mock(t,llm,'callLLM',()=>assert.fail('never generate unpersistable output'));const res=await invoke();assert.equal(res.body.status,'failed');assert.equal(res.body.reason,'save_failed');assert.equal(res.body.oneTimeBackfill,true);assert.equal(f.writes.length,0);f.preserved();
});
test('the cohort cutoff stays fixed and successful repairs remain reusable by a fresh process',async t=>{
 const f=setup(t,'fresh');let calls=0;mock(t,llm,'callLLM',async req=>{calls++;return result(req)});assert.equal(server.LEGACY_STAGE1_COMPLETED_BEFORE,Date.parse('2026-11-10T21:51:36.000Z'));await invoke();const service=fresh(),state=await service.readStoredStageTopicState(f.pid,f.uid,'problem');assert.equal((await service.readWithLegacyStage1Repair(f.pid,f.uid,state)).status,'ready');assert.equal(calls,1);f.preserved();
});
test('a model speech-card output cannot be saved as a successful one-off semantic repair',async t=>{
 const f=setup(t,'bad-output');let calls=0;mock(t,llm,'callLLM',async req=>{calls++;const value=JSON.parse(result(req));value.topics[0].title='이전 단계 발언 1';return JSON.stringify(value)});const res=await invoke();assert.equal(res.body.status,'failed');assert.equal(res.body.oneTimeBackfill,true);assert.equal(res.body.topics.length,0);assert.equal((await invoke()).body.status,'failed');assert.equal(calls,1);f.preserved();
});
test('older completion schemas without a per-stage date use the original source snapshot, not an administrator step',async t=>{
 const f=setup(t,'old-schema',{proof:'old-schema'});mock(t,llm,'callLLM',async req=>result(req));const res=await invoke();assert.equal(res.body.status,'ready');f.preserved();
});
