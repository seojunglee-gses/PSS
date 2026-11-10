import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),load=p=>require(`${process.env.PSS_TEST_BUILD}/${p}`);
const service=load('lib/problem-dialogue-context.js'),llm=load('lib/llm/index.js');
const project=load('lib/project-context-server.js'),admin=load('lib/firebaseAdmin.js');
const handler=load('pages/api/workspace-summary.js').default;
const stages=['problem','data','alternatives','evaluation','report'];
const mock=(t,obj,key,value)=>{const old=obj[key];obj[key]=value;t.after(()=>obj[key]=old)};
const options=(stage,saved,extra={})=>({stage,saved,projectId:'completion-project',userId:'completion-user',fallback:[],provider:'openai',model:'gpt-6.1-sol',...extra});
const logs=(stage,n,size=0)=>Array.from({length:n},(_,i)=>({stepId:stage,sender:i%2?'assistant':'user',text:`turn-${i}: `+'가'.repeat(size)}));
function setup(t,read){
 const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='summary-test';t.after(()=>previous===undefined?delete process.env.OPENAI_API_KEY:process.env.OPENAI_API_KEY=previous);
 mock(t,project,'loadProjectContext',async(_req,stage)=>({projectId:'completion-project',user:{uid:'completion-user'},currentMaterial:'사업 자료',previousSummaries:{},cases:[],stageHistory:[]}));
 mock(t,admin,'adminDb',()=>({
  doc(path){
   assert.match(path,/^users_completion-project\/completion-user\/steps\/(problem|data|alternatives|evaluation|report)$/);
   return {get:async()=>({data:()=>({logs:read(path.split('/').at(-1))})})};
  }
 }));
}
const run=async(stage,extra={})=>{const result={};await handler({method:'POST',headers:{},body:{currentStage:stage,...extra}},{status(code){result.status=code;return this},json(body){result.body=body}});return result};
const finalReply=stage=>Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({workspaceSummary:{stageSummaries:Object.fromEntries(stages.map(id=>[id,id===stage?'참여자가 검토한 방향입니다.':''])),overallSummary:'해당 단계 요약'}})}]}]});
const payload=body=>JSON.parse(JSON.parse(body).input.split('Input JSON: ')[1].split('\n\nReturn JSON')[0]);

test('all five completion summaries retain over sixty original messages, complete long turns and the final user contribution',async t=>{
 let saved;setup(t,()=>saved);
 mock(t,llm,'callLLM',()=>assert.fail('modest dialogue needs no compaction'));
 mock(t,global,'fetch',async(_url,request)=>{
  const data=payload(request.body);assert.equal(data.dialogue.length,81);assert.equal(data.sourceMessageCount,81);
  assert.match(data.dialogue[40].content,/turn-40/);assert.equal(data.dialogue[20].content,saved[20].text);
  assert.equal(data.dialogue.at(-1).content,'마지막 정정: 주차장 확대는 원하지 않아요.');assert.equal(data.earlierDialogueMemory,undefined);
  assert.doesNotMatch(JSON.stringify(data.dialogue),/다른 단계|활동 메타데이터/);
  assert.equal(JSON.parse(request.body).model,'gpt-6.1-sol');return finalReply(data.currentStage);
 });
 for(const stage of stages){
  saved=logs(stage,80);saved[20].text='2000자 넘는 발언: '+'나'.repeat(2000);saved.push({stepId:stage,sender:'user',text:'마지막 정정: 주차장 확대는 원하지 않아요.'},{stepId:stages.find(id=>id!==stage),sender:'user',text:'다른 단계'},{stepId:stage,sender:'assistant',text:'활동 메타데이터',activity:{}});
  const result=await run(stage);assert.equal(result.status,200);assert.equal(result.body.workspaceSummary.stageSummaries[stage],'참여자가 검토한 방향입니다.');
 }
});

test('every stage compacts all earlier turns including the middle, then synthesizes memory with recent originals',async t=>{
 let saved,seen=[];setup(t,()=>saved);
 mock(t,llm,'callLLM',async request=>{
  assert.equal(request.model,'gpt-6.1-sol');assert.match(request.systemText,/participant views distinct from assistant suggestions/);
  const data=JSON.parse(request.userText);if(data.dialogue)seen.push(...data.dialogue.map(fragment=>fragment.content));
  return '참여자는 안전한 보행을 중시했고, 중간 논의에서 주차장 확대를 거절했다. AI의 제안은 참여자의 선택과 구분한다.';
 });
 mock(t,global,'fetch',async(_url,request)=>{
  const data=payload(request.body);assert.equal(data.sourceMessageCount,101);assert.ok(data.dialogue.length<101);
  assert.match(data.earlierDialogueMemory,/주차장 확대를 거절/);assert.equal(data.dialogue.at(-1).content,'마지막 의견은 그늘 있는 보행 공간입니다.');
  const full=[...seen,...data.dialogue.map(m=>m.content)].join('\n');
  for(let i=0;i<100;i++)assert.ok(full.includes(`turn-${i}:`),`missing turn ${i} in ${data.currentStage}`);
  assert.match(JSON.parse(request.body).input,/Later participant corrections override earlier statements/);return finalReply(data.currentStage);
 });
 for(const stage of stages){seen=[];saved=logs(stage,100,800);saved[50].text+=' 중간 수정: 주차장 확대는 원하지 않아요.';saved.push({stepId:stage,sender:'user',text:'마지막 의견은 그늘 있는 보행 공간입니다.'});assert.equal((await run(stage)).status,200);}
});

test('empty saved dialogue is authoritative after a reset; only missing legacy logs use the supplied fallback',async t=>{
 let saved=[];setup(t,()=>saved);
 mock(t,llm,'callLLM',()=>assert.fail('no long dialogue'));
 mock(t,global,'fetch',async(_url,request)=>{const data=payload(request.body);assert.deepEqual(data.dialogue,saved===undefined?[{role:'user',content:'현재 사용자가 전달한 레거시 대화'}]:[]);return finalReply(data.currentStage)});
 assert.equal((await run('data',{historyByStage:{data:[{sender:'user',text:'현재 사용자가 전달한 레거시 대화'}]}})).status,200);
 saved=undefined;assert.equal((await run('data',{historyByStage:{data:[{sender:'user',text:'현재 사용자가 전달한 레거시 대화'}]}})).status,200);
});

test('failed compaction cannot produce an incomplete completion summary or expose provider details',async t=>{
 setup(t,stage=>logs(stage,90,1000));
 mock(t,llm,'callLLM',async()=>{throw Error('private provider detail')});
 mock(t,global,'fetch',()=>assert.fail('no final synthesis after failed compaction'));
 const result=await run('report');assert.equal(result.status,500);assert.match(result.body.error,/이전 대화를 요약하지 못/);assert.doesNotMatch(result.body.error,/private provider/);assert.equal(result.body.workspaceSummary,undefined);
});

test('derived memories are isolated by stage in addition to the existing project/user/model/content boundaries',async t=>{
 let calls=0;mock(t,llm,'callLLM',async()=>{calls++;return '참여자 발언과 AI 제안을 구분한 기억.'});
 const saved=[{sender:'Planner',text:'원문 처음 '+'다'.repeat(55000)+' 원문 끝'}];
 await service.stageDialogueContext(options('alternatives',saved,{projectId:'stage-isolation'}));const first=calls;
 await service.stageDialogueContext(options('alternatives',saved,{projectId:'stage-isolation'}));assert.equal(calls,first);
 await service.stageDialogueContext(options('evaluation',saved,{projectId:'stage-isolation'}));assert.ok(calls>first);
});
