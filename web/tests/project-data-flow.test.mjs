import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(path.join(process.env.PSS_TEST_BUILD,'loader.js'));
const load=p=>require(path.join(process.env.PSS_TEST_BUILD,p));
const admin=load('lib/firebaseAdmin.js');
const llm=load('lib/llm/index.js');
const context=load('lib/project-context-server.js');
const uploads=load('lib/storage-upload-server.js');
const {uploadProjectFile}=load('lib/storage-upload.js');
function mock(t,obj,key,value){const old=obj[key];obj[key]=value;t.after(()=>obj[key]=old)}
const project={projectName:'실제 사업',projectAdmin:'owner@example.org',workspaceContent:{problem:{title:'사업 배경',text:'실제 도로폭은 8m입니다.'},data:{title:'현황 자료',text:'대상지 면적 1234㎡',cases:[{id:'park',label:'기록된 사례',title:'주민 참여',text:'주민이 공원을 관리했습니다.'}]},alternatives:{text:'사업 계획'}}};
function database(records,writes=[]){return {doc:p=>({get:async()=>({exists:p in records,data:()=>records[p]}),set:async v=>writes.push({p,v})}),collection:p=>({add:async v=>{writes.push({p,v});return {id:'archive-'+writes.length}}})}}
const request=(body={})=>({method:'POST',headers:{authorization:'Bearer fixture-token',origin:'https://example.org'},body:{projectId:'alpha',...body}});
function fixture(t){
 mock(t,load('lib/research/case-sources-server.js'),'readCasePassages',async()=>[]);
 mock(t,admin,'verifyUserRequest',async()=>({uid:'member',email:'member@example.org'}));
 const records={'ppssProjects/alpha':project,'users/member/projectMemberships/alpha':{role:'participant'},'ppssBackgroundKnowledge_alpha/current':{curatedText:'사업 자료 요약'},'ppssWorkspaceSummaries_alpha/member':{stageSummaries:{problem:'이전 단계 결론',data:'현재 단계',report:'미래 단계'}}};
 mock(t,admin,'adminDb',()=>database(records));return records;
}
test('project context uses authorized saved material, full current text and previous stages only',async t=>{
 const records=fixture(t);records['ppssProjects/alpha']={...project,workspaceContent:{...project.workspaceContent,data:{...project.workspaceContent.data,text:'가'.repeat(5000)+'실제 자료 끝'}}};
 const result=await context.loadProjectContext(request({projectContext:'client invented road width'}),'data');
 assert.match(result.currentMaterial,/실제 자료 끝/);assert.match(result.currentMaterial,/8m/);assert.ok(!result.currentMaterial.includes('client invented'));
 assert.deepEqual(result.previousSummaries,{problem:'이전 단계 결론'});assert.equal(result.cases[0].text,'주민이 공원을 관리했습니다.');
 delete records['users/member/projectMemberships/alpha'];await assert.rejects(()=>context.loadProjectContext(request(),'data'),e=>e.status===403);
 await assert.rejects(()=>context.loadProjectContext({...request(),headers:{}},'data'),e=>e.status===401);
});
test('chat is grounded in saved current material and previous summaries without stock cases',async t=>{
 fixture(t);let sent;
 mock(t,llm,'callLLM',async input=>{sent=input;return '등록된 자료에 도로폭은 8m로 나옵니다.'});
 const res=response();await load('pages/api/chat.js').default(request({stepId:'data',message:'도로폭은?'}),res);
 assert.equal(res.code,200);assert.match(sent.userText,/8m/);assert.match(sent.userText,/이전 단계 결론/);assert.match(sent.systemText,/Never invent project-specific/);assert.ok(!sent.systemText.includes('789 Art Zone'));
});
function response(){return {code:0,body:null,setHeader(){},status(code){this.code=code;return this},json(value){this.body=value;return this},end(){}}}
test('15 MB upload sends binary directly to Storage and small metadata to the application',async t=>{
 const file=new File([new Uint8Array(15*1024*1024)],'background.txt',{type:'text/plain'});const calls=[];
 mock(t,global,'fetch',async(url,options)=>{calls.push({url,options});return url==='/api/admin/background-knowledge'?Response.json({uploadUrl:'https://storage.example/upload',storagePath:'ppss-background-knowledge/originals/alpha/file'}):new Response('',{status:200})});
 const result=await uploadProjectFile('/api/admin/background-knowledge',file,'alpha','fixture');
 assert.equal(calls.length,2);assert.ok(calls[0].options.body.length<500);assert.equal(calls[1].options.body,file);assert.equal(calls[1].options.body.size,15*1024*1024);assert.equal(result.storagePath,'ppss-background-knowledge/originals/alpha/file');
});
test('storage finalization validates project, ownership and actual bytes; archives contain metadata only',async t=>{
 const bytes=Buffer.alloc(15*1024*1024,65);const storagePath='ppss-background-knowledge/originals/alpha/file';let metadata={size:String(bytes.length),contentType:'text/plain',metadata:{uploadedBy:'member',projectId:'alpha',originalName:'15MB.txt',expectedSize:String(bytes.length)}};
 mock(t,admin,'adminBucket',()=>({file:()=>({getMetadata:async()=>[metadata],download:async()=>[bytes]})}));
 const result=await uploads.readStorageUpload({storagePath},'alpha','member','ppss-background-knowledge/originals');assert.equal(result.buffer.length,bytes.length);
 await assert.rejects(()=>uploads.readStorageUpload({storagePath},'other','member','ppss-background-knowledge/originals'));
 metadata={...metadata,metadata:{...metadata.metadata,uploadedBy:'other'}};await assert.rejects(()=>uploads.readStorageUpload({storagePath},'alpha','member','ppss-background-knowledge/originals'));
 metadata={...metadata,metadata:{...metadata.metadata,uploadedBy:'member'}};
 mock(t,admin,'verifyUserRequest',async()=>({uid:'member',email:'owner@example.org'}));const writes=[];mock(t,admin,'adminDb',()=>database({'ppssProjects/alpha':project},writes));
 const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture';t.after(()=>{if(prior===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=prior});
 mock(t,global,'fetch',async()=>Response.json({output:[{type:'message',content:[{type:'output_text',text:'추출 요약'}]}]}));
 const res=response();await load('pages/api/admin/background-knowledge.js').default(request({files:[{storagePath}]}),res);assert.equal(res.code,200);
 const archive=writes.find(w=>w.p.includes('Archives')).v;assert.equal(archive.size,bytes.length);assert.equal(archive.projectId,'alpha');assert.equal(archive.fileName,'15MB.txt');assert.ok(JSON.stringify(archive).length<1000);assert.equal(archive.data,undefined);
 const current=writes.find(w=>w.p==='ppssBackgroundKnowledge_alpha/current').v;assert.deepEqual(current.sourceIds,['archive-1']);
});
test('Stage 3 reads the same project-specific current image written by Settings',async t=>{
 fixture(t);const writes=[],stored=[];mock(t,admin,'adminDb',()=>database({'ppssProjects/alpha':project,'users/member/projectMemberships/alpha':{role:'participant'},'ppssSiteImages_alpha/current':{imageId:'settings-image',downloadUrl:'https://storage.example/site.png'}},writes));
 mock(t,admin,'adminBucket',()=>({file:path=>({save:async(bytes,options)=>stored.push({path,bytes,options})})}));
 mock(t,admin,'buildDownloadUrl',()=> 'https://storage.example/generated.png');
 const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture';t.after(()=>{if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old});
 mock(t,llm,'callLLM',async input=>{assert.doesNotMatch(input.systemText,/overpass|NO cars/i);assert.match(input.systemText,/camera position, viewpoint, perspective, and spatial layout/);assert.match(input.systemText,/this project's dialogue and workspace summaries/);assert.match(input.userText,/실제 사업/);return 'Preserve the site image and improve walking space.'});let imageInputs=0;
 mock(t,global,'fetch',async(url,options)=>{if(url==='https://storage.example/site.png')return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}});assert.equal(url,'https://api.openai.com/v1/images/edits');assert.equal(options.body.get('model'),'gpt-image-2.6-flare');imageInputs++;return Response.json({data:[{b64_json:'fixture-image'}]})});
 const res=response();await load('pages/api/generate-alternative.js').default(request({userID:'member',provider:'openai',workspaceSummary:{},workspaceInput:{}}),res);assert.equal(res.code,200);assert.equal(imageInputs,1);assert.equal(res.body.base64,undefined);assert.equal(res.body.downloadUrl,'https://storage.example/generated.png');assert.equal(stored.length,1);assert.match(stored[0].path,/^projects\/alpha\/generated-images\//);assert.equal(writes[0].v.userId,'member');assert.equal(writes[0].v.storagePath,stored[0].path);
});

test('image prompt revisions use current-project history and summaries without a hardcoded design subject',async t=>{
 const records=fixture(t);records['users_alpha/member/steps/alternatives']={logs:[{sender:'user',text:'시장 앞 광장에 그늘을 더해주세요.'},{sender:'assistant',text:'보행 공간을 유지하는 방향으로 검토합니다.'}]};
 let sent;mock(t,llm,'callLLM',async input=>{sent=input;return JSON.stringify({prompt:'Preserve the plaza viewpoint and add shade in the agreed scope.',rationale:'Reflect the participant request.'})});
 const res=response();await load('pages/api/generate-revision-prompt.js').default(request({feedback:'나무 그늘을 늘려주세요.',previousPrompt:'Old design'}),res);
 assert.equal(res.code,200);assert.doesNotMatch(sent.systemText,/overpass/i);assert.match(sent.systemText,/camera position, viewpoint, perspective, and spatial layout/);assert.match(sent.systemText,/unsupported project-specific assumptions/);
 assert.match(sent.userText,/시장 앞 광장/);assert.match(sent.userText,/이전 단계 결론/);assert.match(sent.userText,/나무 그늘/);assert.doesNotMatch(sent.userText,/미래 단계/);
});

test('background PDF extraction uses the installed pdf-parse v2 API',async t=>{
 let pdf='%PDF-1.4\n';const offsets=[0];const stream='BT /F1 12 Tf 72 720 Td (Project road width is 8 meters.) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
 const xref=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 const bytes=Buffer.from(pdf),storagePath='ppss-background-knowledge/originals/alpha/pdf';
 mock(t,admin,'verifyUserRequest',async()=>({uid:'member',email:'owner@example.org'}));mock(t,admin,'adminDb',()=>database({'ppssProjects/alpha':project}));
 mock(t,admin,'adminBucket',()=>({file:()=>({getMetadata:async()=>[{size:bytes.length,contentType:'application/pdf',metadata:{uploadedBy:'member',projectId:'alpha',expectedSize:String(bytes.length),originalName:'reference.pdf'}}],download:async()=>[bytes]})}));
 const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture';t.after(()=>{if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old});
 mock(t,global,'fetch',async(_,options)=>{assert.match(options.body,/Project road width is 8 meters/);return Response.json({output:[{type:'message',content:[{type:'output_text',text:'PDF summary'}]}]})});
 const res=response();await load('pages/api/admin/background-knowledge.js').default(request({files:[{storagePath}]}),res);assert.equal(res.code,200);assert.equal(res.body.curatedText,'PDF summary');
});

test('research API ignores forged case/project text and uses authorized saved cases',async t=>{
 fixture(t);let sent;
 mock(t,llm,'callLLM',async input=>{sent=JSON.parse(input.userText);return JSON.stringify({summary:'저장된 사례를 참고했습니다. [C:1]',caseFindings:[{text:'주민이 공원을 관리했습니다.',sourceIds:['C:1']}],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'사업 적용 가능성을 검토하세요.',projectImplications:[],limitations:''})});
 mock(t,global,'fetch',async()=>assert.fail('case-only analysis must not call OpenAlex'));
 const res=response();await load('pages/api/research/answer.js').default(request({question:'비슷한 사례는?',selectedSources:['cases'],cases:[{id:'forged',label:'invented',title:'fake',text:'invented project facts'}],projectContext:'invented road width'}),res);
 assert.equal(res.code,200);assert.equal(sent.cases[0].id,'park');assert.equal(sent.cases[0].text,'주민이 공원을 관리했습니다.');assert.match(sent.projectContext,/8m/);assert.deepEqual(sent.previousStageSummaries,{problem:'이전 단계 결론'});assert.ok(!JSON.stringify(sent).includes('invented'));
});
test('Settings site-image finalization writes the existing project current-image metadata path',async t=>{
 const records=fixture(t),writes=[];const storagePath='ppss-site-image/alpha/uploaded-image';
 mock(t,admin,'verifyUserRequest',async()=>({uid:'member',email:'owner@example.org'}));mock(t,admin,'adminDb',()=>database(records,writes));
 mock(t,admin,'adminBucket',()=>({file:()=>({getMetadata:async()=>[{size:3,contentType:'image/png',metadata:{uploadedBy:'member',projectId:'alpha',originalName:'site.png',expectedSize:'3'}}],download:async()=>[Buffer.from([1,2,3])],setMetadata:async()=>{}})}));
 const old=process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET='fixture-bucket';t.after(()=>{if(old===undefined)delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;else process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=old});
 const res=response();await load('pages/api/admin/site-image.js').default(request({storagePath}),res);assert.equal(res.code,200);
 const saved=writes.find(w=>w.p==='ppssSiteImages_alpha/current');assert.equal(saved.v.storagePath,storagePath);assert.equal(saved.v.imageId,'uploaded-image');assert.match(res.body.downloadUrl,/ppss-site-image%2Falpha%2Fuploaded-image/);
});
test('legacy plain-string stages remain available as grounded project material',async t=>{
 const records=fixture(t);records['ppssProjects/alpha']={...project,workspaceContent:{...project.workspaceContent,problem:'기존 사업 설명'}};
 assert.match((await context.loadProjectContext(request(),'problem')).currentMaterial,/기존 사업 설명/);
});

test('content image sessions are manager-only and use project/category-scoped paths',async t=>{
 fixture(t);let options,path;
 mock(t,admin,'adminBucket',()=>({file:p=>{path=p;return {createResumableUpload:async o=>{options=o;return ['https://storage.example/session?secret=do-not-log']}}}}));
 const handler=load('pages/api/projects/content-image.js').default;
 const denied=response();const logs=[];mock(t,console,'error',(...args)=>logs.push(args));
 await handler(request({action:'prepare',purpose:'case',name:'case.png',type:'image/png',size:3}),denied);assert.equal(denied.code,403);assert.equal(path,undefined);assert.equal(logs[0][1].authenticated,true);
 mock(t,admin,'verifyUserRequest',async()=>({uid:'owner',email:'owner@example.org'}));
 const allowed=response();await handler(request({action:'prepare',purpose:'case',name:'case.png',type:'image/png',size:3}),allowed);assert.equal(allowed.code,200);assert.match(path,/^projects\/alpha\/case-images\/[a-z0-9-]+$/);assert.equal(options.metadata.metadata.uploadedBy,'owner');assert.equal(options.metadata.metadata.projectId,'alpha');assert.equal(options.origin,'https://example.org');
});
test('content image finalization validates actual object metadata and never changes the Stage 3 current pointer',async t=>{
 fixture(t);mock(t,admin,'verifyUserRequest',async()=>({uid:'owner',email:'owner@example.org'}));let changedPath;
 const storagePath='projects/alpha/background-images/image-id';
 mock(t,admin,'adminBucket',()=>({file:p=>({getMetadata:async()=>[{size:3,contentType:'image/png',metadata:{uploadedBy:'owner',projectId:'alpha',expectedSize:'3'}}],download:async()=>[Buffer.from([1,2,3])],setMetadata:async()=>changedPath=p})}));
 mock(t,admin,'buildDownloadUrl',p=>'https://storage.example/'+p);
 const res=response();await load('pages/api/projects/content-image.js').default(request({purpose:'background',storagePath}),res);assert.equal(res.code,200);assert.equal(changedPath,storagePath);assert.match(res.body.downloadUrl,/background-images/);
});
test('Storage diagnostics include code/path/authentication and exclude credentials and error messages',()=>{
 const {storageFailureDetails}=load('lib/storage-errors.js');
 const details=storageFailureDetails({code:'storage/unauthorized',message:'Bearer secret-token',token:'secret-token'},'ppss-generated-images/alpha/image.png?token=secret-token',true);
 assert.deepEqual(details,{code:'storage/unauthorized',storagePath:'ppss-generated-images/alpha/image.png',authenticated:true});assert.ok(!JSON.stringify(details).includes('secret-token'));
});
test('generated image storage errors preserve safe diagnostics instead of returning credentials',async t=>{
 const captured=[];mock(t,console,'error',(...args)=>captured.push(args));
 mock(t,admin,'adminBucket',()=>({file:()=>({save:async()=>{throw Object.assign(new Error('credential=secret-token'),{code:'storage/unauthorized'})}})}));
 await assert.rejects(()=>load('lib/generated-image-server.js').storeGeneratedImage({projectId:'alpha',imageId:'image-id',base64:'aW1hZ2U=',label:'계획안',note:'의도',userId:'member'}),/서버 Storage 권한/);
 assert.equal(captured[0][1].code,'storage/unauthorized');assert.equal(captured[0][1].storagePath,'projects/alpha/generated-images/image-id.png');assert.equal(captured[0][1].authenticated,true);assert.ok(!JSON.stringify(captured).includes('secret-token'));
});

test('Settings site upload uses project-manager permissions and the new project site folder',async t=>{
 fixture(t);let target;
 const logs=[];mock(t,console,'error',(...args)=>logs.push(args));
 const handler=load('pages/api/admin/site-image.js').default;
 const denied=response();await handler(request({action:'prepare',name:'site.png',type:'image/png',size:3}),denied);assert.equal(denied.code,403);
 mock(t,admin,'verifyUserRequest',async()=>({uid:'owner',email:'owner@example.org'}));
 mock(t,admin,'adminBucket',()=>({file:p=>{target=p;return {createResumableUpload:async()=>['https://storage.example/upload']}}}));
 const allowed=response();await handler(request({action:'prepare',name:'site.png',type:'image/png',size:3}),allowed);assert.equal(allowed.code,200);assert.match(target,/^projects\/alpha\/site-images\/[a-z0-9-]+$/);
});
test('network upload failures retain the actual target path and never expose a session capability in diagnostics',async t=>{
 const file=new File(['image'],'test.png',{type:'image/png'});
 mock(t,global,'fetch',async url=>{if(url==='/api/projects/content-image')return Response.json({uploadUrl:'https://storage.example/?secret=do-not-log',storagePath:'projects/alpha/case-images/id'});throw new Error('secret=do-not-log')});
 await assert.rejects(()=>uploadProjectFile('/api/projects/content-image',file,'alpha','fixture',{purpose:'case'}),error=>{
  assert.equal(error.code,'upload/network');assert.equal(error.storagePath,'projects/alpha/case-images/id');assert.ok(!error.message.includes('do-not-log'));return true;
 });
});

function backgroundFiles(t,projectId,archives,files){
 const reads=[],collections=[];
 const snapshots=archives.map(a=>({id:a.id,exists:true,data:()=>a}));
 mock(t,admin,'adminDb',()=>({collection:name=>{collections.push(name);return {doc:id=>({get:async()=>snapshots.find(a=>a.id===id)??{id,exists:false}}),orderBy:()=>({limit:()=>({get:async()=>({docs:snapshots})})})}}}));
 mock(t,admin,'adminBucket',()=>({file:path=>({getMetadata:async()=>[files[path]?.metadata??{metadata:{projectId:'wrong'}}],download:async()=>{reads.push(path);return [files[path].bytes]}})}));
 return {reads,collections};
}
test('original background lookup is conditional, bounded to current sources and does not add a classifier model call',async t=>{
 const sources=load('lib/research/background-sources-server.js'),research=load('lib/research/evidence.js');
 assert.equal(sources.needsBackgroundOriginal('사업 개요를 간단히 설명해줘'),false);
 for(const q of ['사업비가 얼마야?','사업 기간을 알려줘','보고서 원문에서 확인해줘','운영비 내역이 궁금해요'])assert.equal(sources.needsBackgroundOriginal(q),true,q);
 const projectId='background-current-test',path1='ppss-background-knowledge/originals/'+projectId+'/current',path2='ppss-background-knowledge/originals/'+projectId+'/old';
 const bytes=Buffer.from('사업 개요: 생활환경 개선.\n\n총사업비는 123억 원이며 운영비는 7억 원입니다.\n\n사업 기간은 2024년부터 2027년까지입니다.');
 const fixture=backgroundFiles(t,projectId,[{id:'current',projectId,fileName:'사업계획.txt',storagePath:path1,uploadedAt:'2026-11-09'},{id:'old',projectId,fileName:'예전계획.txt',storagePath:path2}],{[path1]:{bytes,metadata:{size:String(bytes.length),generation:'1',metadata:{projectId}}}});
 mock(t,llm,'callLLM',async()=>assert.fail('retrieval and routing must not call an LLM'));mock(t,global,'fetch',async()=>assert.fail('original retrieval must not search OpenAlex'));
 const base={question:'사업비가 얼마야?',selectedSources:['project'],cases:[],projectContext:'짧은 요약에는 예산이 없음',provider:'openai',authorizedProjectId:projectId,hasBackground:true,backgroundSourceIds:['current']};
 const result=await research.retrieveEvidence(base);assert.match(result.projectContext,/123억/);assert.match(result.projectContext,/사업계획.txt/);assert.match(result.projectContext,/문단/);assert.equal(base.projectContext,'짧은 요약에는 예산이 없음');assert.deepEqual(fixture.reads,[path1]);assert.ok(!result.projectContext.includes('예전계획'));assert.deepEqual(result.warnings,[]);
 await research.retrieveEvidence({...base,question:'사업 기간은 언제야?'});assert.equal(fixture.reads.length,1);
 await research.retrieveEvidence({...base,question:'사업 개요를 간단히 설명해줘'});assert.equal(fixture.collections.length,2);
 const parsed=research.parseAnalysisRequest({question:'사업비 얼마야?',authorizedProjectId:projectId,hasBackground:true,backgroundSourceIds:['current']});assert.equal(parsed.authorizedProjectId,undefined);assert.equal(parsed.hasBackground,undefined);
 await research.retrieveEvidence({...base,selectedSources:['cases'],cases:[]});assert.equal(fixture.reads.length,1);
});
test('legacy original archives are labelled, storage generations invalidate cache, and foreign project paths cannot be read',async t=>{
 const sources=load('lib/research/background-sources-server.js'),projectId='background-legacy-test',path1='ppss-background-knowledge/originals/'+projectId+'/file';
 let bytes=Buffer.from('예산은 11억 원입니다.');const files={[path1]:{bytes,metadata:{size:String(bytes.length),generation:'1',metadata:{projectId}}}};
 const fixture=backgroundFiles(t,projectId,[{id:'valid',projectId,fileName:'예산.txt',storagePath:path1},{id:'foreign',projectId:'other',fileName:'비밀예산.txt',storagePath:'ppss-background-knowledge/originals/other/secret'},{id:'traversal',projectId,fileName:'다른예산.txt',storagePath:'ppss-background-knowledge/originals/'+projectId+'/../secret'},{id:'image',projectId,fileName:'이미지.png',storagePath:'ignored'}],files);
 const first=await sources.backgroundOriginalContext(projectId,'예산은 얼마야?');assert.match(first.text,/11억/);assert.ok(first.warnings.some(m=>/현재 요약과의 연결 정보/.test(m)));assert.deepEqual(fixture.reads,[path1]);
 bytes=Buffer.from('예산은 22억 원으로 변경되었습니다.');files[path1]={bytes,metadata:{size:String(bytes.length),generation:'2',metadata:{projectId}}};
 const revised=await sources.backgroundOriginalContext(projectId,'예산은 얼마야?',['valid']);assert.match(revised.text,/22억/);assert.doesNotMatch(revised.text,/11억/);assert.equal(fixture.reads.length,2);
 const empty=await sources.backgroundOriginalContext(projectId,'원문에서 가로수 수종을 찾아줘',['valid']);assert.equal(empty.text,'');assert.ok(empty.warnings.some(m=>/해당 내용이 없다는 뜻은 아닙니다/.test(m)));
 files[path1].metadata.metadata.projectId='other';const invalid=await sources.backgroundOriginalContext(projectId,'예산은 얼마야?',['valid']);assert.equal(invalid.text,'');assert.equal(fixture.reads.length,2);
});
test('original PDF page numbers reach the existing evidence prompt and a storage failure preserves the summary',async t=>{
 const sources=load('lib/research/background-sources-server.js'),parser=load('lib/research/case-sources-server.js'),research=load('lib/research/evidence.js');
 const projectId='background-pages-test',path1='ppss-background-knowledge/originals/'+projectId+'/pdf',bytes=Buffer.from('fixture');
 backgroundFiles(t,projectId,[{id:'report',projectId,fileName:'사업보고서.pdf',storagePath:path1}],{[path1]:{bytes,metadata:{size:String(bytes.length),generation:'1',metadata:{projectId}}}});
 mock(t,parser,'extractSourcePages',async()=>[{text:'표지',page:1},{text:'총사업비는 123억 원입니다.',page:12}]);
 const request={question:'원문에서 총사업비를 확인해줘',selectedSources:['project'],cases:[],projectContext:'저장된 요약',provider:'openai',authorizedProjectId:projectId,hasBackground:true,backgroundSourceIds:['report']};
 const evidence=await research.retrieveEvidence(request);assert.match(evidence.projectContext,/사업보고서.pdf · p.12/);let received;
 mock(t,llm,'callLLM',async input=>{received=input;return JSON.stringify({summary:'총사업비는 123억 원입니다. (프로젝트 자료: 사업보고서.pdf, p.12)',caseFindings:[],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'',projectImplications:[],limitations:''})});
 const answer=await load('lib/research/answer.js').answerFromEvidence(request,evidence);assert.match(answer.summary,/p.12/);assert.match(received.systemText,/limited retrieved passages/);assert.match(JSON.parse(received.userText).projectMaterial,/123억/);assert.equal(JSON.parse(received.userText).projectContext,'저장된 요약');
 mock(t,admin,'adminDb',()=>{throw Error('private credential details must not escape')});
 const failed=await research.retrieveEvidence(request);assert.equal(failed.projectContext,'저장된 요약');assert.ok(failed.warnings.some(w=>w.source==='project'));assert.doesNotMatch(JSON.stringify(failed),/credential details/);
});

test('real original PDF extraction retains the page containing a fact omitted from the summary',async t=>{
 let pdf='%PDF-1.4\n';const offsets=[0],one='BT /F1 12 Tf 72 720 Td (Project overview.) Tj ET',two='BT /F1 12 Tf 72 720 Td (The approved budget is 9876 million won.) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+one.length+' >>\nstream\n'+one+'\nendstream','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>','<< /Length '+two.length+' >>\nstream\n'+two+'\nendstream'];
 for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}
 const xref=pdf.length;pdf+='xref\n0 8\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
 const projectId='background-real-pdf',storagePath='ppss-background-knowledge/originals/'+projectId+'/report',bytes=Buffer.from(pdf);
 backgroundFiles(t,projectId,[{id:'report',projectId,fileName:'budget-report.pdf',storagePath}],{[storagePath]:{bytes,metadata:{size:String(bytes.length),generation:'1',metadata:{projectId}}}});
 const result=await load('lib/research/background-sources-server.js').backgroundOriginalContext(projectId,'What is the approved budget?',['report']);assert.match(result.text,/budget-report.pdf · p.2/);assert.match(result.text,/9876 million/);assert.deepEqual(result.warnings,[]);
 const page=await load('lib/research/background-sources-server.js').backgroundOriginalContext(projectId,'budget-report.pdf 원문 2페이지를 확인해줘',['report']);assert.match(page.text,/p.2/);assert.doesNotMatch(page.text,/p.1/);
});
test('unauthorized background-original questions cannot reach project archives or Storage',async t=>{
 mock(t,admin,'verifyUserRequest',async()=>({uid:'outsider',email:'outsider@example.org'}));
 mock(t,admin,'adminDb',()=>({doc:p=>({get:async()=>({exists:p==='ppssProjects/alpha',data:()=>p==='ppssProjects/alpha'?project:undefined})}),collection:()=>assert.fail('denied project archives must not be read')}));
 mock(t,admin,'adminBucket',()=>assert.fail('denied original Storage must not be read'));
 const res=response();await load('pages/api/research/answer.js').default(request({question:'사업비 원문에서 확인해줘',selectedSources:['project']}),res);assert.equal(res.code,403);
});

