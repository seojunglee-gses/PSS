import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {stageChatGuide}=require(`${process.env.PSS_TEST_BUILD}/lib/stage-chat-guides.js`);
const stages=['problem','data','alternatives','evaluation','report'];
const roles=['public','business','planners','government'];
test('each locale supplies exactly three static questions for all 20 stage/role combinations',()=>{
 for(const locale of ['ko','en','zh']){
  const all=[];
  for(const stage of stages){
   const variants=[];
   for(const role of roles){
    const guide=stageChatGuide(stage,locale,role);
    assert.ok(guide.title&&guide.description);assert.equal(guide.suggestedQuestions.length,3);
    assert.ok(guide.suggestedQuestions.every(q=>typeof q.label==='string'&&q.label.trim()&&typeof q.prompt==='string'&&q.prompt.trim()&&q.label!==q.prompt));
    assert.equal(new Set(guide.suggestedQuestions.map(q=>q.prompt)).size,3);
    if(locale==='en')assert.ok(guide.suggestedQuestions.every(q=>!/[가-힣]/.test(q.prompt+q.label)));
    all.push(...guide.suggestedQuestions.map(q=>q.prompt));variants.push(JSON.stringify(guide.suggestedQuestions));
   }
   assert.equal(new Set(variants).size,4);
  }
  assert.equal(all.length,60);
 }
});
test('canonical and existing legacy participant roles use the same mappings',()=>{
 for(const [role,legacy]of [['public','일반 시민'],['business','Business Owners'],['planners','Planners'],['government','Government']])for(const stage of stages){
  assert.deepEqual(stageChatGuide(stage,'ko',legacy),stageChatGuide(stage,'ko',role));
 }
});
test('unknown and absent participant roles safely fall back to citizen questions',()=>{
 for(const stage of stages)for(const role of [undefined,null,'','Guest','admin','toString','constructor'])assert.deepEqual(stageChatGuide(stage,'ko',role),stageChatGuide(stage,'ko','public'));
 for(const stage of ['', 'unknown', 'constructor', '__proto__'])assert.equal(stageChatGuide(stage,'ko','public'),undefined);
});
test('changing stage, stakeholder or locale selects the corresponding questions without a model call',()=>{
 const publicProblem=stageChatGuide('problem','ko','public');
 assert.equal(publicProblem.suggestedQuestions[0].prompt,'우리 동네에서 가장 먼저 바뀌었으면 하는 것은 무엇일까요?');
 assert.equal(stageChatGuide('problem','ko','government').suggestedQuestions[0].prompt,'사업을 추진하고 운영할 때 가장 먼저 해결해야 할 문제는 무엇일까요?');
 assert.equal(stageChatGuide('data','ko','public').suggestedQuestions[0].prompt,'우리 동네의 생활 불편을 어떤 자료로 확인할 수 있을까요?');
 assert.equal(stageChatGuide('alternatives','ko','planners').suggestedQuestions[0].prompt,'대상지의 기존 자원을 활용한 서로 다른 계획 대안을 만들어 볼까요?');
 assert.equal(stageChatGuide('report','en','business').suggestedQuestions[1].prompt,'What compromise could both residents and local businesses accept?');
 assert.deepEqual(stageChatGuide('problem','ko','public'),publicProblem);
});

test('Korean operations-team role retains legacy government selections and stage-specific suggestions',()=>{
 for(const stage of stages)for(const role of ['운영진','공무원','정부','Government'])assert.deepEqual(stageChatGuide(stage,'ko',role),stageChatGuide(stage,'ko','government'));
 assert.ok(stageChatGuide('problem','ko','운영진').suggestedQuestions.some(q=>q.prompt.includes('운영진')));
 assert.ok(stageChatGuide('data','ko','운영진').suggestedQuestions.some(q=>q.prompt.includes('운영 성과')));
});
