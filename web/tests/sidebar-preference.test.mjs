import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const store=require(process.env.PSS_TEST_BUILD+'/lib/sidebar-preference.js');
let values, blocked;
beforeEach(()=>{
 values=new Map();blocked=false;global.window=new EventTarget();
 global.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(blocked)throw Error('Storage unavailable');values.set(key,value)}};
 store.saveSidebarPinned(false);
});
test('pin preference persists and notifies subscribers; cleanup removes the listener',()=>{
 let changes=0;const stop=store.subscribeSidebarPreference(()=>changes++);
 assert.equal(store.sidebarPinnedSnapshot(),false);store.saveSidebarPinned(true);assert.equal(values.get('ppss-sidebar-pinned'),'true');assert.equal(store.sidebarPinnedSnapshot(),true);assert.equal(changes,1);
 stop();store.saveSidebarPinned(false);assert.equal(changes,1);assert.equal(store.sidebarPinnedSnapshot(),false);
});
test('native changes from another tab update the preference while unrelated storage is ignored',()=>{
 let changes=0;const stop=store.subscribeSidebarPreference(()=>changes++);
 const dispatch=key=>{const event=new Event('storage');Object.defineProperty(event,'key',{value:key});window.dispatchEvent(event)};
 values.set('ppss-sidebar-pinned','true');dispatch('ppss-sidebar-pinned');assert.equal(store.sidebarPinnedSnapshot(),true);assert.equal(changes,1);
 dispatch('ppss-role');assert.equal(changes,1);values.clear();dispatch(null);assert.equal(store.sidebarPinnedSnapshot(),false);assert.equal(changes,2);stop();
});
test('blocked storage still permits pinning and unpinning in the current session',()=>{
 blocked=true;store.saveSidebarPinned(true);assert.equal(store.sidebarPinnedSnapshot(),true);store.saveSidebarPinned(false);assert.equal(store.sidebarPinnedSnapshot(),false);
 blocked=false;store.saveSidebarPinned(true);assert.equal(values.get('ppss-sidebar-pinned'),'true');assert.equal(store.sidebarPinnedSnapshot(),true);
});
