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
function database(records,writes=[]){return {doc:p=>({get:async()=>({exists:p in records,data:()=>records[p]}),set:async v=>writes.push({p,v})}),collection:p=>({add:async v=>writes.push({p,v})})}}
const request=(body={})=>({method:'POST',headers:{authorization:'Bearer fixture-token',origin:'https://example.org'},body:{projectId:'alpha',...body}});
function fixture(t){
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
});
test('Stage 3 reads the same project-specific current image written by Settings',async t=>{
 fixture(t);const writes=[],stored=[];mock(t,admin,'adminDb',()=>database({'ppssProjects/alpha':project,'users/member/projectMemberships/alpha':{role:'participant'},'ppssSiteImages_alpha/current':{imageId:'settings-image',downloadUrl:'https://storage.example/site.png'}},writes));
 mock(t,admin,'adminBucket',()=>({file:path=>({save:async(bytes,options)=>stored.push({path,bytes,options})})}));
 mock(t,admin,'buildDownloadUrl',()=> 'https://storage.example/generated.png');
 const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture';t.after(()=>{if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old});
 mock(t,llm,'callLLM',async()=> 'Preserve the site image and improve walking space.');let imageInputs=0;
 mock(t,global,'fetch',async(url,options)=>{if(url==='https://storage.example/site.png')return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}});assert.equal(url,'https://api.openai.com/v1/images/edits');assert.equal(options.body.get('model'),'gpt-image-2.5-flare');imageInputs++;return Response.json({data:[{b64_json:'fixture-image'}]})});
 const res=response();await load('pages/api/generate-alternative.js').default(request({userID:'member',provider:'openai',workspaceSummary:{},workspaceInput:{}}),res);assert.equal(res.code,200);assert.equal(imageInputs,1);assert.equal(res.body.base64,undefined);assert.equal(res.body.downloadUrl,'https://storage.example/generated.png');assert.equal(stored.length,1);assert.match(stored[0].path,/^projects\/alpha\/generated-images\//);assert.equal(writes[0].v.userId,'member');assert.equal(writes[0].v.storagePath,stored[0].path);
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
