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
test('B: vague concerns retain a clarification option without forced categories or early solutions',()=>{
 assert.equal(followUpPolicy('우리 동네가 불편해요.').mode,'clarify');const prompt=facilitationInstructions('problem','우리 동네가 불편해요.');assert.match(prompt,/ONE/);assert.match(prompt,/without forcing predefined categories/);assert.match(prompt,/without deciding the problem or solution/);
});
test('Problem Definition interprets before questioning and permits synthesis without a closing question',()=>{
 const history=[assistant('어느 장소에서 불편을 겪으셨나요?'),user('시장 앞 골목이요.')];
 const prompt=facilitationInstructions('problem','저녁에 퇴근할 때 자주 지나가요.',history);
 assert.match(prompt,/Adaptive follow-up policy: OPTIONAL/);assert.match(prompt,/1–3 short sentences/);assert.match(prompt,/Interpretation before questioning/);assert.match(prompt,/OPTIONAL and CLARIFY permit zero questions/);assert.match(prompt,/Never ask again for information/);assert.match(prompt,/would its answer materially change or refine/);assert.doesNotMatch(prompt,/end with exactly ONE/);
 assert.equal(followUpPolicy('저녁에 퇴근할 때 자주 지나가요.',history,'data').mode,'none');
 for(const q of ['답변만 해주세요','면적이 얼마야?','오늘은 여기까지만 할게요','감사합니다'])assert.equal(followUpPolicy(q,history,'problem').mode,'none',q);
 assert.equal(followUpPolicy('그 골목이 어두워요.',[user('앞으로 후속 질문은 하지 마세요.')],'problem').mode,'none');
});
test('Problem Definition chat applies conversational cadence in the existing single response call',async t=>{
 const context=load('lib/project-context-server.js'),llm=load('lib/llm/index.js');let calls=0,sent;
 mock(t,context,'loadProjectContext',async()=>({currentMaterial:'현재 사업: 시장 주변 보행환경',previousSummaries:{},stageHistory:[]}));
 const reply='퇴근길의 보행 경험을 사업에서 살펴볼 문제와 연결해볼 수 있겠습니다. 어떤 변화가 생기면 이 길을 이용하기 좋아졌다고 느끼실까요?';
 mock(t,llm,'callLLM',async input=>{calls++;sent=input;return reply});
 const res={status(n){this.code=n;return this},json(body){this.body=body}};
 await load('pages/api/chat.js').default({method:'POST',body:{stepId:'problem',message:'퇴근길에 시장 앞 골목을 지나가요.',history:[assistant('주로 어느 길을 이용하시나요?')]},headers:{}},res);
 assert.equal(res.code,200);assert.equal(calls,1);assert.equal(res.body.reply,reply);assert.match(sent.systemText,/Adaptive follow-up policy: OPTIONAL/);assert.match(sent.userText,/시장 주변 보행환경/);assert.match(sent.userText,/주로 어느 길/);
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
 const answer=await load('lib/research/answer.js').answerFromEvidence(request,evidence);assert.match(sent.systemText,/CLARIFY/);assert.equal(answer.researchFindings.length,0);assert.equal(answer.caseFindings.length,0);assert.match(answer.summary,/어떤 상황/);assert.equal(answer.format,"direct");
});
test('workspace summary uses role-attributed dialogue, one existing model call and a reviewable draft schema',async t=>{
 const context=load('lib/project-context-server.js'),admin=load('lib/firebaseAdmin.js');let calls=0,sent;
 const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='summary-fixture';t.after(()=>prior===undefined?delete process.env.OPENAI_API_KEY:process.env.OPENAI_API_KEY=prior);
 mock(t,context,'loadProjectContext',async()=>({projectId:'p',user:{uid:'u'},currentMaterial:'사업 원자료',previousSummaries:{problem:'확인된 개인 관심'}}));
 mock(t,admin,'adminDb',()=>({doc:()=>({get:async()=>({data:()=>({logs:[{sender:'user',text:'주민 쉼터를 원해요'},{sender:'assistant',text:'주차장은 어떨까요?'}]})})})}));
 mock(t,global,'fetch',async(url,options)=>{calls++;sent=JSON.parse(options.body);return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({workspaceSummary:{stageSummaries:{problem:'참여자 관심: 주민 쉼터',data:'',alternatives:'',evaluation:'',report:''},overallSummary:'개인 초안'}})}]}]})});
 const res={setHeader(){},status(n){this.code=n;return this},json(body){this.body=body}};await load('pages/api/workspace-summary.js').default({method:'POST',body:{currentStage:'problem',workspaceInput:{problem:['unsafe unlabelled claim']}},headers:{}},res);
 assert.equal(res.code,200);assert.equal(calls,1);assert.equal(sent.model,'gpt-6.1-sol');assert.match(sent.input,/participant-centered planning synthesis/);assert.match(sent.input,/not a mandatory five-section template/);assert.match(sent.input,/Problem Definition: emphasize problem framing/);assert.match(sent.input,/'?role'?/);assert.match(sent.input,/assistant/);assert.doesNotMatch(sent.input,/unsafe unlabelled claim/);assert.match(sent.input,/never attribute them to the participant/);
});
test('stage-end dialogue preserves early concerns, AI attribution and a bounded, explicitly incomplete scope',()=>{
 const {summaryDialogue}=load('lib/facilitation.js');const messages=[user('첫 관심: 쉼터'),assistant('AI 제안: 주차장'),...Array.from({length:45},(_,i)=>user(`경험 ${i}`))];const all=summaryDialogue(messages);assert.equal(all.messages[0].content,'첫 관심: 쉼터');assert.equal(all.messages[1].role,'assistant');assert.equal(all.truncated,false);const bounded=summaryDialogue([...messages,...messages]);assert.equal(bounded.truncated,true);assert.ok(bounded.messages.length<=60);assert.ok(bounded.messages.reduce((n,m)=>n+m.content.length,0)<=48000);
});
test('Stage 3 conversation does not generate images unless a design-generation/edit action is explicit',()=>{
 const {isDesignGenerationRequest}=load('lib/facilitation.js');for(const q of ['어르신과 어린이가 함께 쓸 공간을 고민하고 있어요.','두 대안의 장단점은?','계획안을 어떻게 수정하면 좋을까요?','이 문장을 수정해주세요','이미지는 만들지 말고 의견만 정리해주세요','Do not generate an image; discuss options'])assert.equal(isDesignGenerationRequest(q),false,q);
 for(const q of ['지금까지 나온 의견을 반영해 계획안을 정리해주세요.','이미지를 생성해주세요','벤치를 더 넣어줘','계획안을 수정해주세요','Generate a design alternative'])assert.equal(isDesignGenerationRequest(q),true,q);
});

