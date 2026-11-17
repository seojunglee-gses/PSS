import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),load=p=>require(`${process.env.PSS_TEST_BUILD}/${p}`);
const ranks=load('lib/evaluation-ranks.js');
test('new ranking selections use only the top three ranks, move a repeated rank, and can be cleared',()=>{
 let value=ranks.selectTopRank({},'a','1');value=ranks.selectTopRank(value,'b','2');value=ranks.selectTopRank(value,'c','3');assert.deepEqual(value,{a:1,b:2,c:3});
 const original=structuredClone(value);assert.deepEqual(ranks.selectTopRank(value,'d','4'),original);assert.deepEqual(value,original);
 value=ranks.selectTopRank(value,'d','1');assert.deepEqual(value,{b:2,c:3,d:1});value=ranks.selectTopRank(value,'d','');assert.deepEqual(value,{b:2,c:3});
});
test('only valid ranks for current images enter a new submission, without modifying the draft or historical results',()=>{
 const original={a:1,b:2,c:3,d:4,removed:1,duplicate:3};const before=structuredClone(original);
 assert.deepEqual(ranks.topRankSelection(original,['a','b','c','d','duplicate']),{a:1,b:2,c:3});assert.deepEqual(original,before);
});
test('heatmap counts rank 1/2/3 separately for every plan, preserves legacy ranks and handles zero votes',()=>{
 const images=[{id:'a',label:'Plan A'},{id:'b',label:'Plan B'}];const results=[{rankings:{a:1,b:2}},{rankings:{a:1,b:3}},{rankings:{a:4,b:1}}],before=structuredClone(results);
 assert.deepEqual(ranks.rankHeatmap(images,results).map(row=>row.counts),[[2,0,0],[1,1,1]]);assert.deepEqual(results,before);
 assert.deepEqual(ranks.rankHeatmap(images,[]).map(row=>row.counts),[[0,0,0],[0,0,0]]);assert.equal(ranks.heatmapLevel(0,0),0);assert.ok(ranks.heatmapLevel(1,5)<ranks.heatmapLevel(5,5));
});
test('heatmap renders accessible columns and real counts with a color legend and preview controls',t=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),i18n=load('lib/i18n.js');
 const old=i18n.useI18n;i18n.useI18n=()=>({t:(key,values)=>i18n.translate('ko',key,values),localize:value=>value});t.after(()=>i18n.useI18n=old);
 const Heatmap=load('components/evaluation/RankingHeatmap.js').default;
 const html=renderToStaticMarkup(React.createElement(Heatmap,{images:[{id:'a',label:'계획안 A'}],results:[{rankings:{a:1}},{rankings:{a:3}}],onPreview:()=>{}}));
 assert.match(html,/계획안별 순위 선택 히트맵/);for(const rank of [1,2,3])assert.match(html,new RegExp(rank+'순위'));
 assert.match(html,/계획안 A, 1순위: 1회 선택/);assert.match(html,/계획안 A, 2순위: 0회 선택/);assert.match(html,/적음/);assert.match(html,/많음/);assert.doesNotMatch(html,/4순위/);
});

test('top-rank submission requires a complete 1–3 selection, or all available ranks for fewer plans',()=>{
 assert.equal(ranks.completeTopRanks({a:1,b:2,c:3},['a','b','c','d']),true);assert.equal(ranks.completeTopRanks({a:1,b:2},['a','b','c','d']),false);
 assert.equal(ranks.completeTopRanks({a:1,b:2},['a','b']),true);assert.equal(ranks.completeTopRanks({a:1},['a']),true);assert.equal(ranks.completeTopRanks({},[]),false);
});

