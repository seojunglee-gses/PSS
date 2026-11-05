import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),build=process.env.PSS_TEST_BUILD;
const {chatBlocks}=require(`${build}/lib/chat-format.js`);
const sample='| 구분 | 자료에 나타난 사업 목표 | 주민 관점에서 확인해 볼 요구 | |---|---|---| | 변화의 초점 | 녹지·휴식공간 확충과 환경 회복 | 녹지가 늘어나는 것뿐 아니라 **차를 피해 다니지 않고 안심하고 걷는 것** | | 개선의 판단 기준 | 녹색도시 전환, 가로환경 개선 | 실제로 차량이 감속하고 양보하는 등 **일상에서 체감되는 변화** |';
test('the supplied flattened Korean table is recovered without losing cells or bold markers',()=>{
 const blocks=chatBlocks(sample);assert.equal(blocks.length,1);const table=blocks[0];
 assert.equal(table.kind,'table');assert.deepEqual(table.headers,['구분','자료에 나타난 사업 목표','주민 관점에서 확인해 볼 요구']);
 assert.equal(table.rows.length,2);assert.ok(table.rows.every(row=>row.length===3));assert.match(table.rows[0][2],/\*\*차를 피해/);
 assert.deepEqual(chatBlocks('\\'+sample),blocks);
});
test('ordinary multiline tables preserve surrounding prose, alignment and escaped pipes',()=>{
 const blocks=chatBlocks('설명\n| A | B |\n| :--- | ---: |\n| a\\|b | 값 [R:W1] |\n마무리');
 assert.equal(blocks[0].text,'설명');assert.deepEqual(blocks[1],{kind:'table',headers:['A','B'],rows:[['a|b','값 [R:W1]']],align:['left','right']});assert.equal(blocks[2].text,'마무리');
});
test('ordinary pipes, malformed flattened tables and fenced examples remain plain text',()=>{
 for(const value of ['왼쪽 | 오른쪽','| A | B | |---|---| | too | many | cells |','```\n| A | B |\n|---|---|\n| a | b |\n```'])assert.deepEqual(chatBlocks(value),[{kind:'text',text:value}]);
});
test('table rendering escapes HTML and retains emphasis instead of injecting markup',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const Content=require(`${build}/components/chat/ChatMessageContent.js`).default,{I18nProvider}=require(`${build}/lib/i18n.js`);
 const html=renderToStaticMarkup(React.createElement(I18nProvider,null,React.createElement(Content,{text:'| A | B |\n|---|---|\n| **강조** | <script>alert(1)</script> |'})));
 assert.match(html,/<table/);assert.match(html,/<th[^>]*scope="col"/);assert.match(html,/<strong>강조<\/strong>/);assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>'));
});
test('Data Analysis citations remain evidence buttons inside rendered table cells',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{I18nProvider}=require(`${build}/lib/i18n.js`);
 const Answer=require(`${build}/components/analysis/AnalysisAnswer.js`).default;
 const answer={format:'direct',summary:'| 구분 | 근거 |\n|---|---|\n| **주민 교류** | 연구 결과 [R:W1] |',caseFindings:[],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'',projectImplications:[],limitations:'',sources:[{sourceId:'R:W1',kind:'research',title:'Retrieved paper',authors:[],year:2025,openAlexId:'https://openalex.org/W1',doi:null,citationCount:1}]};
 const html=renderToStaticMarkup(React.createElement(I18nProvider,null,React.createElement(Answer,{answer,onViewEvidence(){}})));
 assert.match(html,/<table/);assert.match(html,/<strong>주민 교류<\/strong>/);assert.match(html,/aria-label="View evidence: Retrieved paper"/);assert.ok(!html.includes('[R:W1]'));
});
