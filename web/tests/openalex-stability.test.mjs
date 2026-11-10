import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),load=p=>require(`${process.env.PSS_TEST_BUILD}/${p}`);
const alex=load('lib/research/openalex.js'),gate=load('lib/research/openalex-request.js'),llm=load('lib/llm/index.js');
const mock=(t,obj,key,value)=>{const old=obj[key];obj[key]=value;t.after(()=>obj[key]=old)};
const env=(t,key,value)=>{const old=process.env[key];t.after(()=>old===undefined?delete process.env[key]:process.env[key]=old);if(value===undefined)delete process.env[key];else process.env[key]=value};
function setup(t){env(t,'OPENALEX_MIN_INTERVAL_MS','100');env(t,'OPENALEX_REQUEST_BUDGET_MS','3000');env(t,'OPENALEX_REDIS_REST_URL',undefined);env(t,'OPENALEX_REDIS_REST_TOKEN',undefined)}
const work=(id='W801')=>({id:`https://openalex.org/${id}`,display_name:'Synthetic research',abstract_inverted_index:{Verified:[0],abstract:[1]},authorships:[]});
const reply=()=>({summary:'프로젝트의 보행 공간을 남기는 방법을 조건부로 살펴볼 수 있어요.',caseFindings:[],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'',projectImplications:[],limitations:''});
test('concurrent distinct searches are queued while equal searches coalesce and retain five-minute cache',async t=>{
 setup(t);let active=0,max=0,calls=0;const starts=[];
 mock(t,global,'fetch',async()=>{calls++;active++;max=Math.max(max,active);starts.push(Date.now());await new Promise(r=>setTimeout(r,130));active--;return Response.json({results:[work()]})});
 const result=await Promise.all(['alpha concurrency','beta concurrency','alpha concurrency','gamma concurrency'].map(q=>alex.searchOpenAlex(q)));
 assert.equal(calls,3);assert.ok(max<=2);assert.ok(starts.slice(1).every((n,i)=>n-starts[i]>=85));assert.equal(result.length,4);
 await alex.searchOpenAlex('alpha concurrency');assert.equal(calls,3);
});
test('paper ID and URL share pending retrieval/cache and never substitute another paper',async t=>{
 setup(t);let calls=0;mock(t,global,'fetch',async()=>{calls++;await new Promise(r=>setTimeout(r,20));return Response.json(work('W802'))});
 await Promise.all([alex.readOpenAlexPaper('W802'),alex.readOpenAlexPaper('https://openalex.org/W802')]);await alex.readOpenAlexPaper('W802');assert.equal(calls,1);
});
test('429 retries honor Retry-After and HTTP dates, with a maximum of three attempts',async t=>{
 setup(t);assert.equal(gate.retryAfterMs('2'),2000);assert.equal(gate.retryAfterMs('Thu, 01 Jan 1970 00:00:03 GMT',1000),2000);assert.equal(gate.retryAfterMs('invalid'),undefined);assert.equal(gate.retryDelayMs(null,0,()=>0),500);assert.equal(gate.retryDelayMs(null,1,()=>0.5),1125);assert.equal(gate.retryDelayMs('2',1,()=>0),2000);
 let calls=0;mock(t,global,'fetch',async()=>++calls<3?new Response('',{status:429,headers:{'retry-after':'0'}}):Response.json({results:[work('W803')]}));
 assert.equal((await alex.searchOpenAlex('retry success fixture')).length,1);assert.equal(calls,3);
 calls=0;mock(t,global,'fetch',async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'0'}})});
 await assert.rejects(()=>alex.searchOpenAlex('retry exhausted fixture'),/잠시 제한/);assert.equal(calls,3);
});
test('search failure still generates an answer using project/history, explicitly reports failure and rejects fictional citations',async t=>{
 setup(t);const evidenceLib=load('lib/research/evidence.js'),answer=load('lib/research/answer.js');
 mock(t,global,'fetch',async()=>new Response('',{status:429,headers:{'retry-after':'0'}}));
 const request=evidenceLib.parseAnalysisRequest({question:'synthetic research search',selectedSources:['project','research'],projectContext:'모의 사업 자료: 보행 공간 개선',history:[{role:'user',content:'나무 그늘도 중요해요.'}]});
 const evidence=await evidenceLib.retrieveEvidence(request);assert.equal(evidence.papers.length,0);assert.equal(evidence.warnings[0].source,'research');
 mock(t,llm,'callLLM',async req=>{const data=JSON.parse(req.userText);assert.equal(data.projectMaterial,request.projectContext);assert.equal(data.history.length,1);return JSON.stringify(reply())});
 assert.match((await answer.answerFromEvidence(request,evidence)).summary,/잠시 제한/);
 mock(t,llm,'callLLM',async()=>JSON.stringify({...reply(),summary:'가짜 근거 [R:W999]'}));await assert.rejects(()=>answer.answerFromEvidence(request,evidence),/unsupported source reference/);
});
test('diagnostics record status, retries, key presence and allowed headers without credentials, URL or query',async t=>{
 setup(t);env(t,'OPENALEX_API_KEY','secret-api-key');const logs=[];mock(t,console,'info',value=>logs.push(value));
 mock(t,global,'fetch',async url=>{assert.equal(url.searchParams.get('api_key'),'secret-api-key');return Response.json({results:[work('W804')]},{headers:{'x-request-id':'request-123','x-ratelimit-remaining':'42','x-private':'resident text'}})});
 await alex.searchOpenAlex('PRIVATE resident query');const text=logs.join('\n');assert.ok(!text.includes('secret-api-key'));assert.ok(!text.includes('PRIVATE resident'));assert.ok(!text.includes('https://'));assert.ok(!text.includes('resident text'));
 const entry=logs.map(JSON.parse).find(v=>v.event==='http');assert.equal(entry.status,200);assert.equal(entry.apiKeyConfigured,true);assert.equal(entry.headers['x-request-id'],'request-123');assert.equal(entry.retries,0);assert.equal(entry.cache,false);assert.ok(entry.durationMs>=0);
});
test('separate limiter instances share Redis admission and fail closed when coordination is unavailable',async t=>{
 setup(t);env(t,'OPENALEX_REDIS_REST_URL','https://redis.test');env(t,'OPENALEX_REDIS_REST_TOKEN','redis-secret');
 let next=0,active=0,max=0,providerCalls=0;const leases=new Set();
 mock(t,global,'fetch',async(url,options)=>{
  if(String(url)==='https://redis.test'){
   const cmd=JSON.parse(options.body);
   if(cmd[0]==='ZREM'){leases.delete(cmd[2]);return Response.json({result:1})}
   const now=Date.now();if(now<next)return Response.json({result:next-now});if(leases.size>=2)return Response.json({result:10});leases.add(cmd[5]);next=now+100;return Response.json({result:0});
  }
  providerCalls++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,140));active--;return Response.json({results:[]});
 });
 delete require.cache[require.resolve(`${process.env.PSS_TEST_BUILD}/lib/research/openalex-request.js`)];const other=load('lib/research/openalex-request.js');
 await Promise.all([gate,other,gate,other].map(g=>g.openAlexRequest(new URL('https://api.openalex.org/works'))));assert.equal(providerCalls,4);assert.ok(max<=2);
 mock(t,global,'fetch',async url=>{assert.equal(String(url),'https://redis.test');throw Error('private coordination failure')});
 await assert.rejects(()=>other.openAlexRequest(new URL('https://api.openalex.org/works')),/연결하지 못/);
});
test('AI generation failures are separately classified without logging private provider messages',()=>{
 const d=load('lib/research/diagnostics.js');assert.equal(d.answerFailureType(new SyntaxError('private')),'invalid_json');assert.equal(d.answerFailureType(Error('The analysis contained an unsupported source reference.')),'source_validation');assert.equal(d.answerFailureType(Error('API key private')),'generation_or_transport');
});

