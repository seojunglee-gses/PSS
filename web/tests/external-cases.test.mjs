import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),build=process.env.PSS_TEST_BUILD;
const external=require(`${build}/lib/research/external-cases.js`),routing=require(`${build}/lib/research/routing.js`),llm=require(`${build}/lib/llm/index.js`),evidence=require(`${build}/lib/research/evidence.js`),papers=require(`${build}/lib/research/openalex.js`),answers=require(`${build}/lib/research/answer.js`),types=require(`${build}/lib/research/types.js`),follow=require(`${build}/lib/research/follow-up.js`),context=require(`${build}/lib/project-context-server.js`),caseSources=require(`${build}/lib/research/case-sources-server.js`),handler=require(`${build}/pages/api/research/answer.js`).default;
const mock=(t,obj,key,value)=>{const old=obj[key];obj[key]=value;t.after(()=>obj[key]=old)};
const input=(question,extra={})=>({question,selectedSources:['cases'],cases:[],projectContext:'회복의 숲길: 주거지 골목, 유지관리 인력이 부족함. 예산은 확인되지 않음.',provider:'openai',history:[],...extra});
const sourceUrl='https://parks.example.gov/community-garden';
const entry=(extra={})=>({title:'공공 텃밭',publisher:'시 공원관리국',url:sourceUrl,sourceType:'government',evidenceLevel:'page',location:'도시 A',problem:'지속 관리',method:'관리 계약',management:'공원관리국과 계약 조직',outcomes:'유지관리 개선 보고',conditions:'예산 확보 필요',quote:'The parks department maintains the community garden.',...extra});
const response=(cases=[entry()],opened=true)=>({status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{url:sourceUrl}]}},...(opened?[{type:'web_search_call',status:'completed',action:{type:'open_page',url:sourceUrl}}]:[]),{type:'message',content:[{type:'output_text',text:JSON.stringify({cases})}]}]});
const realCase=()=>external.externalCasesFromResponse(response())[0];
const paper=()=>({sourceId:'R:W123',openAlexId:'https://openalex.org/W123',title:'Management agreements for green spaces',authors:[],year:2024,abstract:'Ongoing municipal support and maintenance agreements were associated with continuity. Effects varied by context.',doi:null,journal:null,citationCount:1,openAccess:true,topics:[],usedInAnswer:true});
const answer=(summary)=>({summary,caseFindings:[],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'',projectImplications:[],limitations:''});
async function route(question,history=[],selectedSources=[]){const result={};const res={setHeader(){},status(code){result.status=code;return this},json(body){result.body=body}};await handler({method:'POST',headers:{},body:{question,history,selectedSources}},res);return result}
function project(t,logs=[]){mock(t,context,'loadProjectContext',async()=>({projectId:'p',user:{uid:'u'},currentMaterial:input('').projectContext,previousSummaries:{problem:'보행·관리 개선'},cases:[],stageHistory:logs}));mock(t,caseSources,'readCasePassages',async()=>[])}

test('case discovery intents stay distinct from planning judgment and research',()=>{
 for(const q of ['사례 찾아줘','실제로 한 곳 있어?','비슷한 사업 있어?','해외에서는 어떻게 했어?','국내 다른 지역에서는?','이런 방식으로 해결한 곳 있어?','성공 사례 있어?','지속 운영 사례 있어?','마을 텃밭은 관리가 지속되지 않을 것 같은데 다른 지역은 어떻게 했어?']){assert.equal(routing.wantsNewCases(q),true,q);assert.ok(routing.resolveSources(q).includes('cases'),q)}
 for(const q of ['텃밭 운영 주체를 미리 정하는 게 좋을까?','그럼 우리 지역에서는 어떤 방법이 현실적일까?'])assert.equal(routing.wantsNewCases(q),false,q);
 assert.ok(routing.resolveSources('이런 방식이 실제로 효과가 있다는 연구도 있어?').includes('research'));
 assert.equal(routing.wantsNewCases('이런 방식이 실제로 효과가 있다는 연구도 있어?'),false);
 assert.ok(routing.resolveSources('이런 사례도 있고 실제 효과도 검증됐어?').includes('research'));
});

test('query concepts retain operating constraints and never use the raw conversational sentence',async t=>{
 mock(t,llm,'callLLM',async req=>{assert.equal(req.model,"gpt-6.1-sol");assert.match(req.systemText,/REAL implemented project/);assert.equal(JSON.parse(req.userText).question,'참여가 줄어도 유지되는 사례 있어?');return JSON.stringify({problem:'참여 감소',intervention:'녹지 관리',spaceType:'골목',management:'대체 관리 조직',priorities:'지속 운영',query:'municipal green space maintenance fallback management community decline case'})});
 const result=await external.caseSearchConcepts(input('참여가 줄어도 유지되는 사례 있어?'));assert.match(result.query,/fallback management/);assert.equal(result.management,'대체 관리 조직');
});

