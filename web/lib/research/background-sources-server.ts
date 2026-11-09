import {adminBucket,adminDb} from '../firebaseAdmin';
import {validProjectId} from '../membership/server';
import {MAX_UPLOAD_BYTES} from '../storage-upload-server';
import {extractSourcePages,splitCasePassages} from './case-sources-server';
import type {CasePassage} from './types';
import {translate,type Locale} from '../i18n';

type Archive={id:string;projectId?:unknown;fileName?:unknown;storagePath?:unknown;contentType?:unknown;uploadedAt?:unknown};
type Extracted={passages:CasePassage[];partial:boolean};
const cache=new Map<string,{expires:number;value:Promise<Extracted>}>();
const MAX_TEXT=200000,MAX_BYTES=20*1024*1024;
const topics:[RegExp,string[]][]=[
 [/예산|사업비|공사비|비용|재원|투자|\bbudget|cost|funding/i,['예산','사업비','공사비','비용','재원','budget','cost','funding']],
 [/기간|일정|착공|준공|언제|\bschedule|timeline|completion/i,['기간','일정','착공','준공','연도','schedule','timeline','completion']],
 [/면적|규모|넓이|\barea|size/i,['면적','규모','넓이','area','size']],
 [/도로|보도|차로|도로폭|\bstreet|road|width/i,['도로','보도','차로','도로폭','street','road','width']],
 [/인구|세대|가구|population|household/i,['인구','세대','가구','population','household']],
 [/조례|법령|규정|지침|제한|기준|regulation|ordinance/i,['조례','법령','규정','지침','제한','기준','regulation','ordinance']],
 [/담당|주체|기관|운영|\boperator|responsib/i,['담당','주체','기관','운영','operator','responsible']],
];
export function needsBackgroundOriginal(question:string):boolean{
 return /원문|원본|문서에서|자료에서.{0,12}(?:확인|근거|찾)|\.(?:pdf|docx|txt|md)\b|(?:PDF|DOCX)(?:에서|의)|첨부.{0,10}(?:내용|근거|찾|확인)|\b(?:original|source document|exact wording)\b/i.test(question)
  || topics.some(([pattern])=>pattern.test(question))&&/[?？]|얼마|몇|언제|알려|확인|근거|구체|정확|총|궁금|설명|정리|비교|구분|차이|항목|내역|how|what|when|which|show|tell/i.test(question);
}
function terms(question:string):string[]{
 const stop=/^(?:이런|그런|현재|이번|사업|프로젝트|자료|원문|원본|문서|내용|구체적|정확한|얼마|몇|알려|알려줘|알려주세요|확인|해주세요|해줘|찾아줘|무엇|어떻게|what|when|which|this|that|the|please|project|document|original|pdf|docx|txt|md)$/i;
 const words=(question.match(/[가-힣]{2,}|[a-z0-9]{3,}/gi)??[]).flatMap(word=>{
  const bare=word.replace(/(?:에서|으로|에는|에게|은|는|이|가|을|를|의|와|과|도)$/,'');
  return [word,...(bare.length>=2?[bare]:[])];
 }).filter(word=>!stop.test(word));
 return [...new Set([...words,...topics.filter(([pattern])=>pattern.test(question)).flatMap(([,values])=>values)].map(s=>s.toLowerCase()))];
}
function boundedPages(pages:{text:string;page?:number}[]):{pages:typeof pages;partial:boolean}{
 let remaining=MAX_TEXT,partial=false;
 const selected=pages.flatMap(page=>{const text=page.text.slice(0,remaining);remaining-=text.length;if(text.length<page.text.length)partial=true;return text.trim()?[{...page,text}]:[];});
 return {pages:selected,partial};
}
async function original(projectId:string,archive:Archive,budget:{bytes:number}):Promise<Extracted|undefined>{
 const path=archive.storagePath;
 if(typeof path!=='string'||archive.projectId!==projectId||!path.startsWith('ppss-background-knowledge/originals/'+projectId+'/')
  ||path.split('/').length!==4||path.includes('..'))throw Error('invalid original scope');
 const file=adminBucket().file(path),[metadata]=await file.getMetadata(),size=Number(metadata.size);
 if(metadata.metadata?.projectId!==projectId||!Number.isSafeInteger(size)||size<=0||size>MAX_UPLOAD_BYTES)throw Error('invalid original metadata');
 const name=String(archive.fileName),type=String(metadata.contentType??archive.contentType??'');
 const parserName=/\.(?:pdf|docx|txt|md)$/i.test(name)?name:type==='application/pdf'?name+'.pdf':type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'?name+'.docx':type.startsWith('text/')?name+'.txt':undefined;
 if(!parserName)throw Error('no searchable text format');
 const key=typeof metadata.generation==='string'?projectId+'/'+path+'/'+metadata.generation:undefined;
 const cached=key?cache.get(key):undefined;
 if(cached&&cached.expires>Date.now())return cached.value;
 if(size>budget.bytes)return;
 budget.bytes-=size;
 const value=(async()=>{
  const [buffer]=await file.download();if(buffer.length!==size)throw Error('original bytes changed');
  const pages=boundedPages(await extractSourcePages(buffer,parserName));
  return {passages:splitCasePassages(pages.pages,'background'),partial:pages.partial};
 })();
 if(key){if(cache.size>=10)cache.delete(cache.keys().next().value!);cache.set(key,{expires:Date.now()+5*60000,value});}
 try{return await value;}catch(error){if(key)cache.delete(key);throw error;}
}
// The caller must first resolve project membership through loadProjectContext.
// Paths and generations come from project archives/storage metadata, never a chat request.
export async function backgroundOriginalContext(projectId:string,question:string,sourceIds?:string[]):Promise<{text:string;warnings:string[]}>{
 validProjectId(projectId);
 const locale:Locale=/[가-힣]/.test(question)?'ko':/[\u3400-\u9fff]/.test(question)?'zh':'en';
 const warnings=new Set<string>(),queryTerms=terms(question);
 const pageMatch=question.match(/(?:p(?:age)?\.?\s*(\d+)|(\d+)\s*(?:쪽|페이지))/i),requestedPage=pageMatch?Number(pageMatch[1]??pageMatch[2]):undefined;
 if((!queryTerms.length&&!requestedPage)||(requestedPage!==undefined&&(!Number.isSafeInteger(requestedPage)||requestedPage<1)))return {text:'',warnings:[translate(locale,'backgroundSource.noMatch')]};
 try{
  const collection=adminDb().collection('ppssBackgroundKnowledgeArchives_'+projectId);
  const legacy=sourceIds===undefined;
  const docs=sourceIds===undefined?(await collection.orderBy('uploadedAt','desc').limit(10).get()).docs:
   await Promise.all(sourceIds.filter(id=>/^[a-zA-Z0-9_-]{1,128}$/.test(id)).slice(0,10).map(id=>collection.doc(id).get()));
  const archives=docs.filter(doc=>doc.exists).map(doc=>({...doc.data(),id:doc.id} as Archive));
  const score=(text:string)=>queryTerms.reduce((n,term)=>n+(text.toLowerCase().includes(term)?1:0),0);
  archives.sort((a,b)=>score(String(b.fileName??''))-score(String(a.fileName??'')));
  const ranked:{archive:Archive;passage:CasePassage;all:CasePassage[];index:number;score:number}[]=[];
  const seen=new Set<unknown>(),budget={bytes:MAX_BYTES};let searched=0;
  for(const archive of archives){
   if(seen.has(archive.storagePath))continue;seen.add(archive.storagePath);
   if(typeof archive.fileName!=='string'||!archive.fileName.trim()){warnings.add('backgroundSource.unreadable');continue;}
   try{
    const extracted=await original(projectId,archive,budget);
    if(!extracted){warnings.add('backgroundSource.partial');continue;}
    searched++;if(extracted.partial)warnings.add('backgroundSource.partial');
    extracted.passages.forEach((passage,index)=>{
     if(requestedPage&&passage.page!==requestedPage)return;
     const relevance=score(passage.text)*3+score(String(archive.fileName))+(requestedPage?1:0);
     if(relevance)ranked.push({archive,passage,all:extracted.passages,index,score:relevance});
    });
   }catch{warnings.add('backgroundSource.unreadable');}
  }
  ranked.sort((a,b)=>b.score-a.score);
  const selected:{archive:Archive;passage:CasePassage}[]=[],ids=new Set<string>();
  for(const hit of ranked.slice(0,4))for(const index of [hit.index,hit.index-1,hit.index+1]){
   const passage=hit.all[index],key=hit.archive.id+'/'+index;
   if(!passage||(requestedPage&&passage.page!==requestedPage)||ids.has(key)||selected.length>=8)continue;ids.add(key);selected.push({archive:hit.archive,passage});
  }
  if(!selected.length)warnings.add(searched?'backgroundSource.noMatch':'backgroundSource.unreadable');
  const excerpts=selected.map(({archive,passage})=>{
   const location=passage.page?'p.'+passage.page:translate(locale,'backgroundSource.paragraph',{number:passage.paragraph});
   return translate(locale,'backgroundSource.excerpt',{file:String(archive.fileName).slice(0,255).replace(/[\r\n]/g,' '),location})
    +(typeof archive.uploadedAt==='string'?' ['+archive.uploadedAt.slice(0,40)+']':'')+'\n'+passage.text;
  }).join('\n\n');
  if(legacy&&selected.length)warnings.add('backgroundSource.legacy');
  return {text:excerpts,warnings:[...warnings].map(key=>translate(locale,key))};
 }catch{return {text:'',warnings:[translate(locale,'backgroundSource.unavailable')]};}
}
