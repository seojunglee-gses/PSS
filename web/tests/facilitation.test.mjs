import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(path.join(process.env.PSS_TEST_BUILD,'test.js')),load=p=>require(path.join(process.env.PSS_TEST_BUILD,p));
const {followUpPolicy,facilitationInstructions,gisReflection,policyHistory,summaryAttributionRules}=load('lib/facilitation.js');
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
function mock(t,obj,key,value){const previous=obj[key];obj[key]=value;t.after(()=>obj[key]=previous)}
test('A: simple facts and direct-only requests do not invite a planning survey',()=>{
 for(const q of ['면적이 얼마야?','타워는 어디야?','두 시설까지 몇 미터야?','What is the distance?','답변만 해주세요','Just answer the question.','여기까지만 할게요','그만할게요','요약만 해주세요','No, thanks','네','감사합니다','OK' ])assert.equal(followUpPolicy(q).mode,'none',q);
});
test('B: vague concerns prompt one open clarification without forced categories or early solutions',()=>{
 assert.equal(followUpPolicy('우리 동네가 불편해요.').mode,'clarify');const prompt=facilitationInstructions('problem','우리 동네가 불편해요.');assert.match(prompt,/ONE/);assert.match(prompt,/without forcing predefined categories/);assert.match(prompt,/before proposing solutions/);
});
test('C: GIS reflection requires verified values and an actual planning concern, never a new model call',()=>{
 const q='타워에서 전파기지까지 얼마나 걸려? 이동할 때 불편해요.';
 assert.equal(gisReflection(q,[],false,'ko'),'');assert.equal(gisReflection('두 시설까지 몇 미터야?',[],true,'ko'),'');
 const reflection=gisReflection(q,[],true,'ko');assert.ok(reflection.endsWith('?'));assert.equal(reflection.match(/\?/g).length,1);assert.equal(gisReflection(q,[assistant(reflection)],true,'ko'),'');
});
test('D/E/I: experiences, dissent and competing interests are never treated as verified data or consent',()=>{
 for(const stage of ['problem','data','alternatives','evaluation','report']){const p=facilitationInstructions(stage,'나는 그 제안에 반대해요.');assert.match(p,/participant statements/);assert.match(p,/Silence, a brief acknowledgment/);assert.match(p,/not community consensus/);assert.match(p,/do not pressure/i)}
 assert.match(facilitationInstructions('alternatives','내 아이디어를 발전시켜줘'),/preserve their explicitly stated design preferences/);assert.match(facilitationInstructions('evaluation','대안을 비교해줘'),/Do not steer/);assert.match(facilitationInstructions('report','의견이 달라요'),/Disagreement is legitimate/);assert.match(summaryAttributionRules,/minority views/);
});
test('F/G: refusals and prior reflection survive the bounded conversation window and can be explicitly changed',()=>{
 const logs=[{sender:'user',text:'앞으로 후속 질문은 하지 마세요.'},...Array.from({length:30},(_,i)=>({sender:'user',text:`추가 설명 ${i}`}))];
 const history=policyHistory(logs,[user('기록을 정리해줘')]);assert.equal(followUpPolicy('개선 가능성은?',history).mode,'none');assert.notEqual(followUpPolicy('이제 질문해도 괜찮아요',history).mode,'none');
 assert.equal(followUpPolicy('이동할 때 불편해요',[assistant('어떤 상황에서 불편하신가요?')]).mode,'none');
 const reflection=gisReflection('거리가 불편해요',[],true,'ko');assert.equal(gisReflection('이동이 불편해요',policyHistory([{sender:'assistant',text:'지도에서 결과를 확인하세요.\n'+reflection}]),true,'ko'),'');
});
test('shared chat integrates stage guidance once while preserving original history and response content',async t=>{
 const context=load('lib/project-context-server.js'),llm=load('lib/llm/index.js');let count=0,input;
 mock(t,context,'loadProjectContext',async()=>({currentMaterial:'사업 원자료',previousSummaries:{},stageHistory:[{sender:'user',text:'질문은 하지 말아주세요'}]}));
 mock(t,llm,'callLLM',async request=>{count++;input=request;return '요청하신 설명입니다.'});
 const res={setHeader(){},status(n){this.code=n;return this},json(body){this.body=body}};
 await load('pages/api/chat.js').default({method:'POST',body:{message:'대안의 장단점을 설명해줘',stepId:'evaluation',history:[user('버스 이용이 불편해요')]},headers:{}},res);
 assert.equal(res.code,200);assert.equal(count,1);assert.match(input.systemText,/Adaptive follow-up policy: NONE/);assert.match(input.systemText,/compare alternatives/);assert.match(input.userText,/버스 이용이 불편/);assert.equal(res.body.reply,'요청하신 설명입니다.');
});
test('vague Data Analysis concerns can be clarified without inventing empty case/research findings',async t=>{
 const llm=load('lib/llm/index.js');let sent;
 mock(t,llm,'callLLM',async input=>{sent=input;return JSON.stringify({summary:'불편을 느끼고 계시는군요.',caseFindings:[],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'어떤 상황에서 가장 불편하신가요?',projectImplications:[],limitations:''})});
 const request={question:'우리 동네가 불편해요.',selectedSources:['project'],cases:[],projectContext:'',provider:'openai'},evidence={question:request.question,selectedSources:['project'],cases:[],papers:[],warnings:[]};
 const answer=await load('lib/research/answer.js').answerFromEvidence(request,evidence);assert.match(sent.systemText,/CLARIFY/);assert.equal(answer.researchFindings.length,0);assert.equal(answer.caseFindings.length,0);assert.match(answer.integratedInterpretation,/어떤 상황/);
});
test('workspace summary uses role-attributed dialogue, one existing model call and a reviewable draft schema',async t=>{
 const context=load('lib/project-context-server.js'),admin=load('lib/firebaseAdmin.js');let calls=0,sent;
 const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='summary-fixture';t.after(()=>prior===undefined?delete process.env.OPENAI_API_KEY:process.env.OPENAI_API_KEY=prior);
 mock(t,context,'loadProjectContext',async()=>({projectId:'p',user:{uid:'u'},currentMaterial:'사업 원자료',previousSummaries:{problem:'확인된 개인 관심'}}));
 mock(t,admin,'adminDb',()=>({doc:()=>({get:async()=>({data:()=>({logs:[{sender:'user',text:'주민 쉼터를 원해요'},{sender:'assistant',text:'주차장은 어떨까요?'}]})})})}));
 mock(t,global,'fetch',async(url,options)=>{calls++;sent=JSON.parse(options.body);return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({workspaceSummary:{stageSummaries:{problem:'참여자 관심: 주민 쉼터',data:'',alternatives:'',evaluation:'',report:''},overallSummary:'개인 초안'}})}]}]})});
 const res={setHeader(){},status(n){this.code=n;return this},json(body){this.body=body}};await load('pages/api/workspace-summary.js').default({method:'POST',body:{currentStage:'problem',workspaceInput:{problem:['unsafe unlabelled claim']}},headers:{}},res);
 assert.equal(res.code,200);assert.equal(calls,1);assert.equal(sent.model,'gpt-6.1-sol');assert.match(sent.input,/five short labeled sections/);assert.match(sent.input,/'?role'?/);assert.match(sent.input,/assistant/);assert.doesNotMatch(sent.input,/unsafe unlabelled claim/);assert.match(sent.input,/never attribute them to the participant/);
});
test('stage-end dialogue preserves early concerns, AI attribution and a bounded, explicitly incomplete scope',()=>{
 const {summaryDialogue}=load('lib/facilitation.js');const messages=[user('첫 관심: 쉼터'),assistant('AI 제안: 주차장'),...Array.from({length:45},(_,i)=>user(`경험 ${i}`))];const all=summaryDialogue(messages);assert.equal(all.messages[0].content,'첫 관심: 쉼터');assert.equal(all.messages[1].role,'assistant');assert.equal(all.truncated,false);const bounded=summaryDialogue([...messages,...messages]);assert.equal(bounded.truncated,true);assert.ok(bounded.messages.length<=60);assert.ok(bounded.messages.reduce((n,m)=>n+m.content.length,0)<=48000);
});
test('Stage 3 conversation does not generate images unless a design-generation/edit action is explicit',()=>{
 const {isDesignGenerationRequest}=load('lib/facilitation.js');for(const q of ['어르신과 어린이가 함께 쓸 공간을 고민하고 있어요.','두 대안의 장단점은?','계획안을 어떻게 수정하면 좋을까요?','이 문장을 수정해주세요','이미지는 만들지 말고 의견만 정리해주세요','Do not generate an image; discuss options'])assert.equal(isDesignGenerationRequest(q),false,q);
 for(const q of ['지금까지 나온 의견을 반영해 계획안을 정리해주세요.','이미지를 생성해주세요','벤치를 더 넣어줘','계획안을 수정해주세요','Generate a design alternative'])assert.equal(isDesignGenerationRequest(q),true,q);
});