test('provider provenance rejects invented URLs, unrelated source categories and unsafe links',()=>{
 const valid=external.externalCasesFromResponse(response());assert.equal(valid.length,1);assert.equal(valid[0].url,sourceUrl);assert.equal(valid[0].origin,'external');assert.match(valid[0].sourceId,/^C:WEB/);
 assert.equal(external.externalCasesFromResponse(response([entry({url:'https://parks.example.gov/invented'})])).length,0);
 assert.equal(external.externalCasesFromResponse(response([entry({sourceType:'blog'})])).length,0);
 assert.equal(external.externalCasesFromResponse(response([entry({quote:''})])).length,0);
 assert.equal(external.externalCasesFromResponse({...response(),status:'incomplete'}).length,0);
 for(const url of ['javascript:alert(1)','https://u:p@example.gov','http://127.0.0.1/admin','http://169.254.169.254/','http://172.20.0.1/'])assert.equal(external.externalSourceUrl(url),undefined);
 assert.equal(external.externalSourceUrl(sourceUrl+'?utm_source=x#part'),sourceUrl);
 const preview=external.externalCasesFromResponse(response([entry()],false))[0];assert.equal(preview.evidenceLevel,'preview');assert.doesNotMatch(preview.text,/유지관리 개선 보고/);
});

test('web provider uses bounded native search/page reading and only publishes returned sources',async t=>{
 const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture-key';t.after(()=>{if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old});
 mock(t,llm,'callLLM',async()=>JSON.stringify({problem:'관리 중단',query:'community garden long term governance municipal maintenance case'}));
 mock(t,global,'fetch',async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);assert.equal(body.tools[0].type,'web_search');assert.equal(body.tool_choice,'required');assert.equal(body.max_tool_calls,5);assert.ok(body.include.includes('web_search_call.action.sources'));assert.match(body.input[0].content,/Unknown fields must be empty/);assert.equal(JSON.parse(body.input[1].content).problem,'관리 중단');return Response.json(response())});
 assert.equal((await external.searchExternalCases(input('지속가능하게 운영되는 마을 텃밭 사례를 찾아줘.'))).length,1);
});

for(const [number,question] of [[1,'지속가능하게 운영되는 마을 텃밭 사례를 찾아줘.'],[2,'주민 참여가 줄어도 유지되는 녹지 관리 사례가 있어?'],[3,'차량 통행 때문에 주거지가 혼잡해진 문제를 개선한 사례를 찾아줘.']])test(`Test ${number}: ${question}`,async t=>{
 project(t);let searches=0;
 mock(t,external,'searchExternalCases',async req=>{searches++;assert.equal(req.question,question);return [realCase()]});
 mock(t,papers,'searchOpenAlex',()=>assert.fail('real case question must not automatically run academic search'));
 mock(t,llm,'callLLM',async req=>{const data=JSON.parse(req.userText);assert.ok(data.cases.some(c=>c.origin==='external'&&c.management===undefined&&/공원관리국/.test(c.text)));assert.match(req.systemText,/conditional judgment/);return JSON.stringify(answer(`공원관리국과 계약 조직이 관리하는 사례를 확인했습니다. [${data.cases[0].sourceId}] 우리 사업에서도 관리 주체와 예산을 먼저 확인하는 방안이 현실적입니다.`))});
 const result=await route(question);assert.equal(result.status,200);assert.equal(searches,1);assert.equal(result.body.analysis.answer.sources[0].url,sourceUrl);assert.match(result.body.reply,/관리 주체/);
});

test('Test 4: effects follow-up uses the preceding method and OpenAlex, without another case search',async t=>{
 project(t);let calls=0;
 mock(t,external,'searchExternalCases',()=>assert.fail('no repeated case search'));
 mock(t,papers,'searchOpenAlex',async query=>{calls++;assert.match(query,/관리 계약|공공기관/);return [paper()]});
 mock(t,llm,'callLLM',async req=>{assert.equal(JSON.parse(req.userText).papers[0].openAlexId,'https://openalex.org/W123');return JSON.stringify({...answer('관리 지원과 지속 운영의 관련성을 보고한 연구가 있습니다. [R:W123]'),researchFindings:[{text:'공공 관리 지원과 운영 지속성의 관련성이 보고되었습니다.',sourceIds:['R:W123']}]})});
 const result=await route('이런 방식이 실제로 효과가 있다는 연구도 있어?',[{role:'user',content:'주민 참여가 줄어도 유지되는 녹지 관리 사례가 있어?'},{role:'assistant',content:'공공기관이 관리 계약을 맺어 주민 참여 감소에 대비하는 방식을 확인했습니다.'}]);
 assert.equal(result.status,200);assert.equal(calls,1);assert.deepEqual(result.body.analysis.selectedSources,['research']);
});

