import type {NextApiRequest,NextApiResponse} from 'next';
import {loadProjectContext} from '../../lib/project-context-server';
import {AccessError} from '../../lib/membership/server';
import {readStoredStageTopics,prepareStageTopics} from '../../lib/stage-topics-server';
import {previousStage} from '../../lib/stage-topics';
import type {DialogueStage} from '../../lib/problem-dialogue-context';
export const maxDuration=180;
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='POST'){res.status(405).json({error:'Method not allowed'});return;}
 try{
  // Older open browser tabs also use the existing chat handlers, never a second agent.
  if(req.body.action==='continue'){
    const stage=req.body.currentStage;
    if(!previousStage(stage))throw new AccessError(400,'단계를 확인해주세요.');
    req.body={projectId:req.body.projectId,stepId:stage,continuityTopicId:req.body.topicId,topicSelection:true,provider:'openai',...(stage==='data'?{question:'선택한 이전 주제로 자료 확인을 시작해 주세요.',selectedSources:['project']}:{message:'선택한 이전 주제로 현재 단계의 활동을 시작해 주세요.'})};
    const {default:chat}=stage==='data'?await import('./research/answer'):await import('./chat');
    return await chat(req,res);
  }
  if(req.body.action&& !['read','extract'].includes(req.body.action))throw new AccessError(409,'화면을 새로고침한 뒤 주제를 다시 선택해주세요.');
  const stage=req.body.currentStage as DialogueStage;
  const context=await loadProjectContext(req,stage,false,false);
  if(req.body.action==='extract'){await prepareStageTopics(context.projectId,context.user.uid,stage);res.status(200).json({ok:true});return;}
  const prior=previousStage(stage);
  res.status(200).json({topics:prior?await readStoredStageTopics(context.projectId,context.user.uid,prior):[]});
 }catch(error){res.status(error instanceof AccessError?error.status:503).json({error:error instanceof AccessError?error.message:'이전 이야기를 불러오지 못했어요. 잠시 후 다시 시도해주세요.'});}
}