test('Problem Definition varies repeated questions without blocking useful continuation or other stages',()=>{
 const history=[user('주민들이 모일 공간이 부족해요.'),assistant('교류할 기회가 줄어드는 문제일 수 있겠습니다. 무엇이 가장 중요한가요?'),user('서로 알고 지내는 관계가 중요해요.'),assistant('일상적인 관계를 유지하는 데 의미를 두시는군요. 어떤 변화가 필요할까요?')];
 assert.equal(followUpPolicy('기존 주민센터가 저녁에도 열리면 좋겠어요.',history,'problem').mode,'optional');
 const prompt=facilitationInstructions('problem','기존 주민센터가 저녁에도 열리면 좋겠어요.',history);
 assert.match(prompt,/avoid repeating that interview pattern/);assert.match(prompt,/converge without another question/);assert.match(prompt,/no number of turns establishes sufficient evidence or consent/);
 assert.notEqual(followUpPolicy('이제 질문해도 괜찮아요',history,'problem').mode,'none');
 assert.equal(followUpPolicy('더 질문해줘',[user('질문하지 마세요')],'problem').mode,'optional');
 assert.equal(followUpPolicy('핵심 문제를 정리해줘',[],'problem').mode,'none');
 for(const stage of ['data','alternatives','evaluation','report']){
  const other=facilitationInstructions(stage,'우리 동네가 불편해요.');
  assert.doesNotMatch(other,/reflective and critical thinking partner|Progressive problem definition|INTERPRET/);
 }
});
test('A–D initial contributions receive contextual interpretation guidance rather than fixed interview questions',async t=>{
 const context=load('lib/project-context-server.js'),llm=load('lib/llm/index.js');let calls=[];
 mock(t,context,'loadProjectContext',async()=>({currentMaterial:'현재 사업: 주민 생활환경 개선. 시설 이용 현황은 아직 조사되지 않았음.',previousSummaries:{},stageHistory:[]}));
 mock(t,llm,'callLLM',async request=>{calls.push(request);return '잠정적인 해석입니다.'});
 for(const message of ['우리 동네는 주민들이 모일 공간이 부족해요.','이 지역은 노인들이 살기 불편한 것 같아요.','청년들이 이 동네를 떠나는 게 가장 큰 문제라고 생각해요.','공원을 새로 만드는 게 좋을 것 같아요.']){
  const res={status(n){this.code=n;return this},json(value){this.body=value}};
  await load('pages/api/chat.js').default({method:'POST',body:{stepId:'problem',message,history:[]},headers:{}},res);
  assert.equal(res.code,200);assert.ok(calls.at(-1).userText.includes(message));
 }
 assert.equal(calls.length,4);
 for(const request of calls){assert.match(request.systemText,/REFLECT.*REFRAME.*SYNTHESIZE.*PRIORITIZE/);assert.match(request.systemText,/Explicitly mark your interpretation/);assert.match(request.systemText,/unnecessary personal data/);assert.match(request.systemText,/chosen solution without dismissing/);}
});
test('synthesis retains original dialogue, user corrections, project grounding and the existing response API',async t=>{
 const context=load('lib/project-context-server.js'),llm=load('lib/llm/index.js');let count=0,sent;
 mock(t,context,'loadProjectContext',async()=>({currentMaterial:'사업 자료: 주민센터가 있음. 운영 시간은 미확인.',previousSummaries:{},stageHistory:[]}));
 mock(t,llm,'callLLM',async request=>{count++;sent=request;return '핵심 문제: 시설 신설보다 기존 공간을 이용할 기회에 관한 문제일 수 있습니다.'});
 const history=[user('공간이 부족해요'),assistant('새 시설이 필요할 수 있겠습니다.'),user('새 시설을 원하는 것은 아니고, 저녁에도 기존 시설을 이용하고 싶어요.')];
 const res={status(n){this.code=n;return this},json(value){this.body=value}};
 await load('pages/api/chat.js').default({method:'POST',body:{stepId:'problem',message:'지금까지 얘기한 핵심 문제를 정리해줘',history},headers:{}},res);
 assert.equal(count,1);assert.equal(res.code,200);assert.deepEqual(Object.keys(res.body).sort(),['model','provider','reply']);
 assert.match(sent.systemText,/Adaptive follow-up policy: NONE/);assert.match(sent.systemText,/revise or discard your previous hypotheses/);
 for(const name of ['Core Problem','Context','Potential Causes','Stakeholders','User Priorities','Unverified Assumptions'])assert.ok(sent.systemText.includes(name));
 assert.match(sent.userText,/새 시설을 원하는 것은 아니고/);assert.match(sent.userText,/운영 시간은 미확인/);
 assert.match(sent.systemText,/not yet stated or not verified/);assert.match(sent.systemText,/not stage completion or a saved report/);
});

