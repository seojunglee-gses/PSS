import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),load=p=>require(`${process.env.PSS_TEST_BUILD}/${p}`);
const service=load('lib/stage-topics-server.js'),admin=load('lib/firebaseAdmin.js'),llm=load('lib/llm/index.js');
const mock=(t,o,k,v)=>{const old=o[k];o[k]=v;t.after(()=>o[k]=old)};
function setup(t,name,enabled=false){
 for(const [k,v]of Object.entries({PPSS_TOPIC_DERIVED_WRITES_ENABLED:enabled?'true':'false',PPSS_RESEARCH_BACKUP_VERIFIED_AT:'2026-01-01',PPSS_RESEARCH_RESTORE_VERIFIED_AT:'2026-01-01',PPSS_TOPIC_RULES_VERIFIED_AT:'2026-01-01'})){const old=process.env[k];t.after(()=>old===undefined?delete process.env[k]:process.env[k]=old);process.env[k]=v}
 const pid='prepared-'+name,uid='resident',docs=new Map([[`users_${pid}/${uid}/steps/problem`,{logs:[{sender:'user',id:'original-id',sessionId:'original-session',text:'시장 옆 골목을 안전하게 걷고 싶어요.'}],completed:true}]]),before=JSON.stringify([...docs]),reads=[],writes=[];
 const ref=path=>({path,get:async()=>{reads.push(path);return {exists:docs.has(path),data:()=>structuredClone(docs.get(path))}},create:async value=>{assert.ok(path.startsWith('ppssDerivedStageTopics/'));if(docs.has(path))throw {code:6};writes.push(path);docs.set(path,structuredClone(value))}});
 let transactions=Promise.resolve();const db={doc:ref,runTransaction(fn){const operation=transactions.then(()=>fn({get:r=>r.get(),set(r,v){assert.ok(r.path.startsWith('ppssDerivedStageTopics/'));writes.push(r.path);docs.set(r.path,structuredClone(v))},update(r,v){assert.ok(r.path.startsWith('ppssDerivedStageTopics/'));writes.push(r.path);docs.set(r.path,{...docs.get(r.path),...structuredClone(v)})}}));transactions=operation.catch(()=>{});return operation}};
 mock(t,admin,'adminDb',()=>db);
 return {pid,uid,docs,reads,writes,preserved(){assert.equal(JSON.stringify([...docs].filter(([p])=>!p.startsWith('ppssDerivedStageTopics/'))),before)}};
}
test('entry and repeated reads use resident excerpts with zero AI and zero DB writes in safe mode',async t=>{
 const f=setup(t,'readonly');mock(t,llm,'callLLM',()=>assert.fail('entry must not invoke AI'));
 const lists=await Promise.all(Array.from({length:8},()=>service.readStoredStageTopics(f.pid,f.uid,'problem')));
 assert.ok(lists.every(list=>list[0].summary==='시장 옆 골목을 안전하게 걷고 싶어요.'));assert.ok(lists.every(list=>list[0].id===lists[0][0].id));assert.equal(f.writes.length,0);f.preserved();
});
test('verified persistence prepares once under concurrent completion requests, then serves only saved data',async t=>{
 const f=setup(t,'prepare',true);let calls=0;
 mock(t,llm,'callLLM',async()=>{calls++;await new Promise(r=>setTimeout(r,15));return JSON.stringify({topics:[{title:'시장 골목 보행',summary:'시장 옆 골목을 안전하게 걷고 싶다고 말씀하셨어요.',places:[],openQuestion:'',references:[{sourceIndex:0,quote:'시장 옆 골목을 안전하게 걷고 싶어요.'}]}]})});
 await Promise.all(Array.from({length:8},()=>service.prepareStageTopics(f.pid,f.uid,'problem')));assert.equal(calls,1);
 f.reads.length=0;const topics=await service.readStoredStageTopics(f.pid,f.uid,'problem');assert.equal(topics[0].title,'시장 골목 보행');assert.ok(f.reads.every(p=>p.startsWith('ppssDerivedStageTopics/')));
 await service.prepareStageTopics(f.pid,f.uid,'problem');assert.equal(calls,1);f.preserved();
});
test('legacy fallback persists once without AI, and a previously displayed card resolves after preparation',async t=>{
 const f=setup(t,'legacy',true);mock(t,llm,'callLLM',async()=>JSON.stringify({topics:[{title:'안전한 골목',summary:'골목 보행을 중요하게 말씀하셨어요.',places:[],openQuestion:'',references:[{sourceIndex:0,quote:'시장 옆 골목을 안전하게 걷고 싶어요.'}]}]}));
 const first=await service.readStoredStageTopics(f.pid,f.uid,'problem');const count=f.writes.length;await service.readStoredStageTopics(f.pid,f.uid,'problem');assert.equal(f.writes.length,count);
 await service.prepareStageTopics(f.pid,f.uid,'problem');assert.ok(await service.resolveStoredTopic(f.pid,f.uid,'problem',first[0].id));f.preserved();
});
test('older continuation requests forward to existing chat handlers without invoking a separate topic agent',async t=>{
 const api=load('pages/api/stage-topics.js').default,chat=load('pages/api/chat.js'),research=load('pages/api/research/answer.js');let calls=0;
 mock(t,llm,'callLLM',()=>assert.fail('topic endpoint must not generate conversation'));
 const forward=async(req,res)=>{calls++;assert.equal(req.body.topicSelection,true);assert.equal(req.body.continuityTopicId,'owned-topic');assert.equal(req.body.action,undefined);res.status(200).json({reply:'기존 채팅 경로'})};
 mock(t,chat,'default',forward);mock(t,research,'default',forward);
 for(const stage of ['data','alternatives','evaluation','report']){const res={setHeader(){},status(n){this.code=n;return this},json(v){this.body=v}};await api({method:'POST',body:{action:'continue',currentStage:stage,topicId:'owned-topic',projectId:'p'}},res);assert.equal(res.code,200)}
 assert.equal(calls,4);
});
test('topic material reuse bypasses original-document, paper and external-case searches even with background data',async t=>{
 const evidence=load('lib/research/evidence.js'),original=load('lib/research/background-sources-server.js');
 mock(t,original,'backgroundOriginalContext',()=>assert.fail('no extra document search on topic selection'));
 mock(t,global,'fetch',()=>assert.fail('no external calls on topic selection'));
 const reuse={question:'',selectedSources:['project'],cases:[],papers:[],projectContext:'실제로 등록된 자료',warnings:[]};
 const result=await evidence.retrieveEvidence({question:'프로젝트 자료 원문을 확인해 주세요.',searchQuestion:'프로젝트 자료 원문을 확인해 주세요.',selectedSources:['project'],topicSelection:true,reuseEvidence:reuse,projectContext:reuse.projectContext,authorizedProjectId:'p',hasBackground:true,provider:'openai',cases:[]});
 assert.equal(result.projectContext,reuse.projectContext);assert.equal(result.cases.length,0);
});
