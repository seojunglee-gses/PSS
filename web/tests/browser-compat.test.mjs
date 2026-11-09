import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {browserCompatibilityScript}=require(`${process.env.PSS_TEST_BUILD}/lib/browser-compat.js`);
const postcss=require('postcss');
const plugin=require('../postcss-legacy.cjs');
function context(){
 const element=()=>({style:{},appendChild(){},remove(){},scrollHeight:0,classList:{add(){}}});
 const scope=vm.createContext({document:{createElement:element,documentElement:element()},AbortController,AbortSignal:class {},DOMException,setTimeout,clearTimeout,crypto:{getRandomValues(bytes){bytes.fill(7);return bytes;}}});
 vm.runInContext('window=this; delete Array.prototype.at; delete String.prototype.at; delete String.prototype.replaceAll;',scope);
 vm.runInContext(browserCompatibilityScript,scope);return scope;
}
test('legacy runtime supports negative indexing and literal replaceAll without regex interpretation',()=>{
 const scope=context();
 for(const [expression,expected] of [['[1,2,3].at(-1)',3],['"abc".at(-2)','b'],['[1].at(3)',undefined],['"a.b.a.b".replaceAll(".","+")','a+b+a+b'],['"a$b$a".replaceAll("$","!")','a!b!a'],['"a[a".replaceAll("[","-")','a-a'],['"aaa".replaceAll(/a/g,"b")','bbb']])assert.equal(vm.runInContext(expression,scope),expected);
 assert.throws(()=>vm.runInContext('"aaa".replaceAll(/a/,"b")',scope),/global/);
 assert.match(vm.runInContext('crypto.randomUUID()',scope),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('legacy abort helpers propagate cancellation and timeout',async()=>{
 const scope=context();
 assert.equal(vm.runInContext('var c=new AbortController(); var signal=AbortSignal.any([c.signal]); c.abort(); signal.aborted',scope),true);
 const signal=vm.runInContext('AbortSignal.timeout(1)',scope);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(signal.aborted,true);
});
test('fallback lowers layered Tailwind CSS, initializes property values, and preserves modern stylesheet',async()=>{
 const source='@layer theme,base,utilities; @layer theme {:root{--color-blue:oklch(50% .1 260)}} @property --tw-border-style {syntax:"*";inherits:false;initial-value:solid;} @layer utilities {.workspace-shell{color:var(--color-blue);inset:0} .border{border-style:var(--tw-border-style);border-width:1px} .flex{gap:8px} :where(.group:hover) .child{color:red}}';
 const legacy=plugin.legacyCss(source,postcss);
 assert.doesNotMatch(legacy,/@layer|@property|:where/);assert.match(legacy,/--tw-border-style:solid/);assert.match(legacy,/--ppss-gap:8px/);assert.doesNotMatch(legacy,/oklch\(/);assert.match(legacy,/top:0/);
 const output=(await postcss([plugin()]).process(source,{from:undefined})).css;
 assert.ok(output.startsWith(source));assert.match(output,/@supports not \(color: oklch/);
});