test('a Retry-After longer than the request budget is not shortened to retry early',async t=>{
 setup(t);let calls=0;mock(t,global,'fetch',async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'4'}})});
 await assert.rejects(()=>alex.searchOpenAlex('long retry fixture'),/잠시 제한/);assert.equal(calls,1);
});

test('paper explanation reuses evidence but explicit new searches bypass reuse; answer failures have separate safe logs',async t=>{
 const context=load('lib/project-context-server.js'),follow=load('lib/research/follow-up.js'),evidence=load('lib/research/evidence.js'),answer=load('lib/research/answer.js'),handler=load('pages/api/research/answer.js').default;
 const previous={question:'earlier',selectedSources:['research'],cases:[],papers:[],warnings:[]};let seen;const logs=[];
 mock(t,context,'loadProjectContext',async()=>({projectId:'mock-project',user:{uid:'mock-user'},currentMaterial:'모의 사업',previousSummaries:{},cases:[],stageHistory:[]}));
 mock(t,follow,'recentAnswerEvidence',()=>previous);
 mock(t,evidence,'retrieveEvidence',async req=>{seen=req;return {...previous,question:req.question}});
 mock(t,answer,'answerFromEvidence',async()=>({...reply(),sources:[]}));mock(t,console,'warn',value=>logs.push(value));
 const run=async question=>{const result={};await handler({method:'POST',headers:{},body:{question}},{setHeader(){},status(code){result.status=code;return this},json(body){result.body=body}});return result};
 assert.equal((await run('이 논문을 쉽게 설명해줘')).status,200);assert.equal(seen.reuseEvidence,previous);
 assert.equal((await run('이 논문 말고 다른 논문을 새로 검색해줘')).status,200);assert.equal(seen.reuseEvidence,undefined);
 mock(t,answer,'answerFromEvidence',async()=>{throw Error('PRIVATE provider text and secret API key')});
 assert.equal((await run('일반적인 질문')).status,502);assert.equal(JSON.parse(logs[0]).failureType,'generation_or_transport');assert.ok(!logs.join('').includes('PRIVATE'));assert.ok(!logs.join('').includes('secret'));
});
