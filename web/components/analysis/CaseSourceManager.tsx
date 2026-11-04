import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../../lib/auth';
import {useI18n} from '../../lib/i18n';
import {projectRequest} from '../../lib/membership/client';
import {uploadProjectFile} from '../../lib/storage-upload';
import type {CaseSourceMeta} from '../../lib/research/types';
export default function CaseSourceManager({projectId,caseId,persisted}:{projectId:string;caseId:string;persisted:boolean}){
 const {user}=useAuth(),{t,localize}=useI18n();const [sources,setSources]=useState<CaseSourceMeta[]>([]),[title,setTitle]=useState(''),[text,setText]=useState(''),[file,setFile]=useState<File|null>(null),[replacement,setReplacement]=useState<CaseSourceMeta|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const version=useRef(0),input=useRef<HTMLInputElement>(null),locked=useRef(false);
 const path=`/api/projects/case-sources?${new URLSearchParams({projectId,caseId})}`;
 useEffect(()=>{const invalidate=()=>{version.current++};const current=++version.current;setSources([]);setError('');setTitle('');setText('');setFile(null);setReplacement(null);locked.current=false;setBusy(false);if(!user||!persisted)return;projectRequest(user,path).then(result=>{if(current===version.current)setSources(result.sources)}).catch(e=>{if(current===version.current)setError(e.message)});return()=>{invalidate();};},[user,path,persisted]);
 async function save(action:'add'|'replace'|'delete',source?:CaseSourceMeta){if(!user||locked.current)return;const current=++version.current;locked.current=true;setBusy(true);setError('');try{
  let uploaded={};if(action!=='delete'&&file)uploaded=await uploadProjectFile('/api/projects/case-sources',file,projectId,await user.getIdToken(),{caseId});
  await projectRequest(user,'/api/projects/case-sources',{action,projectId,caseId,...(source?{sourceId:source.sourceId,expectedRevisionId:source.revisionId}:{}),...(action==='delete'?{}:{title,...(file?uploaded:{text})})});
  if(current!==version.current)return;const result=await projectRequest(user,path);if(current!==version.current)return;setSources(result.sources);setTitle('');setText('');setFile(null);setReplacement(null);if(input.current)input.current.value='';
 }catch(e){if(current===version.current)setError(e instanceof Error?e.message:'caseSource.failed')}finally{if(current===version.current){locked.current=false;setBusy(false)}}}
 return <section className="mt-5 space-y-3 rounded-xl border border-blue-100 p-4" aria-label={t('caseSource.title')}><h5 className="font-semibold">{t('caseSource.title')}</h5><p className="text-xs text-slate-500">{t('caseSource.hint')}</p>
 {!persisted?<p className="text-sm">{t('caseSource.saveCaseFirst')}</p>:<>
 <ul className="space-y-2">{sources.map(source=><li key={source.sourceId} className="rounded-lg border bg-white p-3"><p className="break-words text-sm font-semibold">{source.title}</p><p className="break-all text-xs text-slate-500">{source.fileName}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className="spatial-button" disabled={busy} onClick={()=>{setReplacement(source);setTitle(source.title);setFile(null);setText('');}}>{t('dataset.replace')}</button><button type="button" className="spatial-button text-red-600" disabled={busy} onClick={()=>{if(window.confirm(t('caseSource.deleteConfirm')))void save('delete',source)}}>{t('common.delete')}</button></div></li>)}</ul>
 <label className="grid gap-1 text-sm">{t('caseSource.name')}<input aria-label={t('caseSource.name')} maxLength={200} disabled={busy} value={title} onChange={e=>setTitle(e.target.value)} className="min-h-11 rounded-lg border p-2"/></label>
 <label className="grid gap-1 text-sm">{t('caseSource.file')}<input ref={input} type="file" accept=".pdf,.docx,.txt,.md" disabled={busy} onChange={e=>{const selected=e.target.files?.[0]??null;setFile(selected);if(selected&&!title)setTitle(selected.name);}} className="min-w-0 max-w-full"/></label>
 <label className="grid gap-1 text-sm">{t('caseSource.text')}<textarea aria-label={t('caseSource.text')} maxLength={200000} disabled={busy||!!file} value={text} onChange={e=>setText(e.target.value)} rows={5} className="w-full rounded-lg border p-2"/></label>
 <div className="flex flex-wrap gap-2"><button type="button" className="spatial-button" disabled={busy||!title.trim()||(!file&&!text.trim())} onClick={()=>void save(replacement?'replace':'add',replacement??undefined)}>{busy?t('dataset.busy'):t(replacement?'caseSource.saveReplacement':'caseSource.add')}</button>{replacement&&<button type="button" className="spatial-button" disabled={busy} onClick={()=>{setReplacement(null);setTitle('');setFile(null);setText('')}}>{t('workspace.cancel')}</button>}</div>
 <p className="text-xs text-slate-500">{t('caseSource.immediate')}</p></>}
 {error&&<p role="alert" className="text-sm text-rose-700">{localize(error,'caseSource.failed')}</p>}</section>;
}
