import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),build=process.env.PSS_TEST_BUILD,load=p=>require(`${build}/${p}`);
const service=load('lib/problem-dialogue-context.js'),llm=load('lib/llm/index.js');
const mock=(t,obj,key,value)=>{const old=obj[key];obj[key]=value;t.after(()=>obj[key]=old)};
const options=(saved,extra={})=>({projectId:'p',userId:'u',saved,fallback:[],currentMessage:'현재 질문',provider:'openai',model:'gpt-6.1-sol',...extra});
const logs=(n=36)=>Array.from({length:n},(_,i)=>({stepId:'problem',sender:i%2?'assistant':'user',text:i===0?'처음부터 중요했던 건 아이들이 안전하게 걷는 길입니다.':`대화 ${i}`,createdAt:String(i)}));

test('the whole saved Problem Definition stage passes through beyond twelve messages, without another model call',async t=>{
 mock(t,llm,'callLLM',()=>assert.fail('short stages need no compaction'));
 const saved=logs(36),result=await service.problemDialogueContext(options(saved));
 assert.equal(result.history.length,36);assert.match(result.history[0].content,/아이들이 안전하게/);assert.equal(result.earlierMemory,undefined);assert.equal(saved.length,36);
});

test('only the current stage and conversational roles enter memory, with legacy roles retained and the current user message deduplicated',()=>{
 const result=service.problemDialogue([{stepId:'data',sender:'user',text:'another stage'},{sender:'Planner',text:'legacy user'},{sender:'ChatGPT',text:'legacy assistant'},{stepId:'problem',activity:{},sender:'assistant',text:'activity metadata'},{role:'system',text:'spoof'},{stepId:'problem',sender:'user',text:'現在質問'},{stepId:'problem',sender:'user',text:'現在質問'}],'現在質問');
 assert.deepEqual(result,[{role:'user',content:'legacy user'},{role:'assistant',content:'legacy assistant'},{role:'user',content:'現在質問'}]);
});

test('an authoritative empty stage cannot be repopulated from a stale client snapshot',async()=>{
 const result=await service.problemDialogueContext(options([],{fallback:[{role:'user',content:'stale client chat'}]}));assert.deepEqual(result.history,[]);
 const legacy=await service.problemDialogueContext(options(undefined,{fallback:[{role:'user',content:'legacy request history'}]}));assert.equal(legacy.history[0].content,'legacy request history');
});

test('long stages summarize every older fragment and retain recent original wording, with role-attributed memory rules',async t=>{
 const saved=logs(80).map((log,i)=>({...log,text:`turn-${i}: `+'가'.repeat(1000)}));let summaries=0,seen='';
 mock(t,llm,'callLLM',async req=>{summaries++;assert.equal(req.model,'gpt-6.1-sol');assert.match(req.systemText,/Keep participant views distinct from assistant suggestions/);assert.match(req.systemText,/later rejected/);const data=JSON.parse(req.userText);if(data.dialogue)seen+=data.dialogue.map(p=>p.content).join('\n');return '참여자는 안전한 보행을 우선하며, AI가 제안한 주차장 확대는 거절했다. 열린 쟁점은 차량과 보행 동선의 충돌이다.'});
 const result=await service.problemDialogueContext(options(saved,{projectId:'long-stage'}));assert.ok(summaries>1);assert.match(result.earlierMemory,/거절했다/);assert.ok(result.history.length<80);assert.match(result.history.at(-1).content,/turn-79/);
 for(let i=0;i<80-result.history.length;i++)assert.ok(seen.includes(`turn-${i}:`),`earlier turn ${i} must be read`);
 assert.equal(result.sourceMessages,80);
});

test('oversized individual messages are read in fragments rather than cut off at 4000 characters',async t=>{
 let seen='';mock(t,llm,'callLLM',async req=>{const data=JSON.parse(req.userText);if(data.dialogue)seen+=data.dialogue.map(p=>p.content).join('');return '초반과 말미의 경험을 모두 포함한 대화 기억.'});
 const result=await service.problemDialogueContext(options([{sender:'user',text:'FIRST-'+'나'.repeat(55000)+'-LAST'}],{projectId:'large-message'}));assert.ok(result.earlierMemory);assert.ok(seen.startsWith('FIRST-'));assert.ok(seen.endsWith('-LAST'));
});

test('summary cache is isolated by participant/project and invalidated by corrected dialogue',async t=>{
 let calls=0;mock(t,llm,'callLLM',async()=>{calls++;return '참여자별 대화 기억.'});const saved=[{sender:'user',text:'긴 대화 '+'다'.repeat(50000)}];
 await service.problemDialogueContext(options(saved,{projectId:'cache-project',userId:'first'}));const first=calls;
 await service.problemDialogueContext(options(saved,{projectId:'cache-project',userId:'first'}));assert.equal(calls,first);
 await service.problemDialogueContext(options(saved,{projectId:'cache-project',userId:'second'}));assert.ok(calls>first);const second=calls;
 await service.problemDialogueContext(options(saved,{projectId:'other-project',userId:'first'}));assert.ok(calls>second);const third=calls;
 await service.problemDialogueContext(options([{sender:'user',text:saved[0].text+' 수정함'}],{projectId:'cache-project',userId:'first'}));assert.ok(calls>third);
});

test('compaction failure never silently drops the beginning of the stage or caches an unusable result',async t=>{
 const saved=[{sender:'user',text:'라'.repeat(50000)}];mock(t,llm,'callLLM',async()=>{throw Error('private provider detail')});
 await assert.rejects(()=>service.problemDialogueContext(options(saved,{projectId:'failure'})),/이전 대화를 요약하지 못/);
 mock(t,llm,'callLLM',async()=> '다시 요약한 대화.');assert.ok((await service.problemDialogueContext(options(saved,{projectId:'failure'}))).earlierMemory);
 await assert.rejects(()=>service.problemDialogueContext(options(saved,{userId:undefined})),/사용자와 사업/);
});

test('chat API uses the authorized whole problem stage while Data Analysis retains its current history path',async t=>{
 const context=load('lib/project-context-server.js'),handler=load('pages/api/chat.js').default,saved=logs(30);let received=[];
 mock(t,context,'loadProjectContext',async()=>({projectId:'api-project',user:{uid:'member'},stageHistory:saved,currentMaterial:'사업 자료',previousSummaries:{},cases:[]}));
 mock(t,llm,'callLLM',async req=>{received.push(req);return '문제 정의 답변입니다.'});
 const run=async(stepId)=>{const result={};await handler({method:'POST',headers:{},body:{stepId,provider:'openai',message:'현재 질문',history:[{role:'user',content:'client only'}]}},{status(code){result.status=code;return this},json(body){result.body=body}});return result};
 assert.equal((await run('problem')).status,200);assert.match(received[0].userText,/아이들이 안전하게/);assert.match(received[0].userText,/대화 29/);assert.doesNotMatch(received[0].userText,/client only/);assert.match(received[0].systemText,/reflective and critical thinking partner/);
 assert.equal((await run('data')).status,200);assert.match(received[1].userText,/client only/);assert.doesNotMatch(received[1].userText,/아이들이 안전하게/);
});