test('Problem Definition turn-only requests do not become permanent question bans through saved history',()=>{
 const saved=[{sender:'user',text:'요약만 해주세요.'},{sender:'assistant',text:'지금까지 논의한 내용입니다.'}];
 const recent=[user('요약만 해주세요.'),assistant('지금까지 논의한 내용입니다.')];
 const history=policyHistory(saved,recent,'problem');
 assert.equal(followUpPolicy('이웃과 자연스럽게 만나는 공간이면 좋겠어요.',history,'problem').mode,'optional');
 assert.equal(followUpPolicy('요약만 해주세요.',[],'problem').mode,'none');
 assert.equal(followUpPolicy('계속 답변만 해주세요.',[],'problem').mode,'none');
 const stopped=policyHistory([{sender:'user',text:'앞으로는 답변만 해주세요.'}],[],'problem');
 assert.equal(followUpPolicy('이웃과 만나고 싶어요.',stopped,'problem').mode,'none');
 assert.equal(followUpPolicy('다시 질문해도 괜찮아요',stopped,'problem').mode,'optional');
 assert.equal(followUpPolicy('이웃과 만나고 싶어요.',policyHistory(saved),'data').mode,'none');
});
test('Problem Definition distinguishes a planning opinion from a factual question and an active reply from closure',()=>{
 for(const q of ['거리보다 편하게 머무는 게 중요해요.','어디든 쉴 수 있는 공간이 있으면 좋겠어요.'])assert.equal(followUpPolicy(q,[],'problem').mode,'optional');
 for(const q of ['거리가 얼마야?','시설은 어디에 있어요?','감사합니다','여기까지만 할게요'])assert.equal(followUpPolicy(q,[],'problem').mode,'none');
 assert.equal(followUpPolicy('네',[user('여러 세대가 함께 쓰면 좋겠어요.'),assistant('함께 이용하는 공간을 생각해볼 수 있겠습니다.')],'problem').mode,'optional');
 assert.equal(followUpPolicy('네',[user('앞으로 질문하지 마세요.')],'problem').mode,'none');
});
test('the reported resident-goals comparison reaches the model with a concrete conversational hand-off',async t=>{
 const context=load('lib/project-context-server.js'),llm=load('lib/llm/index.js');let sent,calls=0;
 mock(t,context,'loadProjectContext',async()=>({currentMaterial:'사업 목표는 녹지·휴식공간 확충과 환경 회복입니다. 주민 의견수렴 결과는 등록되지 않았습니다.',previousSummaries:{},stageHistory:[{sender:'user',text:'요약만 해주세요.'}]}));
 mock(t,llm,'callLLM',async request=>{sent=request;calls++;return '사업의 공간 개선 목표와 주민이 체감하는 보행 안전은 판단 기준이 다를 수 있겠습니다. 보행 안전에서 어떤 변화가 가장 중요할까요?';});
 const question='주민의 요구와 행정의 목표가 다른 부분은 무엇일까요?';
 const res={status(n){this.code=n;return this},json(value){this.body=value}};
 await load('pages/api/chat.js').default({method:'POST',body:{stepId:'problem',message:question,history:[user('보행자가 차를 피해서 다녀야 하는 게 불편해요.')]},headers:{}},res);
 assert.equal(res.code,200);assert.equal(calls,1);assert.match(sent.systemText,/Adaptive follow-up policy: OPTIONAL/);
 assert.match(sent.systemText,/Conversational hand-off/);assert.match(sent.systemText,/ONE concrete next aspect/);
 assert.match(sent.systemText,/A new observation followed only by a full stop/);
 assert.ok(sent.userText.includes(question));assert.match(sent.userText,/보행자가 차를 피해서/);assert.match(sent.userText,/의견수렴 결과는 등록되지 않았/);
 assert.match(sent.systemText,/Individual views are not community consensus/);
});