test('Test 5: planning follow-up reuses cited cases, abstract excerpts and project context without searching',async t=>{
 const c=realCase(),p=paper();
 const caseBundle={question:'사례',selectedSources:['cases'],cases:[c],papers:[],warnings:[]};
 const researchBundle={question:'연구',selectedSources:['research'],cases:[],papers:[p],warnings:[]};
 const logs=[{stepId:'data',analysis:{evidence:types.compactEvidence(caseBundle),answer:answers.parseAnswer(JSON.stringify(answer(`관리 계약이 있습니다. [${c.sourceId}]`)),caseBundle)}},{stepId:'data',analysis:{evidence:types.compactEvidence(researchBundle),answer:answers.parseAnswer(JSON.stringify(answer('관리 지원과 관련이 있습니다. [R:W123]')),researchBundle)}}];
 project(t,logs);
 mock(t,external,'searchExternalCases',()=>assert.fail('no repeated web search'));
 mock(t,papers,'searchOpenAlex',()=>assert.fail('no repeated research search'));
 mock(t,llm,'callLLM',async req=>{const data=JSON.parse(req.userText);assert.equal(data.cases[0].sourceId,c.sourceId);assert.match(data.papers[0].abstract,/municipal support/);assert.match(data.projectMaterial,/유지관리 인력/);assert.match(data.previousStageSummaries.problem,/보행/);return JSON.stringify(answer(`관리 계약 사례 [${c.sourceId}]와 지원 연구 [R:W123]를 참고하면, 우리 지역은 관리 조직·운영비를 먼저 확보한 뒤 작은 구간에서 시작하는 편이 현실적이라고 판단합니다.`))});
 const result=await route('그럼 우리 지역에서는 어떤 방법이 현실적일까?');assert.equal(result.status,200);assert.equal(result.body.analysis.evidence.cases.length,1);assert.equal(result.body.analysis.evidence.papers.length,1);assert.match(result.body.analysis.evidence.projectContext,/회복의 숲길/);
 assert.equal(follow.recentAnswerEvidence([{...logs[0],stepId:'problem'}]),undefined);
 assert.equal(follow.recentAnswerEvidence([{stepId:'data',analysis:{answer:{summary:'bad'},evidence:caseBundle}}]),undefined);
});

test('external errors, empty results and research errors remain Korean and do not fabricate evidence',async t=>{
 mock(t,external,'searchExternalCases',async()=>{throw Error('private English provider error with api_key=secret')});
 const result=await evidence.retrieveEvidence(input('지속 운영 사례 찾아줘'));assert.equal(result.cases.length,0);assert.ok(result.warnings.every(w=>/[가-힣]/.test(w.message)&&!/secret|provider error/.test(w.message)));
 mock(t,external,'searchExternalCases',async()=>[]);const empty=await evidence.retrieveEvidence(input('지속 운영 사례 찾아줘'));assert.match(empty.warnings[0].message,/조건에 맞는 실제 사례/);
 mock(t,papers,'searchOpenAlex',async()=>{throw Error('Search failed secret')});const failed=await evidence.retrieveEvidence(input('관련 연구 찾아줘',{selectedSources:['research']}));assert.match(failed.warnings[0].message,/연구논문 검색/);assert.doesNotMatch(failed.warnings[0].message,/secret|Search failed/);
});

test('citation verification still rejects invented external source IDs',()=>{
 const c=realCase(),bundle={question:'',selectedSources:['cases'],cases:[c],papers:[],warnings:[]};
 assert.throws(()=>answers.parseAnswer(JSON.stringify(answer('거짓 성과 [C:WEBinvented]')),bundle),/unsupported source/);
 assert.ok(answers.parseAnswer(JSON.stringify(answer(`보고된 관리 방식 [${c.sourceId}]`)),bundle).sources[0].url);
});

test('manual project sources and ordinary planning judgment never trigger external search',async t=>{
 project(t);mock(t,external,'searchExternalCases',()=>assert.fail('no web search for reasoning or manual project-only selection'));mock(t,papers,'searchOpenAlex',()=>assert.fail('no academic search'));
 mock(t,llm,'callLLM',async()=>JSON.stringify(answer('운영 주체를 먼저 정하고 예산과 책임 범위를 합의하는 방안을 검토하는 것이 좋겠습니다.')));
 assert.equal((await route('텃밭 운영 주체를 미리 정하는 게 좋을까?')).status,200);
 assert.equal((await route('지속 운영 사례 찾아줘',[],['project'])).status,200);
});

test('combined implementation and research requests use both paths exactly once',async t=>{
 project(t);let web=0,research=0;
 mock(t,external,'searchExternalCases',async()=>{web++;return [realCase()]});mock(t,papers,'searchOpenAlex',async()=>{research++;return [paper()]});
 mock(t,llm,'callLLM',async req=>{const data=JSON.parse(req.userText);return JSON.stringify(answer(`관리 계약 사례 [${data.cases[0].sourceId}]와 효과 연구 [R:W123]는 구분해서 참고할 수 있습니다.`))});
 const result=await route('이런 사례도 있고 실제 효과도 검증됐어?');assert.equal(result.status,200);assert.equal(web,1);assert.equal(research,1);assert.equal(result.body.analysis.answer.sources.length,2);
});
