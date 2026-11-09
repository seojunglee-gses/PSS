import {randomUUID} from 'node:crypto';
import {adminDb,adminBucket} from '../firebaseAdmin';
import {AccessError} from '../membership/server';
import {readStorageUpload} from '../storage-upload-server';
import {canManageProject} from '../rbac';
import type {ProjectMeta} from '../projects';
import type {CasePassage,CaseSourceMeta,CaseEvidence,CaseMaterial} from './types';
const MAX_TEXT=200000;
export const caseSourceCollection=(projectId:string)=>adminDb().collection(`ppssProjects/${projectId}/caseSources`);
export function splitCasePassages(pages:{text:string;page?:number}[],revisionId:string):CasePassage[]{
 if(pages.reduce((n,p)=>n+p.text.length,0)>MAX_TEXT)throw new AccessError(400,'caseSource.tooLong');
 const passages:CasePassage[]=[];
 for(const page of pages)for(const block of page.text.replace(/\r\n/g,'\n').split(/\n\s*\n/)){
  const text=block.trim();for(let i=0;i<text.length;i+=1200){const excerpt=text.slice(i,i+1200);if(excerpt.trim())passages.push({passageId:`${revisionId}-${passages.length+1}`,text:excerpt,paragraph:passages.length+1,...(page.page?{page:page.page}:{})});}
 }
 if(!passages.length)throw new AccessError(400,'caseSource.noText');return passages;
}
export async function extractSourcePages(buffer:Buffer,fileName:string){
 if(/\.pdf$/i.test(fileName)){const {PDFParse}=await import('pdf-parse');const parser=new PDFParse({data:buffer});try{const text=await parser.getText();return text.pages.map(p=>({text:p.text,page:p.num}));}finally{await parser.destroy();}}
 if(/\.docx$/i.test(fileName)){const mammoth=await import('mammoth');return [{text:(await mammoth.extractRawText({buffer})).value}];}
 if(/\.(txt|md)$/i.test(fileName))return [{text:new TextDecoder('utf-8',{fatal:true}).decode(buffer)}];
 throw new AccessError(400,'caseSource.format');
}
type StoredSource=CaseSourceMeta&{projectId:string;storagePath?:string;passagesPath:string;uploadedBy:string};
function paths(source:StoredSource,projectId:string){
 if(source.projectId!==projectId||source.passagesPath!==`projects/${projectId}/case-sources/${source.sourceId}/${source.revisionId}/passages.json`||source.storagePath&&!new RegExp(`^projects/${projectId}/case-sources/[a-zA-Z0-9_-]+$`).test(source.storagePath))throw new AccessError(400,'caseSource.invalid');
 return [source.storagePath,source.passagesPath].filter((p):p is string=>!!p);
}
async function remove(source:StoredSource,projectId:string){for(const path of paths(source,projectId)){try{await adminBucket().file(path).delete({ignoreNotFound:true});}catch{console.error('Case source cleanup failed',{projectId,sourceId:source.sourceId});}}}
export async function mutateCaseSource(projectId:string,caseId:string,user:{uid:string;email?:string},body:Record<string,unknown>){
 const collection=caseSourceCollection(projectId),id=body.action==='delete'||body.action==='replace'?String(body.sourceId):randomUUID();
 if(!/^[\w-]{1,128}$/.test(id))throw new AccessError(400,'caseSource.invalid');
 const ref=collection.doc(id),revisionId=randomUUID();let payload:StoredSource|undefined;
 if(body.action!=='delete'){
  if(!['add','replace'].includes(String(body.action))||typeof body.title!=='string'||!body.title.trim()||body.title.length>200)throw new AccessError(400,'caseSource.invalid');
  let storagePath:string|undefined,fileName=body.title.trim()+'.txt',pages:{text:string;page?:number}[];
  if(typeof body.text==='string'){pages=[{text:body.text}];}
  else{const file=await readStorageUpload({storagePath:typeof body.storagePath==='string'?body.storagePath:undefined},projectId,user.uid,'projects','case-sources');storagePath=file.storagePath;fileName=file.name;pages=await extractSourcePages(file.buffer,file.name);}
  const passages=splitCasePassages(pages,revisionId),passagesPath=`projects/${projectId}/case-sources/${id}/${revisionId}/passages.json`;
  payload={projectId,caseId,sourceId:id,title:body.title.trim(),fileName,revisionId,uploadedAt:new Date().toISOString(),uploadedBy:user.uid,passageCount:passages.length,passagesPath,...(storagePath?{storagePath}:{})};
  await adminBucket().file(passagesPath).save(Buffer.from(JSON.stringify(passages)),{resumable:false,metadata:{contentType:'application/json',cacheControl:'private, no-store'}});
 }
 let previous:StoredSource|undefined;
 try{await adminDb().runTransaction(async tx=>{
  const [project,current]=await Promise.all([tx.get(adminDb().doc(`ppssProjects/${projectId}`)),tx.get(ref)]);
  if(!project.exists||!canManageProject(user.email,project.data() as ProjectMeta))throw new AccessError(403,'caseSource.forbidden');
  if(!(project.data() as ProjectMeta).workspaceContent?.data?.cases?.some(c=>c.id===caseId))throw new AccessError(409,'caseSource.saveCaseFirst');
  if(body.action==='add'){if(current.exists)throw new AccessError(409,'caseSource.changed');const count=(await tx.get(collection.where('caseId','==',caseId))).size;if(count>=10)throw new AccessError(400,'caseSource.limit');}
  else if(!current.exists||current.data()?.caseId!==caseId||current.data()?.revisionId!==body.expectedRevisionId)throw new AccessError(409,'caseSource.changed');
  previous=current.data() as StoredSource|undefined;
  if(body.action==='delete')tx.delete(ref);else tx.set(ref,payload!);
 });}catch(error){if(payload)await remove(payload,projectId);throw error;}
 if(previous)await remove(previous,projectId);return {sourceId:id};
}
export async function pruneDeletedCaseSources(projectId:string){
 const snapshot=await caseSourceCollection(projectId).get();
 for(const doc of snapshot.docs){let removed:StoredSource|undefined;
  await adminDb().runTransaction(async tx=>{removed=undefined;const [project,source]=await Promise.all([tx.get(adminDb().doc(`ppssProjects/${projectId}`)),tx.get(doc.ref)]);const data=source.data() as StoredSource|undefined;
   if(data&&(!project.exists||!(project.data() as ProjectMeta).workspaceContent?.data?.cases?.some(item=>item.id===data.caseId))){removed=data;tx.delete(doc.ref);}
  });if(removed)await remove(removed,projectId);
 }
}
export async function caseSourceMetadata(projectId:string,caseId:string){
 const snapshot=await caseSourceCollection(projectId).where('caseId','==',caseId).get();
 return snapshot.docs.map(d=>{const {sourceId,title,fileName,revisionId,uploadedAt,passageCount}=d.data() as StoredSource;return {sourceId,caseId,title,fileName,revisionId,uploadedAt,passageCount};});
}
// Call only after authenticated project membership and saved case IDs have been resolved.
export async function readCasePassages(projectId:string,cases:CaseMaterial[]):Promise<CaseEvidence[]>{
 const output:CaseEvidence[]=[];
 for(const item of cases){const snapshot=await caseSourceCollection(projectId).where('caseId','==',item.id).get();
  for(const doc of snapshot.docs.slice(0,10)){const source=doc.data() as StoredSource;paths(source,projectId);const [buffer]=await adminBucket().file(source.passagesPath).download();if(buffer.length>2*1024*1024)throw new AccessError(400,'caseSource.tooLong');const passages=JSON.parse(buffer.toString()) as CasePassage[];
   for(const passage of passages)output.push({id:item.id,label:item.label,title:item.title,text:passage.text,sourceId:'',relevanceTerms:[],documentId:source.sourceId,documentTitle:source.title,fileName:source.fileName,revisionId:source.revisionId,passageId:passage.passageId,paragraph:passage.paragraph,...(passage.page?{page:passage.page}:{})});
  }
 }return output;
}
