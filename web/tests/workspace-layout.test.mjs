import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {constrainPanelRatio,panelRatioBounds,workspaceLayoutMode,DEFAULT_PANEL_RATIO,PANEL_DIVIDER_WIDTH,workspaceViewportMetrics}=require(`${process.env.PSS_TEST_BUILD}/lib/workspace-layout.js`);
test('tablet portrait toggles while landscape and sufficiently wide desktop split',()=>{
  assert.equal(workspaceLayoutMode(736,768,false,false),'toggle');
  assert.equal(workspaceLayoutMode(788,820,false,false),'toggle');
  assert.equal(workspaceLayoutMode(916,1024,true,false),'split');
  assert.equal(workspaceLayoutMode(1200,1440,true,true),'split');
  assert.equal(workspaceLayoutMode(1200,1366,false,false),'toggle');
  assert.equal(workspaceLayoutMode(1200,1440,false,true),'split');
  assert.equal(workspaceLayoutMode(620,1024,true,false),'toggle');
  assert.equal(workspaceLayoutMode(800,844,true,false),'toggle');
});
test('every split width enforces usable pixel and percentage minimums',()=>{
  for(const width of [640,704,916,1200,1600])for(const ratio of [-100,0,35,60,70,100,Infinity,NaN]){
    const value=constrainPanelRatio(ratio,width),available=width-PANEL_DIVIDER_WIDTH;
    assert.ok(value>=35&&value<=70);
    assert.ok(available*value/100>=280-1e-7);
    assert.ok(available*(100-value)/100>=300-1e-7);
  }
  assert.equal(constrainPanelRatio(DEFAULT_PANEL_RATIO,1200),60);
  assert.equal(constrainPanelRatio(100,1200),70);
  assert.equal(constrainPanelRatio(-1,1200),35);
});
test('a narrow landscape preserves the requested ratio preference without collapsing chat',()=>{
  const desired=65;
  assert.ok(constrainPanelRatio(desired,640)<desired);
  assert.equal(constrainPanelRatio(desired,1200),desired);
  const b=panelRatioBounds(640);assert.ok(b.min<b.max);
});

test('keyboard dismissal restores workspace height even when Safari retains a page zoom',()=>{
 assert.deepEqual(workspaceViewportMetrics({height:480,offsetTop:110,scale:1},1000),{height:480,top:110});
 assert.deepEqual(workspaceViewportMetrics({height:384,offsetTop:150,scale:1.25},1000),{height:480,top:0});
 assert.deepEqual(workspaceViewportMetrics({height:800,offsetTop:80,scale:1.25},1000),{height:1000,top:0});
 assert.deepEqual(workspaceViewportMetrics({height:1000,offsetTop:0,scale:1},1000),{height:1000,top:0});
 assert.deepEqual(workspaceViewportMetrics(null,1000),{height:1000,top:0});
});
