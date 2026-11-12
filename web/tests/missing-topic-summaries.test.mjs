import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),load=p=>require(`${process.env.PSS_TEST_BUILD}/${p}`),server=load('lib/stage-topics-server.js'),admin=load('lib/firebaseAdmin.js'),llm=load('lib/llm/index.js');
const fixture=JSON.parse(readFileSync(new URL('./fixtures/topic-dialogue-17.json',import.meta.url),'utf8'));
const {topicMessageIds,topicContext}=load('lib/stage-topics.js');
const mock=(t,o,k,v)=>{const old=o[k];o[k]=v;t.after(()=>o[k]=old)};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function setup(t,tag,{enabled=true,saveFails=false,pointerFails=false,denied=false}={}){
 for(const [key,value]of Object.entries({PPSS_TOPIC_DERIVED_WRITES_ENABLED:enabled?'true':'false',PPSS_RESEARCH_BACKUP_VERIFIED_AT:'2026-01-01',PPSS_RESEARCH_RESTORE_VERIFIED_AT:'2026-01-01',PPSS_TOPIC_RULES_VERIFIED_AT:'2026-01-01'})){const old=process.env[key];process.env[key]=value;t.after(()=>old===undefined?delete process.env[key]:process.env[key]=old)}
 const pid='missing-'+tag,uid='resident',sourcePath=`users_${pid}/${uid}/steps/problem`,legacyPath='ppssDerivedStageTopics/prepared-'+digest([pid,uid,'problem']),pointer='ppssDerivedStageTopics/prepared-v2-'+digest([pid,uid,'problem']);
 const docs=new Map([[sourcePath,{logs:structuredClone(fixture.logs),completed:true}],[`users_${pid}/${uid}`,{confirmedStageSummaries:{problem:{text:'보존할 기존 단계 요약',confirmedAt:'2026-11-10T22:00:00Z'}},completedStages:['problem']}],[`ppssWorkspaceSummaries_${pid}/${uid}`,{stageSummaries:{problem:'보존할 공유 요약'},completedStages:['problem']}]]),before=JSON.stringify([...docs]),writes=[];
 const ref=path=>({path,get:async()=>{if(denied&&path.startsWith('ppssDerivedStageTopics/'))throw{code:7};return{exists:docs.has(path),data:()=>structuredClone(docs.get(path))}},create:async data=>{assert.ok(path.startsWith('ppssDerivedStageTopics/'));if(saveFails)throw{code:14};if(docs.has(path))throw{code:6};writes.push(path);docs.set(path,structuredClone(data))}});
 let serial=Promise.resolve();const db={doc:ref,runTransaction(fn){const work=serial.then(()=>fn({get:r=>r.get(),set(r,v){assert.ok(r.path.startsWith('ppssDerivedStageTopics/'));writes.push(r.path);docs.set(r.path,structuredClone(v))},update(r,v){assert.ok(r.path.startsWith('ppssDerivedStageTopics/'));if(pointerFails&&v.status==='ready')throw{code:14};writes.push(r.path);docs.set(r.path,{...docs.get(r.path),...structuredClone(v)})}}));serial=work.catch(()=>{});return work}};
 mock(t,admin,'adminDb',()=>db);
 return{pid,uid,docs,pointer,legacyPath,writes,sourcePath,preserved(){assert.equal(JSON.stringify([...docs].filter(([p])=>!p.startsWith('ppssDerivedStageTopics/'))),before)}};
}
function resultFor(input){
 const spec=[['녹지 관리와 책임 분담','화분을 꾸준히 돌보되 몇 사람에게만 부담이 쏠리지 않도록 주민과 상인의 참여 방법도 함께 고민하고 싶다고 말씀하셨어요.',[2,3,4,5,6,7,8]],['골목길 보행 안전','주차된 차 때문에 차도로 나가 걷고 빠르게 지나는 차량이 불안해, 편하게 걸을 공간이 먼저 필요하다고 말씀하셨어요.',[9,10,11]],['주차 공간 유지 우려','가게를 이용할 때 차를 세울 곳도 필요해서 주차를 전부 없애는 것은 걱정된다고 말씀하셨어요.',[12,13]],['쓰레기 배출 공간 구분','쓰레기가 걷는 길을 막지 않도록 배출 자리를 구분하고 잘 보이게 했으면 좋겠다고 말씀하셨어요.',[14,15,16]]];
 return {topics:spec.map(([title,summary,ids])=>({title,summary,places:[],openQuestion:'',references:ids.map(id=>{const turn=input.dialogue.find(turn=>turn.messageId===`synthetic-user-${id}`);return{sourceIndex:turn.sourceIndex,quote:turn.content}})}))};
}
const fresh=()=>{delete require.cache[require.resolve(`${process.env.PSS_TEST_BUILD}/lib/stage-topics-server.js`)];return load('lib/stage-topics-server.js')};
test('17 resident turns become four meaningful stored themes, each with multiple original IDs, without re-completing',async t=>{
 const f=setup(t,'seventeen');let calls=0;mock(t,llm,'callLLM',async req=>{calls++;const input=JSON.parse(req.userText);assert.equal(input.dialogue.filter(turn=>turn.role==='user').length,17);assert.match(req.systemText,/Never make one card per message/);return JSON.stringify(resultFor(input))});
 const pending=await server.readStoredStageTopicState(f.pid,f.uid,'problem');assert.equal(pending.status,'missing');assert.equal(pending.needsPreparation,true);assert.equal(pending.canPrepare,true);assert.deepEqual(pending.topics,[]);assert.equal(calls,0);
 const other=fresh();await Promise.all(Array.from({length:12},(_,i)=>(i%2?other:server).prepareStageTopics(f.pid,f.uid,'problem')));assert.equal(calls,1);
 const ready=await other.readStoredStageTopicState(f.pid,f.uid,'problem');assert.equal(ready.status,'ready');assert.equal(ready.topics.length,4);
 for(const topic of ready.topics){assert.ok(topicMessageIds(topic).length>1);assert.ok(topic.references.every(ref=>fixture.logs.some(log=>log.sender==='user'&&log.id===ref.messageId&&log.text.includes(ref.quote))));assert.ok(!topicMessageIds(topic).includes('synthetic-user-1'));assert.ok(!topicMessageIds(topic).includes('synthetic-user-17'))}
 assert.equal((await fresh().readStoredStageTopics(f.pid,f.uid,'problem')).length,4);await server.prepareStageTopics(f.pid,f.uid,'problem');assert.equal(calls,1);f.preserved();
});
test('a stored immutable v2 result is recovered when its prepared pointer is missing, with no new LLM call',async t=>{
 const f=setup(t,'orphan');let calls=0;mock(t,llm,'callLLM',async req=>{calls++;return JSON.stringify(resultFor(JSON.parse(req.userText)))});await server.prepareStageTopics(f.pid,f.uid,'problem');const stored=await server.readStoredStageTopics(f.pid,f.uid,'problem');f.docs.delete(f.pointer);
 const read=await fresh().readStoredStageTopicState(f.pid,f.uid,'problem');assert.equal(read.status,'ready');assert.deepEqual(read.topics,stored);await server.prepareStageTopics(f.pid,f.uid,'problem');assert.equal(calls,1);f.preserved();
});
test('a failed pointer write cannot hide a successfully saved immutable summary',async t=>{
 const f=setup(t,'pointer',{pointerFails:true});mock(t,llm,'callLLM',async req=>JSON.stringify(resultFor(JSON.parse(req.userText))));await assert.rejects(()=>server.prepareStageTopics(f.pid,f.uid,'problem'),error=>error.reason==='save_failed');
 const state=await server.readStoredStageTopicState(f.pid,f.uid,'problem');assert.equal(state.status,'ready');assert.equal(state.topics.length,4);f.preserved();
});
test('generation failure is distinct from save failure; neither becomes raw topic cards or changes original data',async t=>{
 for(const saveFails of [false,true]){
  const f=setup(t,'fail-'+saveFails,{saveFails});mock(t,llm,'callLLM',async req=>{if(!saveFails)throw Error('private conversation and provider detail');return JSON.stringify(resultFor(JSON.parse(req.userText)))});
  await assert.rejects(()=>server.prepareStageTopics(f.pid,f.uid,'problem'),error=>error.reason===(saveFails?'save_failed':'generation_failed'));
  const state=await server.readStoredStageTopicState(f.pid,f.uid,'problem');assert.equal(state.status,'failed');assert.equal(state.reason,saveFails?'save_failed':'generation_failed');assert.deepEqual(state.topics,[]);assert.equal(await server.prepareStageTopics(f.pid,f.uid,'problem'),'cooldown');f.preserved();
 }
});
test('unverified safety and denied derived access are explicit blocked states, not successful summary creation',async t=>{
 for(const options of [{enabled:false},{denied:true}]){const f=setup(t,'blocked-'+JSON.stringify(options),options);mock(t,llm,'callLLM',()=>assert.fail('no generation when safe persistence unavailable'));const state=await server.readStoredStageTopicState(f.pid,f.uid,'problem');assert.equal(state.status,'blocked');assert.equal(state.reason,options.denied?'derived_access_denied':'preparation_disabled');assert.equal(state.needsPreparation,true);assert.deepEqual(state.topics,[]);assert.equal(await server.prepareStageTopics(f.pid,f.uid,'problem'),'unavailable');assert.equal(f.writes.length,0);f.preserved()}
});
test('legacy speech cards are rejected as topics while an already-open old card remains resolvable',async t=>{
 const f=setup(t,'legacy-speech');const raw=fixture.logs.filter(log=>log.sender==='user').map((log,i)=>({id:'old-speech-'+i,title:'이전 단계 발언 '+(i+1),summary:log.text,sourceStage:'problem',sourceKind:'dialogue',sourceHash:'old',references:[{messageId:log.id,sessionId:log.sessionId,sourceIndex:fixture.logs.indexOf(log),quote:log.text}]}));f.docs.set(f.legacyPath,{status:'ready',projectId:f.pid,userId:f.uid,sourceStage:'problem',topics:raw});
 const state=await server.readStoredStageTopicState(f.pid,f.uid,'problem');assert.equal(state.status,'missing');assert.equal(state.topics.length,0);assert.equal((await server.resolveStoredTopic(f.pid,f.uid,'problem',raw[2].id)).references[0].messageId,raw[2].references[0].messageId);f.preserved();
});
test('valid saved legacy topics reuse their existing version without another generation or overwrite',async t=>{
 const f=setup(t,'valid-legacy');const source=fixture.logs.map((log,sourceIndex)=>({sourceIndex,role:log.sender,content:log.text,messageId:log.id,sessionId:log.sessionId}));const sourceHash=digest({version:1,stage:'problem',kind:'dialogue',source});const topics=server.validateTopics(resultFor({dialogue:source}).topics,source,'problem',sourceHash,'dialogue');const legacy={status:'ready',mode:'model',projectId:f.pid,userId:f.uid,sourceStage:'problem',topics};f.docs.set(f.legacyPath,structuredClone(legacy));mock(t,llm,'callLLM',()=>assert.fail('existing valid summary must not regenerate'));
 assert.equal((await server.readStoredStageTopicState(f.pid,f.uid,'problem')).status,'ready');assert.equal(await server.prepareStageTopics(f.pid,f.uid,'problem'),'ready');assert.equal(f.writes.length,0);assert.deepEqual(f.docs.get(f.legacyPath),legacy);f.preserved();
});
test('API repairs missing completed-stage topics once and exposes prepare/save/read using only authenticated participant scope',async t=>{
 const api=load('pages/api/stage-topics.js').default,context=load('lib/project-context-server.js');const f=setup(t,'api');mock(t,context,'loadProjectContext',async()=>({projectId:f.pid,user:{uid:f.uid}}));mock(t,llm,'callLLM',async req=>JSON.stringify(resultFor(JSON.parse(req.userText))));
 const invoke=async body=>{const res={setHeader(){},status(n){this.code=n;return this},json(v){this.body=v}};await api({method:'POST',body:{projectId:f.pid,uid:'foreign-user',...body}},res);return res};
 let response=await invoke({currentStage:'data'});assert.equal(response.body.status,'ready');assert.equal(response.body.needsPreparation,false);assert.equal(response.body.topics.length,4);response=await invoke({currentStage:'problem',action:'extract'});assert.equal(response.code,200);assert.equal(response.body.status,'ready');response=await invoke({currentStage:'data'});assert.equal(response.body.topics.length,4);assert.equal(response.body.status,'ready');f.preserved();
});
test('the normal answer handler receives multiple original turns for one selected theme and no forged resident statement',async t=>{
 const f=setup(t,'context');mock(t,llm,'callLLM',async req=>JSON.stringify(resultFor(JSON.parse(req.userText))));await server.prepareStageTopics(f.pid,f.uid,'problem');const topic=(await server.readStoredStageTopics(f.pid,f.uid,'problem'))[0];const context=load('lib/project-context-server.js');
 mock(t,context,'loadProjectContext',async req=>{assert.equal(req.body.continuityTopicId,topic.id);const resolved=await server.resolveStoredTopic(f.pid,f.uid,'problem',topic.id);return{projectId:f.pid,user:{uid:f.uid},currentMaterial:'등록된 프로젝트 자료',previousSummaries:{},stageHistory:[],cases:[],continuityTopic:resolved,continuityContext:topicContext(resolved,'data')}});
 mock(t,llm,'callLLM',async req=>{assert.match(req.systemText,/UI topic selection, not a resident utterance/);for(const id of topicMessageIds(topic))assert.ok(req.userText.includes(id));return JSON.stringify({summary:'말씀하신 지속적인 관리와 역할 분담을 함께 살펴볼 수 있어요.',caseFindings:[],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'',projectImplications:[],limitations:''})});
 mock(t,global,'fetch',()=>assert.fail('no new search from a card selection'));const res={setHeader(){},status(n){this.code=n;return this},json(v){this.body=v}};await load('pages/api/research/answer.js').default({method:'POST',headers:{},body:{projectId:f.pid,question:'선택한 이전 주제로 자료 확인을 시작해 주세요.',continuityTopicId:topic.id,topicSelection:true,selectedSources:['project']}},res);assert.equal(res.code,200);assert.match(res.body.reply,/지속적인 관리/);f.preserved();
});
test('API reports blocked or save-failed preparation as an unsuccessful request, never a silent 200 success',async t=>{
 const api=load('pages/api/stage-topics.js').default,context=load('lib/project-context-server.js');
 for(const enabled of [false,true]){const f=setup(t,'api-failure-'+enabled,{enabled,saveFails:enabled});mock(t,context,'loadProjectContext',async()=>({projectId:f.pid,user:{uid:f.uid}}));mock(t,llm,'callLLM',async req=>JSON.stringify(resultFor(JSON.parse(req.userText))));const res={setHeader(){},status(n){this.code=n;return this},json(v){this.body=v}};await api({method:'POST',body:{currentStage:'problem',action:'extract'}},res);assert.equal(res.code,503);assert.equal(res.body.ok??false,false);assert.equal(res.body.status,enabled?'failed':'unavailable');assert.equal(res.body.reason,enabled?'save_failed':'preparation_disabled');assert.ok(!JSON.stringify(res.body).includes('synthetic-user'));f.preserved()}
});
test('greetings and compound acknowledgements cannot support an independent topic',()=>{
 const {topicAcknowledgement}=load('lib/stage-topics.js');assert.equal(topicAcknowledgement('네. 감사합니다.'),true);const source=[{sourceIndex:0,role:'user',content:'네. 감사합니다.'}];assert.throws(()=>server.validateTopics([{title:'마무리 인사',summary:'주민이 인사를 했다고 말씀하셨어요.',places:[],openQuestion:'',references:[{sourceIndex:0,quote:'네. 감사합니다.'}]}],source,'problem','hash','dialogue',2),/확인 응답/);
});
test('a previously stored valid summary stays reusable even when new derived writes are disabled',async t=>{
 const f=setup(t,'ready-readonly');let calls=0;mock(t,llm,'callLLM',async req=>{calls++;return JSON.stringify(resultFor(JSON.parse(req.userText)))});await server.prepareStageTopics(f.pid,f.uid,'problem');const before=f.writes.length;process.env.PPSS_TOPIC_DERIVED_WRITES_ENABLED='false';assert.equal(await server.prepareStageTopics(f.pid,f.uid,'problem'),'ready');assert.equal((await server.readStoredStageTopicState(f.pid,f.uid,'problem')).topics.length,4);assert.equal(calls,1);assert.equal(f.writes.length,before);f.preserved();
});
