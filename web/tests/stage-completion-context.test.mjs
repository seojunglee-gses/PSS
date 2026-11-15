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
  collection(path){assert.equal(path,'ppssGeneratedImages_completion-project');return {where:(key,op,value)=>{assert.equal(key,'userId');assert.equal(value,'completion-user');return {get:async()=>({docs:[]})}}}},
  doc(path){
   if(path.startsWith("ppssDerivedStageTopics/"))return {get:async()=>({data:()=>undefined})};
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
  const data=payload(request.body);assert.equal(Object.hasOwn(data,'designRecords'),data.currentStage==='alternatives');assert.equal(data.dialogue.length,81);assert.equal(data.sourceMessageCount,81);
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

const designServer=load('lib/design-alternatives-server.js');
const initialDirection={revision:'initial',introduction:'골목 환경개선 방향',confirmedAt:'2026-11-01T00:00:00Z',interventions:[
 {text:'골목 입구 보행자 우선 표시 및 진입 안내',origin:'ai',basis:'차량 진입 불편 의견'},
 {text:'아울렛 슈퍼 앞부터 골목 조명 보강',origin:'participant',basis:'조명 개선 요청'},
 {text:'녹지와 쉼터 조성',origin:'ai',basis:'공간개선 제안'},
 {text:'간판 정돈 및 상점 개성 유지',origin:'ai',basis:'상점 환경 제안'},
]};
const concern='이 나무는 누가 관리할 건데. 이 화분들도 지속 가능성이랑 현실성이 좀 부족한 거 같아.';
function designSetup(t,{images=[],directions=[initialDirection],saved=[{sender:'user',text:'이대로 만들어주세요.'}],failRead=false}={}){
 const owner={projectId:'completion-project',user:{uid:'completion-user'},currentMaterial:'해당 골목 개선',previousSummaries:{problem:'원본 1단계 요약',data:'원본 2단계 요약'}};
 const records=new Map([[`users_${owner.projectId}/${owner.user.uid}/steps/alternatives`,{logs:saved,completed:true,summary:'기존 요약 보존'}]]);
 const oldKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='summary-fixture';t.after(()=>oldKey===undefined?delete process.env.OPENAI_API_KEY:process.env.OPENAI_API_KEY=oldKey);
 mock(t,project,'loadProjectContext',async()=>owner);
 const reads=[];
 const db={doc:path=>({path,get:async()=>{reads.push(path);return {data:()=>structuredClone(records.get(path))}}}),collection:path=>({where:(key,op,uid)=>{
  assert.equal(path,`ppssGeneratedImages_${owner.projectId}`);assert.equal(key,'userId');assert.equal(op,'==');assert.equal(uid,owner.user.uid);
  return {get:async()=>{if(failRead)throw Error('fixture unavailable');return {docs:images.filter(image=>image.userId===uid).map(image=>({id:image.imageId,data:()=>structuredClone(image)}))}}};
 }})};
 mock(t,admin,'adminDb',()=>db);
 for(const direction of directions)records.set(designServer.designRef(owner.projectId,owner.user.uid,`revision:${direction.revision}`).path,{direction:structuredClone(direction)});
 if(directions.length)records.set(designServer.designRef(owner.projectId,owner.user.uid,'direction').path,{direction:structuredClone(directions.at(-1))});
 const before=JSON.stringify([...records]);let calls=0,sent;
 mock(t,llm,'callLLM',()=>assert.fail('short design summaries need no additional LLM'));
 mock(t,global,'fetch',async(url,request)=>{assert.equal(url,'https://api.openai.com/v1/responses');calls++;sent={input:payload(request.body),prompt:JSON.parse(request.body).input};return finalReply('alternatives')});
 return {records,reads,owner,get sent(){return sent},get calls(){return calls},assertReadOnly(){assert.equal(JSON.stringify([...records]),before)}};
}
const generated=(id,version,editRequest)=>({imageId:id,userId:'completion-user',createdAt:`2026-11-0${version+1}`,label:version?'수정 이미지':'초기 이미지',note:version?`선택 부분 수정 의도: ${editRequest}`:'골목 입구 보행자 우선 표시, 아울렛 슈퍼 앞 조명 보강, 녹지·쉼터 및 간판 정돈',downloadUrl:'https://private.example/image.png',designMetadata:{versionNumber:version,rootImageId:'image-0',parentImageId:version?'image-'+(version-1):null,directionRevision:'initial',editRequest}});

test('Stage 3 summary enriches sparse chat with initial stored direction and prompt, preserving authorship and JSON contract',async t=>{
 const f=designSetup(t,{images:[generated('image-0',0),{...generated('foreign',0),userId:'another-user',note:'다른 참여자의 비공개 설계'}]});
 const result=await run('alternatives');assert.equal(result.status,200);assert.equal(f.calls,1);
 const data=f.sent.input;assert.equal(data.designRecords.directions[0].interventions.length,4);assert.equal(data.designRecords.directions[0].interventions[1].origin,'participant');
 assert.match(data.designRecords.images[0].generationOrEditPrompt,/아울렛 슈퍼/);assert.equal(data.designRecords.visualInspectionPerformed,false);
 assert.doesNotMatch(JSON.stringify(data),/다른 참여자의 비공개|private.example/);assert.equal(data.dialogue.length,1);
 assert.match(f.sent.prompt,/not the activity of asking for or generating images/);assert.match(f.sent.prompt,/1–3 natural paragraphs/);assert.match(f.sent.prompt,/not resident authorship of every AI detail/);
 assert.deepEqual(Object.keys(result.body.workspaceSummary.stageSummaries),stages);f.assertReadOnly();
});
test('one masked edit preserves the maintenance concern as a request rather than a verified result',async t=>{
 const f=designSetup(t,{images:[generated('image-0',0),generated('image-1',1,concern)],saved:[{sender:'assistant',text:`부분 수정 요청: ${concern}\n수정본을 추가했어요.`}]});
 assert.equal((await run('alternatives')).status,200);const data=f.sent.input;
 assert.equal(data.designRecords.images[1].editRequest,concern);assert.equal(data.designRecords.images[1].parentImageId,'image-0');assert.equal(data.designRecords.visualInspectionPerformed,false);
 assert.equal(data.dialogue[0].role,'assistant');assert.match(f.sent.prompt,/NOT that its pixels satisfy the request/);assert.match(f.sent.prompt,/assistant success notices are not visual analysis/);f.assertReadOnly();
});
test('multiple image versions retain chronological edit reasons and the initial direction after later direction changes',async t=>{
 const revised={...initialDirection,revision:'later',interventions:[{text:'관리 부담이 적은 녹지 구성',origin:'ai',basis:'유지관리 우려'}]};
 const last=generated('image-2',2,'조명은 유지하고 화분만 줄여주세요');last.designMetadata.directionRevision='later';
 const f=designSetup(t,{directions:[initialDirection,revised],images:[last,generated('image-1',1,concern),generated('image-0',0)],saved:[{sender:'user',text:concern},{sender:'user',text:'조명은 유지하고 화분만 줄여주세요'}]});
 assert.equal((await run('alternatives')).status,200);
 assert.deepEqual(f.sent.input.designRecords.images.map(image=>image.imageId),['image-0','image-1','image-2']);
 assert.deepEqual(f.sent.input.designRecords.directions.map(direction=>direction.revision),['initial','later']);assert.equal(f.calls,1);f.assertReadOnly();
});
test('legacy image notes omitted from text-only chat context are restored as design intent without creating resident opinions',async t=>{
 const f=designSetup(t,{directions:[],saved:[{sender:'assistant',text:'이미지를 만들었어요.',imageId:'old',imageNote:'보행등 보강 및 간판 정돈',imageUrl:'https://private.example/legacy.png'}]});
 assert.equal((await run('alternatives')).status,200);const data=f.sent.input;
 assert.equal(data.designRecords.images[0].source,'saved-chat-image-note');assert.equal(data.designRecords.images[0].generationOrEditPrompt,'보행등 보강 및 간판 정돈');
 assert.deepEqual(data.dialogue,[{role:'assistant',content:'이미지를 만들었어요.'}]);assert.doesNotMatch(JSON.stringify(data),/private.example/);f.assertReadOnly();
});
test('image generation records without design descriptions remain explicitly unverified instead of fabricating spatial interventions',async t=>{
 const f=designSetup(t,{directions:[],images:[{imageId:'url-only',userId:'completion-user',downloadUrl:'https://private.example/image.png'}]});
 assert.equal((await run('alternatives')).status,200);const data=f.sent.input.designRecords;
 assert.deepEqual(data.directions,[]);assert.equal(data.images[0].generationOrEditPrompt,undefined);assert.equal(data.visualInspectionPerformed,false);
 assert.match(f.sent.prompt,/if only activity records or image URLs exist, state the actual information limit/);f.assertReadOnly();
});
test('design record read failures stop an incomplete summary and never write to source research data',async t=>{
 const f=designSetup(t,{failRead:true});assert.equal((await run('alternatives')).status,500);assert.equal(f.calls,0);f.assertReadOnly();
});


test('missing generated-image prompts reuse legacy chat notes without duplicate images',async t=>{
 const f=designSetup(t,{directions:[],images:[{imageId:'legacy-record',userId:'completion-user',note:''}],saved:[{sender:'assistant',text:'생성했습니다',imageId:'legacy-record',imageNote:'보행등 보강과 화분 정리'}]});
 assert.equal((await run('alternatives')).status,200);
 assert.equal(f.sent.input.designRecords.images.length,1);assert.equal(f.sent.input.designRecords.images[0].generationOrEditPrompt,'보행등 보강과 화분 정리');f.assertReadOnly();
});