test('legacy design extraction returns only source text and preserves speaker attribution without displaying JSON/system instructions',()=>{
 const {legacyDesignElements,legacyEditRequest,readableDesignText}=load('lib/evaluation-design.js');
 const data={direction:{interventions:[{text:'그늘이 이어지는 보행 가장자리',origin:'ai',basis:'private'},{text:'간판 "]" 모양 유지',origin:'participant'}]},previousStageSummaries:{problem:'비공개 원문'}};
 assert.deepEqual(legacyDesignElements('DESIGN TRANSLATION\nRESIDENT DESIGN INPUT:\n'+JSON.stringify(data)),data.direction.interventions.map(({text,origin})=>({text,origin})));
 assert.deepEqual(legacyDesignElements('broken: Confirmed resident-reviewed direction: [{not json}]'),[]);
 assert.equal(legacyEditRequest('EDIT THE SUPPLIED SELECTED GENERATED IMAGE\nLatest resident edit request: 조명은 그대로 유지해주세요'),'조명은 그대로 유지해주세요');
 assert.equal(readableDesignText('PHOTO-BASED URBAN DESIGN VISUALIZATION'),undefined);
 assert.deepEqual(legacyDesignElements('whole internal paragraph'),[]);
});

test('report keeps all positive first-choice ties, ignores average ranks and never selects a zero-vote winner',()=>{
 const images=['a','b','c','d','zero'].map(id=>({id,label:id}));
 const results=[{rankings:{a:1,b:2,c:3}},{rankings:{d:1,a:2,b:3}},{rankings:{a:1,d:2,c:3}},{rankings:{d:1,b:2}},{rankings:{a:1}},{rankings:{d:1}}];
 const before=structuredClone({images,results});const report=ranks.evaluationReport(images,results);
 assert.deepEqual(report.winners.map(row=>row.id),['a','d']);assert.deepEqual(report.winners.map(row=>row.counts[0]),[3,3]);
 assert.deepEqual(report.distribution.map(row=>row.id),['a','d','b','c']);assert.equal(report.maximumTotal,4);assert.equal(report.rows.length,5);
 assert.deepEqual({images,results},before);
 assert.deepEqual(ranks.evaluationReport(images,[]).winners,[]);
 assert.deepEqual(ranks.evaluationReport(images,[{rankings:{a:2,b:3}}]).winners,[]);
 assert.equal(ranks.evaluationReport(images,[{rankings:{a:1}}]).winners.length,1);
 assert.deepEqual(ranks.evaluationReport([],[]),{rows:[],winners:[],distribution:[],maximumTotal:0});
});

test('report bars sort by 1/2/3 counts on one scale; heatmap retains zero-vote plans',t=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),i18n=load('lib/i18n.js');
 const old=i18n.useI18n;i18n.useI18n=()=>({t:(key,values)=>i18n.translate('ko',key,values),localize:value=>value});t.after(()=>i18n.useI18n=old);
 const Results=load('components/evaluation/EvaluationResults.js').default;
 const images=['A','B','C','Zero'].map(id=>({id,label:'계획안 '+id,imageUrl:'/test.png'}));
 const results=[{rankings:{A:1,B:2,C:3}},{rankings:{A:2,B:1}},{rankings:{B:2}}];
 const html=renderToStaticMarkup(React.createElement(Results,{images,results,onPreview:()=>{}}));
 assert.match(html,/공동 1위 · 2개 계획안/);assert.match(html,/1순위 1표/);
 const chart=html.split('aria-label="계획안별 순위 선택 분포"')[1].split('aria-label="계획안별 순위 선택 히트맵"')[0];
 assert.ok(chart.indexOf('계획안 B')<chart.indexOf('계획안 A'));assert.ok(chart.indexOf('계획안 A')<chart.indexOf('계획안 C'));
 assert.match(chart,/width:66\.666/);assert.match(chart,/width:33\.333/);assert.doesNotMatch(chart,/계획안 Zero/);
 assert.match(html,/계획안 Zero, 1순위: 0회 선택/);assert.doesNotMatch(html,/conic-gradient/);
 const empty=renderToStaticMarkup(React.createElement(Results,{images,results:[],onPreview:()=>{}}));
 assert.match(empty,/아직 1순위 선택이 없습니다/);assert.match(empty,/아직 순위 선택 결과가 없습니다/);assert.doesNotMatch(empty,/<img/);
});