test('stage summaries use flexible themes, distinct stage focuses and evidence-aware attribution',()=>{
 const {stageSummaryInstructions}=load('lib/facilitation.js');
 assert.match(summaryAttributionRules,/participant-centered planning synthesis rather than a rigid conversation summary/);
 assert.match(summaryAttributionRules,/Preserve relevant specific locations, experiences, preferences, priorities, corrections and disagreements/);
 assert.match(summaryAttributionRules,/valuable planning inputs in their own right/);
 assert.match(summaryAttributionRules,/Omit empty categories/);assert.match(summaryAttributionRules,/brief, natural attribution/);
 assert.match(summaryAttributionRules,/This request does not itself run new searches/);
 assert.match(summaryAttributionRules,/only when it materially affects a planning decision/);
 assert.doesNotMatch(summaryAttributionRules,/with five short labeled sections|one or two concise sentences each/);
 const focus=['problem','data','alternatives','evaluation','report'].map(stageSummaryInstructions);
 assert.equal(new Set(focus).size,5);
 for(const [index,pattern]of [/problem framing/,/changes in the initial understanding/,/design possibilities evolved/,/trade-offs/,/decision rationale/].entries())assert.match(focus[index],pattern);
});
test('all five summary stages retain the JSON contract and natural prose with optional participant perspective',async t=>{
 const context=load('lib/project-context-server.js'),admin=load('lib/firebaseAdmin.js');let current;
 const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='summary-fixture';t.after(()=>prior===undefined?delete process.env.OPENAI_API_KEY:process.env.OPENAI_API_KEY=prior);
 mock(t,context,'loadProjectContext',async()=>({projectId:'p',user:{uid:'u'},currentMaterial:'시장 옆 골목이 사업 대상지입니다. 통행 규정은 제공되지 않았습니다.',previousSummaries:{problem:'참여자는 퇴근길 휴식과 보행을 중요하게 봄'}}));
 const dialogue=[{sender:'user',text:'시장 옆 골목에서 퇴근 후 쉬고 싶어요.'},{sender:'assistant',text:'공용 카페도 가능성이 될 수 있겠습니다.'},{sender:'user',text:'카페보다는 돈을 쓰지 않아도 머무는 공간을 원해요.'}];
 mock(t,admin,'adminDb',()=>({doc:()=>({get:async()=>({data:()=>({logs:dialogue})})})}));
 const paragraphs='시장 옆 골목에서 퇴근 후 비용 부담 없이 쉬는 기회를 중요하게 보았다. 카페 가능성을 논의했지만, 참여자는 소비하지 않아도 머물 수 있는 공간을 선호한다고 구체화했다.';
 mock(t,global,'fetch',async(url,options)=>{current=JSON.parse(options.body);const input=JSON.parse(current.input.split('Input JSON: ')[1].split('\n\nReturn JSON')[0]);return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({workspaceSummary:{stageSummaries:Object.fromEntries(['problem','data','alternatives','evaluation','report'].map(stage=>[stage,stage===input.currentStage?paragraphs:''])),overallSummary:paragraphs}})}]}]});});
 for(const stage of ['problem','data','alternatives','evaluation','report']){
  const res={status(n){this.code=n;return this},json(body){this.body=body}};
  await load('pages/api/workspace-summary.js').default({method:'POST',body:{currentStage:stage,participantPerspective:'일반 시민'},headers:{}},res);
  assert.equal(res.code,200);assert.equal(res.body.workspaceSummary.stageSummaries[stage],paragraphs);
  assert.deepEqual(Object.keys(res.body.workspaceSummary.stageSummaries),['problem','data','alternatives','evaluation','report']);
  assert.equal(current.model,'gpt-6.1-sol');assert.equal(current.text.format.type,'json_object');
  assert.match(current.input,/"participantPerspective":"일반 시민"/);assert.match(current.input,/카페보다는 돈을 쓰지 않아도/);
  assert.match(current.input,/never attribute them to the participant unless the participant explicitly adopted them/);
  assert.match(current.input,/five stage keys are storage slots/);assert.match(current.input,/Leave the other stage strings empty/);
  assert.match(current.input,/not stereotypes/);assert.match(current.input,/not independently revalidated evidence/);
 }
});

