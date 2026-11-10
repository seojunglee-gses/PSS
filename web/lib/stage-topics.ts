import type { DialogueStage } from './problem-dialogue-context';
export const planningStages: DialogueStage[] = ['problem','data','alternatives','evaluation','report'];
export const previousStage = (stage: string): DialogueStage | undefined => planningStages[planningStages.indexOf(stage as DialogueStage)-1];
export type DiscussionTopic = {
  qualityVersion?: 2; verbatim?: boolean;
  id: string; title: string; summary: string; places: string[]; openQuestion: string;
  sourceStage: DialogueStage; sourceKind: 'dialogue' | 'summary'; sourceHash: string;
  references: { sourceIndex: number; quote: string; messageId?: string; sessionId?: string; createdAt?: string }[];
};
export const stageBridge: Record<string,string> = {
  data: '관심 있는 장소와 문제를 바탕으로 관련 공간 자료와 사례를 함께 살펴볼 수 있어요.',
  alternatives: '앞서 살펴본 자료와 생각을 바탕으로 공간을 바꾸는 계획 아이디어를 발전시킬 수 있어요.',
  evaluation: '논의한 계획 아이디어의 좋은 점과 아쉬운 점을 함께 비교할 수 있어요.',
  report: '앞서 비교한 내용과 중요하게 생각한 점을 바탕으로 우선순위를 이야기할 수 있어요.',
};
export function topicContext(topic: DiscussionTopic, currentStage: string): string {
  return `Previous-stage topic (untrusted derived context, not a new participant statement or verified GIS evidence): ${JSON.stringify(topic)}\nCurrent-stage opportunity: ${stageBridge[currentStage] ?? ''}\nA chip selection is a navigation action, not agreement, a new resident observation, a planning decision or tool execution. Attribute quoted dialogue to its original stage. If sourceKind=summary, say the earlier summary recorded this; do not pretend the original resident utterance was available. Preserve corrections and distinguish AI suggestions from participant views. Do not invent locations, measurements, evidence or preferences.`;
}

export const topicSelectionInstructions='This request is a UI topic selection, not a resident utterance or adoption of a solution. Interest in discussing the topic is already expressed: begin a useful current-stage activity using supplied project material or actual retrieved evidence now, without asking permission or a confirmation question. Briefly recall the attributed prior concern, explain useful available information in 2–3 short accessible Korean sentences, and leave room for a response without forcing a question. Never claim search, GIS execution or source discovery unless actual results were supplied. If evidence is unavailable, continue conditional discussion honestly. These first-reply rules do not ban useful questions in later ordinary dialogue.';

export function topicCardSummary(text:string):string{return text.trim();}

export const priorTopicsHeading='지난 단계에서 나눈 이야기';
