import type {NextApiRequest,NextApiResponse} from 'next';
import {loadProjectContext} from '../../lib/project-context-server';
import {AccessError} from '../../lib/membership/server';
import {readStageTopics} from '../../lib/stage-topics-server';
import {previousStage,topicContext} from '../../lib/stage-topics';
import {facilitationInstructions} from '../../lib/facilitation';
import {conversationHistory} from '../../lib/chat-history';
import {callLLM} from '../../lib/llm';
import {MODELS} from '../../lib/llm/openai';
import type {DialogueStage} from '../../lib/problem-dialogue-context';
export const maxDuration=180;
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='POST'){res.status(405).json({error:'Method not allowed'});return;}
 try{
  const stage=req.body.currentStage as DialogueStage;
  const context=await loadProjectContext(req,stage,true,true);
  const sourceStage=req.body.action==='extract'?stage:previousStage(stage);
  if(!sourceStage){res.status(200).json({topics:[]});return;}
  const topics=await readStageTopics(context.projectId,context.user.uid,sourceStage);
  if(req.body.action!=='continue'){res.status(200).json({topics});return;}
  const topic=topics.find(t=>t.id===req.body.topicId);
  if(!topic)throw new AccessError(409,'선택한 논의 주제를 다시 확인해주세요.');
  const history=conversationHistory(context.stageHistory);
  const reply=await callLLM({provider:'openai',model:MODELS.chat,systemText:facilitationInstructions(stage,'선택한 이전 논의 주제를 현재 단계에서 이어가기',history)+'\nThis is a UI topic selection, not a resident utterance. Briefly recall its attributed earlier context and offer one accessible current-stage direction in 2–3 short Korean sentences. This text endpoint has not executed tools.\n'+topicContext(topic,stage),userText:JSON.stringify({currentStage:stage,topic,currentMaterial:context.currentMaterial,previousSummaries:context.previousSummaries,history})});
  res.status(200).json({topics,reply});
 }catch(error){res.status(error instanceof AccessError?error.status:503).json({error:error instanceof AccessError?error.message:'이전 이야기를 불러오지 못했어요. 잠시 후 다시 시도해주세요.'});}
}