test('shared clarification behavior covers all conversation stages without overriding schemas or reflective cadence',()=>{
 for(const stage of ['problem','data','alternatives','evaluation','report']){
  const prompt=facilitationInstructions(stage,'어떤 안이 제일 좋아?');
  assert.equal(prompt.split('Shared conversation behavior:').length,2);assert.match(prompt,/Understand → Clarify if necessary → Act → Explain → Continue/);assert.match(prompt,/ONE short, user-friendly clarification/);assert.match(prompt,/recover the ORIGINAL task/);assert.match(prompt,/Clear requests need no clarification/);assert.match(prompt,/not an independent new question/);assert.match(prompt,/does not grant tools to a text-only endpoint/);assert.match(prompt,/preserve|Preserve/);assert.match(prompt,/Activity ≠ Analysis Result/);
 }
});

test('known material ambiguity asks once before search; clear context and direct execution stay unblocked',()=>{
 const {requestClarification}=load('lib/facilitation.js');
 const question='외국인 대상 가게가 몇 개 있어?';
 assert.match(requestClarification(question),/외국 음식점/);
 const h=[user(question),assistant(requestClarification(question))];
 assert.equal(requestClarification('음식점이나 식료품점 같은 거.',h),undefined);
 assert.equal(requestClarification('사업구역 안 음식점을 보여줘.'),undefined);
 assert.match(requestClarification('이런 사업이 효과가 있다는 연구 찾아줘.'),/어떤 효과/);
 assert.equal(requestClarification('이런 사업이 효과가 있다는 연구 찾아줘.',[user('보행환경 개선 효과를 알고 싶어요.')]),undefined);
 assert.equal(requestClarification('이런 사업이 효과가 있다는 연구 찾아줘.',[],'현재 사업은 보행환경 개선을 목표로 합니다.'),undefined);
 assert.match(requestClarification('이런 사업이 효과가 있다는 연구 찾아줘.',[],'보행환경과 지역상권, 녹지 개선을 검토합니다.'),/어떤 효과/);
});

