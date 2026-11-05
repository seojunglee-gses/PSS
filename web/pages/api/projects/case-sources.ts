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
 try{
  if(req.method==='GET')req.body={projectId:req.query.projectId};
  const context=await loadProjectContext(req,'data',false);
  if(!canManageProject(context.user.email,context.project))throw new AccessError(403,'caseSource.forbidden');
  const caseId=req.method==='GET'?req.query.caseId:req.body.caseId;
  if(typeof caseId!=='string'||!context.cases.some(c=>c.id===caseId))throw new AccessError(409,'caseSource.saveCaseFirst');
  if(req.method==='GET')return res.status(200).json({sources:await caseSourceMetadata(context.projectId,caseId)});
  if(req.body.action==='prepare')return res.status(200).json(await prepareStorageUpload(req,context.user.uid,'projects','case-sources'));
  return res.status(200).json(await mutateCaseSource(context.projectId,caseId,context.user,req.body));
 }catch(error){return res.status(error instanceof AccessError?error.status:503).json({error:error instanceof AccessError?error.message:'caseSource.failed'});}
}
