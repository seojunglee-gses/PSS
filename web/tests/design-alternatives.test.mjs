import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(path.join(process.env.PSS_TEST_BUILD,'loader.js'));
const load=p=>require(path.join(process.env.PSS_TEST_BUILD,p));
const sharp=require('sharp');
const admin=load('lib/firebaseAdmin.js'), llm=load('lib/llm/index.js'), contexts=load('lib/project-context-server.js');
const server=load('lib/design-alternatives-server.js'), images=load('lib/design-image-server.js');
const {designImageSize,imagePoint}=load('lib/design-alternatives.js');
const handler=load('pages/api/generate-alternative.js').default;
function fakeDatabase(initial={}) {
 const records=new Map(Object.entries(structuredClone(initial))),writes=[];let chain=Promise.resolve();
 const snapshot=p=>({exists:records.has(p),data:()=>records.get(p)});
 const put=(ref,data,options)=>{records.set(ref.path,options?.merge?{...records.get(ref.path),...structuredClone(data)}:structuredClone(data));writes.push(ref.path)};
 const db={doc:p=>({path:p,get:async()=>snapshot(p),set:async(d,o)=>put({path:p},d,o),create:async d=>{if(records.has(p))throw Error('already-exists');put({path:p},d)}}),
 collection:p=>({where:(field,_operator,value)=>({limit(){return this},get:async()=>{const docs=[...records.entries()].filter(([key,data])=>key.startsWith(p+'/')&&data[field]===value).map(([,data])=>({data:()=>data}));return {empty:!docs.length,docs}}})}),
 runTransaction:callback=>{const pending=chain.then(async()=>{const commits=[];const tx={get:async ref=>snapshot(ref.path),set:(r,d,o)=>commits.push(()=>put(r,d,o)),create:(r,d)=>{if(records.has(r.path))throw Error('already-exists');commits.push(()=>put(r,d))}};const result=await callback(tx);commits.forEach(fn=>fn());return result});chain=pending.catch(()=>{});return pending}};
 return {db,records,writes};
}
const proposal=(name='보행')=>({introduction:'지난 단계 의견을 바탕으로 제안해요.',interventions:[{text:`${name} 공간 구분`,origin:'participant',basis:'걷는 길이 필요하다는 말씀'},{text:'주차 구획 정리',origin:'ai',basis:'보행 의견을 구체화한 AI 제안'},{text:'화분 배치 조정',origin:'ai',basis:'관리가 쉬운 녹지 방향을 구체화한 AI 제안'}]});
function response(){return {code:0,setHeader(){},status(c){this.code=c;return this},json(v){this.body=v;return this}}}
function fixture(t,initial={}) {
 const context={projectId:'alpha',user:{uid:'resident'},currentMaterial:'사업 목표와 현황',previousSummaries:{problem:'보행 안전',data:'화분 관리'},stageHistory:[]};
 const logs=Array.from({length:17},(_,i)=>({id:'m'+i,sender:'user',text:i%2?'화분 관리가 어려워요.':'골목길을 안전하게 걷고 싶어요.'}));
 const original={'users_alpha/resident/steps/problem':{logs},'users_alpha/resident/steps/data':{logs:[{id:'d1',sender:'user',text:'주차 공간을 정리하면 좋겠어요.'}]},'ppssWorkspaceSummaries_alpha/resident':{completedStages:['problem','data'],stageSummaries:{problem:'기존 원본 요약'}}};
 const {db,records,writes}=fakeDatabase({...original,...initial});
 t.mock.method(admin,'adminDb',()=>db);t.mock.method(contexts,'loadProjectContext',async()=>context);
 const oldKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-key';t.after(()=>{if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey});
 const call=async body=>{const res=response();await handler({method:'POST',body:{projectId:'alpha',...body}},res);return res};
 return {context,records,writes,original,call};
}
test('image dimensions preserve landscape/portrait ratios and pointer mapping is zoom-independent',()=>{
 assert.equal(designImageSize(1903,895),'1536x720');assert.equal(designImageSize(1903,918),'1536x736');assert.equal(designImageSize(895,1903),'720x1536');assert.equal(designImageSize(5000,100),'auto');
 assert.deepEqual(imagePoint(120,80,{left:20,top:30,width:200,height:100},1000,500),{x:500,y:250});
 assert.deepEqual(imagePoint(220,130,{left:20,top:30,width:400,height:200},1000,500),{x:500,y:250});
});
test('first proposal reads all resident dialogue, persists once, and never changes research originals',async t=>{
 const f=fixture(t);let calls=0;
 t.mock.method(llm,'callLLM',async input=>{calls++;const context=JSON.parse(input.userText);assert.equal(context.dialogue.problem.length,17);assert.equal(context.dialogue.data[0].text,'주차 공간을 정리하면 좋겠어요.');assert.match(input.systemText,/never invent resident agreement/);return JSON.stringify(proposal())});
 assert.equal((await f.call({action:'get-proposal'})).body.direction,null);assert.equal(calls,0);
 const first=await f.call({action:'prepare-proposal',requestId:'initial'});assert.equal(first.code,200);assert.equal(first.body.direction.interventions.length,3);
 const again=await f.call({action:'prepare-proposal',requestId:'initial'});assert.deepEqual(again.body.direction,first.body.direction);assert.equal(calls,1);
 await f.call({action:'get-proposal'});assert.equal(calls,1);
 for(const [key,value] of Object.entries(f.original))assert.deepEqual(f.records.get(key),value);
 assert.ok(f.writes.every(key=>key.startsWith('ppssDerivedStageTopics/design-')));
});
test('revision requires explicit reconfirmation, retains initial proposal and separates residents',async t=>{
 const f=fixture(t);t.mock.method(llm,'callLLM',async input=>JSON.stringify(proposal(JSON.parse(input.userText).feedback?'녹지':'보행')));
 const first=(await f.call({action:'prepare-proposal',requestId:'initial'})).body.direction;
 assert.equal((await f.call({action:'confirm-proposal',revision:'forged'})).code,409);
 const confirmed=(await f.call({action:'confirm-proposal',revision:first.revision})).body.direction;assert.ok(confirmed.confirmedAt);
 const revised=(await f.call({action:'revise-proposal',requestId:'revise',revision:first.revision,feedback:'녹지를 더 보고 싶어요.'})).body.direction;
 assert.notEqual(revised.revision,first.revision);assert.equal(revised.confirmedAt,undefined);assert.equal(revised.interventions[0].text,'녹지 공간 구분');
 const revisions=[...f.records.values()].filter(v=>v.previousRevision!==undefined);assert.equal(revisions.length,2);assert.equal(revisions[0].direction.interventions[0].text,'보행 공간 구분');
 f.context.user={uid:'second'};assert.equal((await f.call({action:'get-proposal'})).body.direction,null);
});
test('existing Stage 3 conversation, images, or completion do not get a new initial proposal',async t=>{
 const f=fixture(t);let calls=0;t.mock.method(llm,'callLLM',async()=>{calls++;return JSON.stringify(proposal())});
 f.context.stageHistory=[{sender:'user',text:'기존 설계 대화'}];assert.equal((await f.call({action:'prepare-proposal',requestId:'old-chat'})).body.direction,null);
 f.context.stageHistory=[];f.records.set('ppssGeneratedImages_alpha/old',{userId:'resident'});assert.equal((await f.call({action:'prepare-proposal',requestId:'old-image'})).body.direction,null);
 f.records.delete('ppssGeneratedImages_alpha/old');f.records.set('ppssWorkspaceSummaries_alpha/resident',{completedStages:['alternatives']});assert.equal((await f.call({action:'prepare-proposal',requestId:'completed'})).code,409);assert.equal(calls,0);
});
test('cross-instance image lease rejects double clicks, isolates users and reuses successful result',async t=>{
 const f=fixture(t);let release,calls=0;const pending=new Promise(resolve=>release=resolve);
 const first=server.withDesignOperation(f.context,'image','one',{},async()=>{calls++;await pending;return {imageId:'a'}});
 await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(()=>server.withDesignOperation(f.context,'image','one',{},async()=>{}),/처리하고/);
 await assert.rejects(()=>server.withDesignOperation(f.context,'image','two',{},async()=>{}),/앞선 요청/);
 const other=await server.withDesignOperation({...f.context,user:{uid:'second'}},'image','one',{},async()=>({imageId:'b'}));assert.equal(other.imageId,'b');
 release();assert.equal((await first).imageId,'a');assert.equal((await server.withDesignOperation(f.context,'image','one',{},async()=>{calls++;})).imageId,'a');assert.equal(calls,1);
});
test('shared server slots bound image concurrency across different residents',async t=>{
 const f=fixture(t);const old=process.env.PPSS_IMAGE_CONCURRENCY;process.env.PPSS_IMAGE_CONCURRENCY='1';t.after(()=>{if(old===undefined)delete process.env.PPSS_IMAGE_CONCURRENCY;else process.env.PPSS_IMAGE_CONCURRENCY=old});
 let release;const first=server.withDesignOperation(f.context,'image','one',{},()=>new Promise(resolve=>release=resolve));await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(()=>server.withDesignOperation({...f.context,user:{uid:'other'}},'image','two',{},async()=>{}),error=>error.status===429);release('done');await first;
});
test('PNG masks match natural pixel dimensions, require alpha and a real selected area',async()=>{
 const raw=Buffer.alloc(8*4*4,255);raw[3]=0;
 const good=await sharp(raw,{raw:{width:8,height:4,channels:4}}).png().toBuffer();
 const data='data:image/png;base64,'+good.toString('base64');assert.deepEqual(await images.validateDesignMask(data,8,4),good);
 await assert.rejects(()=>images.validateDesignMask(data,16,4),/크기가 달라/);
 const opaque=await sharp({create:{width:8,height:4,channels:4,background:'white'}}).png().toBuffer();await assert.rejects(()=>images.validateDesignMask('data:image/png;base64,'+opaque.toString('base64'),8,4),/부분만/);
});
test('confirmed generation and masked edit use chosen parent, save new lineage, leave originals and submission alone',async t=>{
 const f=fixture(t,{'ppssSiteImages_alpha/current':{imageId:'site',storagePath:'projects/alpha/site-images/site'}});
 const originalBytes=await sharp({create:{width:1903,height:895,channels:4,background:'red'}}).png().toBuffer();
 const parentBytes=await sharp({create:{width:1536,height:720,channels:4,background:'blue'}}).png().toBuffer();
 const files=new Map([['projects/alpha/site-images/site',originalBytes]]);
 t.mock.method(admin,'adminBucket',()=>({file:p=>({getMetadata:async()=>[{size:files.get(p)?.length??0}],download:async()=>[files.get(p)],save:async bytes=>{assert.ok(!files.has(p));files.set(p,bytes)}})}));
 t.mock.method(admin,'buildDownloadUrl',p=>'https://storage.example/'+p);
 let llmCalls=0;t.mock.method(llm,'callLLM',async()=>{llmCalls++;return JSON.stringify(proposal())});
 const draft=(await f.call({action:'prepare-proposal',requestId:'initial'})).body.direction;
 const denied=await f.call({requestId:'unconfirmed',revision:draft.revision});assert.equal(denied.code,409);
 await f.call({action:'confirm-proposal',revision:draft.revision});
 let providerCalls=0;t.mock.method(global,'fetch',async(url,options)=>{
   assert.equal(url,'https://api.openai.com/v1/images/edits');providerCalls++;
   const form=options.body;assert.equal(form.get('model'),'gpt-image-2.6-flare');assert.equal(form.get('complexity'),'medium');assert.equal(form.get('quality'),'medium');assert.equal(form.get('size'),'1536x720');assert.equal(form.get('output_format'),'png');assert.equal(form.get('n'),'1');
   if(providerCalls===2){const input=Buffer.from(await form.get('image').arrayBuffer());assert.deepEqual(input,await sharp(parentBytes).rotate().png().toBuffer());assert.ok(form.get('mask'));assert.match(form.get('prompt'),/Change only the transparent mask area/)}
   return Response.json({data:[{b64_json:parentBytes.toString('base64')}]});
 });
 const created=await f.call({requestId:'create',revision:draft.revision,provider:'gemini'});assert.equal(created.code,200);assert.ok(created.body.downloadUrl);assert.equal(llmCalls,1);assert.equal(created.body.base64,undefined);
 const parentId=created.body.imageId,parent=structuredClone(f.records.get('ppssGeneratedImages_alpha/'+parentId));
 f.records.set('ppssSiteImages_alpha/current',{imageId:'replacement',storagePath:'projects/alpha/site-images/replacement'});
 f.records.set('ppssUserDesignSubmissions_alpha/existing',{userId:'resident',imageId:parentId,createdAt:'2026-01-01'});
 const raw=Buffer.alloc(1536*720*4,255);raw[3]=0;const mask=await sharp(raw,{raw:{width:1536,height:720,channels:4}}).png().toBuffer();
 const edited=await f.call({requestId:'edit',revision:draft.revision,parentImageId:parentId,mask:'data:image/png;base64,'+mask.toString('base64'),feedback:'이 부분에 화분을 놓아주세요.'});assert.equal(edited.code,200);assert.notEqual(edited.body.imageId,parentId);assert.equal(edited.body.designMetadata.parentImageId,parentId);assert.equal(edited.body.designMetadata.siteImageId,'site');assert.equal(providerCalls,2);
 assert.deepEqual(f.records.get('ppssGeneratedImages_alpha/'+parentId),parent);assert.equal(f.records.get('ppssUserDesignSubmissions_alpha/existing').imageId,parentId);
 for(const [key,value] of Object.entries(f.original))assert.deepEqual(f.records.get(key),value);
 f.context.user={uid:'other'};assert.equal((await f.call({requestId:'forged',parentImageId:parentId,feedback:'바꿔주세요.'})).code,403);
});
test('provider rate limits preserve all source records and cannot submit or complete a plan',async t=>{
 const f=fixture(t);t.mock.method(global,'fetch',async()=>new Response('',{status:429,headers:{'retry-after':'30'}}));
 const input={buffer:await sharp({create:{width:1024,height:1024,channels:4,background:'white'}}).png().toBuffer(),width:1024,height:1024};
 await assert.rejects(()=>images.editDesignImage(input,'prompt'),error=>error.status===429&&/기존 이미지는 그대로/.test(error.message));
 assert.equal(f.writes.length,0);
});