test('all generic chat stages receive shared behavior through their existing single model response',async t=>{
 const context=load('lib/project-context-server.js'),llm=load('lib/llm/index.js');const calls=[];
 mock(t,context,'loadProjectContext',async()=>({currentMaterial:'현재 사업 자료',previousSummaries:{problem:'보행 편의를 중요하게 생각함'},stageHistory:[]}));
 mock(t,llm,'callLLM',async input=>{calls.push(input);return '어떤 두 지역을 비교할까요?'});
 for(const stepId of ['problem','data','alternatives','evaluation','report']){
  const res={status(n){this.code=n;return this},json(body){this.body=body}};
  await load('pages/api/chat.js').default({method:'POST',body:{stepId,message:'두 지역의 접근성을 비교해줘.',history:[]},headers:{}},res);
  assert.equal(res.code,200);assert.equal(res.body.reply,'어떤 두 지역을 비교할까요?');assert.match(calls.at(-1).systemText,/Shared conversation behavior/);assert.match(calls.at(-1).userText,/보행 편의/);
 }
 assert.equal(calls.length,5);
});

test('known clarification questions render as direct dialogue without report headings or invented evidence',async()=>{
 const research=load('lib/research/evidence.js'),answer=load('lib/research/answer.js');
 const request=research.parseAnalysisRequest({question:'이 거리에서 외국인대상 가게들이 많던데 몇개나 있어?'});
 const evidence=await research.retrieveEvidence(request);const result=await answer.answerFromEvidence(request,evidence);
 assert.equal(result.format,'direct');assert.deepEqual(result.sources,[]);assert.deepEqual(result.projectImplications,[]);assert.equal(evidence.projectContext,undefined);
});
