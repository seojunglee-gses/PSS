import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),load=p=>require(`${process.env.PSS_TEST_BUILD}/${p}`);
const {followUpPolicy,facilitationInstructions,policyHistory,stageSummaryInstructions}=load('lib/facilitation.js');
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const mock=(t,obj,key,value)=>{const old=obj[key];obj[key]=value;t.after(()=>obj[key]=old)};
const answer=()=>({summary:'나무를 심는 생각을 이어가되 걸을 자리를 남기는 방법을 함께 볼 수 있어요.',caseFindings:[],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'',projectImplications:[],limitations:'',sources:[]});

test('Data Analysis supports participant-led development without a compulsory intervention list or final design',()=>{
 const prompt=facilitationInstructions('data','길가에 나무를 많이 심었으면 좋겠어요.');
 for(const word of ['EXPLORE','INFORM','APPLY','COMPARE','DEVELOP'])assert.ok(prompt.includes(word));
 assert.match(prompt,/engage with that idea first/);assert.match(prompt,/no required number of turns or solutions/);
 assert.match(prompt,/Ordinary turns generally use 2–3 short sentences/);assert.match(prompt,/Do not rank options.*unless explicitly requested/);
 assert.match(prompt,/Participants may suggest specific locations, facilities and provisional spatial arrangements/);
 assert.match(prompt,/Do not finalize exact dimensions/);assert.match(prompt,/even when GIS cannot resolve the name/);
 assert.match(prompt,/unless that operation actually succeeded/);assert.doesNotMatch(prompt,/offer 2–4 plausible|350–650|end with ONE concrete local-observation question/);
 for(const stage of ['problem','alternatives','evaluation','report'])assert.doesNotMatch(facilitationInstructions(stage,'나무를 심고 싶어요.'),/EXPLORE \(offer a small/);
});

test('follow-ups advance the existing idea, including after a question, with factual and closure exceptions',()=>{
 const history=[user('주차 공간 일부를 정원으로 바꾸고 싶어요.'),assistant('그곳은 평소 주차가 많이 필요한 곳인가요?')];
 for(const text of ['거기는 차가 많이 주차되어 있어요.','나무를 어디에 심으면 좋을까요?','저는 길가에 나무를 많이 심었으면 좋겠어요.','네'])assert.equal(followUpPolicy(text,history,'data').mode,'optional',text);
 assert.match(followUpPolicy('차가 많이 주차되어 있어요.',history,'data').reason,/materially help adapt, compare or develop/);
 for(const text of ['이 공원 면적은 얼마야?','논문은 언제 나왔어?','지금까지 이야기 정리해줘','감사합니다','오늘은 여기까지만','질문 없이 답변만 해줘'])assert.equal(followUpPolicy(text,history,'data').mode,'none',text);
});

test('one-turn direct requests do not disable later Data Analysis facilitation; persistent refusals do',()=>{
 const once=[user('요약만 해주세요.'),assistant('지금까지의 이야기입니다.')];
 assert.equal(followUpPolicy('나무 그늘이 있으면 좋겠어요.',once,'data').mode,'optional');
 const saved=once.map(m=>({sender:m.role,text:m.content}));
 assert.equal(followUpPolicy('나무 그늘이 있으면 좋겠어요.',policyHistory(saved,[],'data'),'data').mode,'optional');
 const persistent=[user('앞으로 질문하지 마세요.')];
 assert.equal(followUpPolicy('나무 그늘이 있으면 좋겠어요.',persistent,'data').mode,'none');
 assert.equal(followUpPolicy('다시 질문해도 괜찮아요',persistent,'data').mode,'optional');
});

test('Data Analysis synthesis preserves earlier concerns, located ideas and their evolution without adopted decisions',()=>{
 const prompt=stageSummaryInstructions('data');
 for(const value of ['Problem Definition','participant-suggested places','supplied spatial results','case/research lessons','revised or rejected','emerging directions','not seven required sections','not geographically verified','do not infer preferences, agreement, feasibility, consensus'])assert.ok(prompt.includes(value),value);
});

test('answer generation uses local history/evidence in accessible Korean while keeping exact citation validation',async t=>{
 const llm=load('lib/llm/index.js'),{answerFromEvidence}=load('lib/research/answer.js');
 const request={question:'그럼 나무를 심는 방법은 어때요?',selectedSources:['cases'],projectContext:'사업 자료: 기존 길을 이용한다.',previousSummaries:{problem:'사용자는 아이들이 안전하게 걷는 길을 중요하게 여겼다.'},provider:'openai',cases:[],history:[user('나무를 심고 싶어요.'),assistant('보행 공간도 남기는 것이 좋겠어요.')]};
 const evidence={question:request.question,selectedSources:['cases'],cases:[{id:'fixture',sourceId:'C:1',label:'사례',title:'Original Publication Title',text:'A planting strip was installed.',relevanceTerms:[]}],papers:[],warnings:[]};
 mock(t,llm,'callLLM',async req=>{
  assert.match(req.systemText,/accessible Korean/);assert.match(req.systemText,/Preserve original publication\/project titles/);
  assert.doesNotMatch(req.systemText,/finish integratedInterpretation with/);assert.match(req.systemText,/participant already proposes an idea/);
  assert.match(req.systemText,/ABSTRACT-BASED/);assert.match(req.systemText,/exact supplied C: passage/);
  const data=JSON.parse(req.userText);assert.equal(data.previousStageSummaries.problem,request.previousSummaries.problem);assert.equal(data.history[0].content,'나무를 심고 싶어요.');
  return JSON.stringify({...answer(),summary:'이 사례에서는 식재 공간을 만들었어요. [C:1] 나무를 심는 생각을 걸을 자리와 함께 살펴볼 수 있어요.'});
 });
 const result=await answerFromEvidence(request,evidence);assert.equal(result.sources[0].title,'Original Publication Title');assert.match(result.summary,/\[C:1\]/);
 mock(t,llm,'callLLM',async()=>JSON.stringify({...answer(),summary:'가짜 근거 [C:999]'}));
 await assert.rejects(()=>answerFromEvidence(request,evidence),/unsupported source reference/);
});

test('the API uses this participant’s saved Data Analysis dialogue and previous summary rather than stale client history',async t=>{
 const context=load('lib/project-context-server.js'),retrieval=load('lib/research/evidence.js'),answers=load('lib/research/answer.js');
 const saved=[{stepId:'problem',sender:'user',text:'다른 단계 원문'}, {stepId:'data',sender:'user',text:'기존 보행로를 남기며 나무를 심고 싶어요.'}, {stepId:'data',sender:'assistant',text:'주차를 어떻게 이용하고 계신가요?'}, {stepId:'data',sender:'user',text:'거기는 차가 많이 주차되어 있어요.'}];
 mock(t,context,'loadProjectContext',async()=>({projectId:'p',user:{uid:'u'},stageHistory:saved,cases:[],currentMaterial:'프로젝트 자료',previousSummaries:{problem:'보행 안전이 우선'}}));
 mock(t,retrieval,'retrieveEvidence',async req=>{assert.equal(req.history.length,2);assert.equal(req.history[0].content,saved[1].text);assert.equal(req.previousSummaries.problem,'보행 안전이 우선');assert.doesNotMatch(JSON.stringify(req.history),/다른 단계|stale/);return {question:req.question,selectedSources:req.selectedSources,cases:[],papers:[],warnings:[]}});
 mock(t,answers,'answerFromEvidence',async()=>answer());
 const res={setHeader(){},status(n){this.code=n;return this},json(body){this.body=body}};
 await load('pages/api/research/answer.js').default({method:'POST',headers:{},body:{question:saved.at(-1).text,selectedSources:['project'],history:[user('stale client discussion')]}},res);
 assert.equal(res.code,200);assert.ok(res.body.analysis.answer);
});

test('Korean evidence labels localize page explanation while retaining original bibliographic metadata',t=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),i18n=load('lib/i18n.js'),Evidence=load('components/analysis/EvidencePanel.js').default;
 mock(t,i18n,'useI18n',()=>({locale:'ko',t:(key,values)=>i18n.translate('ko',key,values)}));
 const item={id:'case',sourceId:'C:1',label:'사례',title:'Original Case Title',fileName:'original-report.pdf',page:18,text:'Original excerpt.',relevanceTerms:[]};
 const evidence={question:'내용은?',selectedSources:['cases'],cases:[item],papers:[],warnings:[]};
 const html=renderToStaticMarkup(React.createElement(Evidence,{evidence,enabled:['cases'],loading:false,highlighted:null}));
 assert.match(html,/18쪽/);assert.match(html,/핵심 근거/);assert.match(html,/Original Case Title/);assert.match(html,/original-report.pdf/);
 const guide=load('lib/stage-chat-guides.js').stageChatGuide('data','ko','public');
 assert.match(guide.description,/지난 단계/);assert.match(guide.description,/정확한 장소 이름을 몰라도/);assert.match(guide.description,/편하게 이야기/);
});