test('an existing generated image remains editable without the initial photo or a new proposal LLM call',async t=>{
 const image=await sharp({create:{width:1024,height:1024,channels:4,background:'blue'}}).png().toBuffer();
 const f=fixture(t,{'ppssGeneratedImages_alpha/legacy':{userId:'resident',imageId:'legacy',storagePath:'projects/alpha/generated-images/legacy.png',note:'Existing resident design'}});
 t.mock.method(llm,'callLLM',async()=>{throw Error('editing must not call another LLM')});
 t.mock.method(admin,'adminBucket',()=>({file:p=>({getMetadata:async()=>[{size:image.length}],download:async()=>{assert.equal(p,'projects/alpha/generated-images/legacy.png');return [image]},save:async()=>{}})}));t.mock.method(admin,'buildDownloadUrl',()=> 'https://storage.example/edited.png');
 t.mock.method(global,'fetch',async(_url,options)=>{assert.match(options.body.get('prompt'),/Existing resident design/);return Response.json({data:[{b64_json:image.toString('base64')}]})});
 const edited=await f.call({requestId:'legacy-edit',parentImageId:'legacy',feedback:'간판을 정리해주세요.'});assert.equal(edited.code,200);assert.equal(edited.body.designMetadata.parentImageId,'legacy');assert.equal(edited.body.designMetadata.siteImageId,null);
 assert.equal(f.records.get('ppssGeneratedImages_alpha/legacy').note,'Existing resident design');
});
