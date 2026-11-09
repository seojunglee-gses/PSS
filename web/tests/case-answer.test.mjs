import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(path.join(process.env.PSS_TEST_BUILD,'loader.js')),load=p=>require(path.join(process.env.PSS_TEST_BUILD,p));
const llm=load('lib/llm/index.js'),openalex=load('lib/research/openalex.js'),{retrieveEvidence,parseAnalysisRequest}=load('lib/research/evidence.js'),{answerFromEvidence,parseAnswer}=load('lib/research/answer.js'),{resolveSources,namedCases,wantsImplications}=load('lib/research/routing.js');
const material={id:'guildford',title:'Guildford Lane',label:'Guildford Lane',text:'A public lane regeneration project.',aliases:['길포드 레인']};
const passage={...material,text:'Delivery vehicles still have restricted access. Noise complaints were recorded during events.',sourceId:'',relevanceTerms:[],documentId:'report',documentTitle:'Evaluation report',fileName:'report.pdf',revisionId:'revision-one',passageId:'p120',page:12,paragraph:120};
function mock(t,object,key,value){const previous=object[key];object[key]=value;t.after(()=>object[key]=previous)}
const request=question=>({...parseAnalysisRequest({question,selectedSources:['cases']}),cases:[material],casePassages:[passage]});
const response=summary=>JSON.stringify({summary,caseFindings:[],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'',projectImplications:['사업에 적용할 제안'],limitations:''});
test('case names and Korean aliases route automatic facts to cases; explicit source choices remain intact',()=>{
 for(const q of ['Guildford Lane에 부작용은 없었어? 여기 차도 다니니?','길포드 레인 운영은 어떻게 해?'])assert.deepEqual(resolveSources(q,[],[material]),['cases']);
 assert.deepEqual(resolveSources('Guildford Lane에 차가 다녀?',['research'],[material]),['research']);
 assert.equal(namedCases('여기 차도 다니니?',[material],[{role:'user',content:'Guildford Lane을 알려줘'}])[0].id,'guildford');
 assert.deepEqual(resolveSources('여기 차도 다니니?',[],[material],[{role:'user',content:'Guildford Lane을 알려줘'}]),['cases']);
});
test('all administrator passages are scanned, semantic selection finds late English evidence for Korean questions, and sufficient material bypasses OpenAlex',async t=>{
 const input=request('Guildford Lane에 부작용은 없었어? 여기 차도 다니니?');input.casePassages=[...Array.from({length:100},(_,i)=>({...passage,text:'Unrelated architecture description.',passageId:'irrelevant-'+i})),passage];
 mock(t,global,'fetch',()=>assert.fail('complete local material must not cause external research'));
 mock(t,llm,'callLLM',async args=>{assert.match(args.systemText,/semantically relevant/);const data=JSON.parse(args.userText),target=data.passages.find(p=>p.passageId==='p120');assert.ok(target);return JSON.stringify({sourceIds:[target.sourceId],researchQuery:''})});
 const evidence=await retrieveEvidence(input);assert.equal(evidence.cases.length,1);assert.equal(evidence.cases[0].page,12);assert.equal(evidence.cases[0].documentId,'report');assert.deepEqual(evidence.papers,[]);
});
test('only uncovered aspects trigger an academic query and source IDs never come from the semantic model',async t=>{
 let searched='';mock(t,llm,'callLLM',async args=>{const data=JSON.parse(args.userText);return JSON.stringify({sourceIds:[data.passages[0].sourceId],researchQuery:'Guildford Lane adverse effects evaluation'})});
 mock(t,openalex,'searchOpenAlex',async query=>{searched=query;return []});const input=request('Guildford Lane의 차량 통행과 부작용은?');const result=await retrieveEvidence(input);assert.equal(searched,'Guildford Lane adverse effects evaluation');assert.ok(input.selectedSources.includes('research'));assert.equal(result.cases[0].passageId,'p120');
 mock(t,llm,'callLLM',async()=>JSON.stringify({sourceIds:['C:invented'],researchQuery:''}));const fallback=await retrieveEvidence(request('Guildford Lane에 차도 다녀?'));assert.ok(fallback.cases.length);assert.ok(fallback.cases.every(p=>p.sourceId!=='C:invented'));
});
test('generic papers cannot establish the actual operating facts of a named case',async t=>{
 mock(t,llm,'callLLM',async args=>JSON.stringify({sourceIds:[JSON.parse(args.userText).passages[0].sourceId],researchQuery:'Guildford Lane vehicle access'}));
 mock(t,openalex,'searchOpenAlex',async()=>[{title:'Traffic in green streets',abstract:'General urban regeneration findings.',sourceId:'R:W1'}]);
 const result=await retrieveEvidence(request('Guildford Lane에 지금 차량이 다니니?'));assert.deepEqual(result.papers,[]);assert.ok(result.cases.length);
});
test('case facts use direct presentation, cite exact stored passages, and cannot append unsolicited implications',async t=>{
 const input=request('Guildford Lane에 차도 다니니?'),evidence={question:input.question,selectedSources:['cases'],cases:[{...passage,sourceId:'C:1'}],papers:[],warnings:[]};
 mock(t,llm,'callLLM',async args=>{assert.match(args.systemText,/complete DIRECT answer/);assert.match(args.systemText,/General research cannot establish/);return response('차량 통행: 배송 차량은 제한적으로 통행합니다. [C:1]')});
 const answer=await answerFromEvidence(input,evidence);assert.equal(answer.format,'direct');assert.deepEqual(answer.projectImplications,[]);assert.equal(answer.sources[0].title,'Guildford Lane · Evaluation report · p.12');
 const apply=await answerFromEvidence({...input,question:'우리 사업에 어떻게 적용할 수 있어?'},evidence);assert.ok(apply.summary.includes("사업에 적용할 제안"));assert.deepEqual(apply.projectImplications,[]);
 assert.throws(()=>parseAnswer(response('거짓 자료 [C:999]'),evidence),/unsupported source/);
 for(const q of ['차도 다니니?','어디에 있어?','운영 중이야?'])assert.equal(wantsImplications(q),false);for(const q of ['가좌에 참고할 점은?','이 사례에서 배울 점은?','우리 사업에 적용해줘'])assert.equal(wantsImplications(q),true);
});
test('passage snapshots retain page/paragraph/revision and reject empty or oversized source text',()=>{
 const {splitCasePassages}=load('lib/research/case-sources-server.js');const source=splitCasePassages([{text:'차량 통행은 유지됩니다.\n\n주민 민원이 기록되었습니다.',page:3}], 'revision');assert.equal(source.length,2);assert.equal(source[1].page,3);assert.equal(source[1].paragraph,2);assert.equal(source[1].passageId,'revision-2');assert.throws(()=>splitCasePassages([{text:' '}],'rev'),/noText/);assert.throws(()=>splitCasePassages([{text:'x'.repeat(200001)}],'rev'),/tooLong/);
});