test('text originals without a filename extension remain searchable using verified Storage MIME metadata',async t=>{
 const projectId='background-mime-test',storagePath='ppss-background-knowledge/originals/'+projectId+'/source',bytes=Buffer.from('사업 기간은 2024년부터 2027년까지입니다.');
 backgroundFiles(t,projectId,[{id:'source',projectId,fileName:'사업 설명',storagePath}],{[storagePath]:{bytes,metadata:{size:String(bytes.length),generation:'1',contentType:'text/plain',metadata:{projectId}}}});
 const result=await load('lib/research/background-sources-server.js').backgroundOriginalContext(projectId,'사업 기간을 알려줘',['source']);assert.match(result.text,/2027/);assert.match(result.text,/사업 설명/);assert.deepEqual(result.warnings,[]);
});

test('authorized Data Analysis API uses linked originals while ignoring client-supplied file identities',async t=>{
 const records=fixture(t);records['ppssBackgroundKnowledge_alpha/current']={curatedText:'사업 개요만 정리한 요약',sourceIds:['active-source']};
 const bytes=Buffer.from('총사업비는 123억 원입니다.'),storagePath='ppss-background-knowledge/originals/alpha/api-source';let calls=0,received;
 mock(t,admin,'adminDb',()=>({...database(records),collection:name=>{assert.equal(name,'ppssBackgroundKnowledgeArchives_alpha');return {doc:id=>{assert.equal(id,'active-source');return {get:async()=>({id,exists:true,data:()=>({projectId:'alpha',fileName:'사업예산.txt',storagePath})})}}}}}));
 mock(t,admin,'adminBucket',()=>({file:path=>{assert.equal(path,storagePath);return {getMetadata:async()=>[{size:String(bytes.length),generation:'api-source-version',contentType:'text/plain',metadata:{projectId:'alpha'}}],download:async()=>[bytes]}}}));
 mock(t,llm,'callLLM',async input=>{calls++;received=JSON.parse(input.userText);return JSON.stringify({summary:'총사업비는 123억 원입니다. (프로젝트 자료: 사업예산.txt, 문단 1)',caseFindings:[],researchFindings:[],agreement:'',differences:'',integratedInterpretation:'',projectImplications:[],limitations:''})});
 const res=response();await load('pages/api/research/answer.js').default(request({question:'총사업비가 얼마야?',selectedSources:['project'],authorizedProjectId:'other',backgroundSourceIds:['evil'],projectContext:'클라이언트가 만든 내용'}),res);
 assert.equal(res.code,200);assert.equal(calls,1);assert.match(res.body.reply,/123억/);assert.match(res.body.analysis.evidence.projectContext,/사업예산.txt/);assert.match(received.projectMaterial,/123억/);assert.doesNotMatch(received.projectContext,/123억|클라이언트가 만든 내용/);assert.match(received.projectContext,/8m/);assert.deepEqual(res.body.analysis.answer.researchFindings,[]);
});
