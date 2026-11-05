import type {NextApiRequest,NextApiResponse} from 'next';
import {loadProjectContext} from '../../../lib/project-context-server';
import {canManageProject} from '../../../lib/rbac';
import {AccessError} from '../../../lib/membership/server';
import {prepareStorageUpload} from '../../../lib/storage-upload-server';
import {caseSourceMetadata,mutateCaseSource} from '../../../lib/research/case-sources-server';
export const config={api:{bodyParser:{sizeLimit:'400kb'}}};
export const maxDuration=60;
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader('Cache-Control','private, no-store');if(!['GET','POST'].includes(req.method??'')){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
 let phase='authorize',authenticated=false,projectId:string|undefined,caseId:string|undefined;
 try{
  if(req.method==='GET')req.body={projectId:req.query.projectId};
  const context=await loadProjectContext(req,'data',false);
  authenticated=true;projectId=context.projectId;
  if(!canManageProject(context.user.email,context.project))throw new AccessError(403,'caseSource.forbidden');
  const requestedCaseId=req.method==='GET'?req.query.caseId:req.body.caseId;
  if(typeof requestedCaseId!=='string'||!context.cases.some(c=>c.id===requestedCaseId))throw new AccessError(409,'caseSource.saveCaseFirst');
  caseId=requestedCaseId;phase=req.method==='GET'?'list':req.body.action==='prepare'?'prepare-upload':'process-source';
  if(req.method==='GET')return res.status(200).json({sources:await caseSourceMetadata(context.projectId,caseId)});
  if(req.body.action==='prepare')return res.status(200).json(await prepareStorageUpload(req,context.user.uid,'projects','case-sources'));
  return res.status(200).json(await mutateCaseSource(context.projectId,caseId,context.user,req.body));
 }catch(error){
  if(!(error instanceof AccessError)){
   const value=error as {code?:unknown;name?:unknown;message?:unknown};
   const workerMissing=typeof value?.message==='string'&&/Setting up fake worker failed|pdf\.worker.*Cannot find module/i.test(value.message);
   const rawCode=String(value?.code??value?.name??'unknown');
   console.error('Case answer source request failed',{phase,authenticated,projectId,caseId,code:workerMissing?'pdf/worker-unavailable':/^[\w/-]{1,80}$/.test(rawCode)?rawCode:'unknown'});
  }
  return res.status(error instanceof AccessError?error.status:503).json({error:error instanceof AccessError?error.message:'caseSource.failed'});
 }
}
