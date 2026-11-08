const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

export type ConversationMessage = { role: "user" | "assistant"; content: string };

// Share the same bounded, text-only context on the client and API boundary.
export function conversationHistory(value: unknown, stepId?: string): ConversationMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: ConversationMessage[] = [];
  let remaining = 16000;
  for (const item of [...value].reverse()) {
    const log = record(item);
    if (!log || log.activity || (stepId !== undefined && log.stepId !== stepId)) continue;
    const role = log.role ?? log.sender;
    const content = log.content ?? log.text;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) continue;
    const text = content.trim().slice(0, Math.min(4000, remaining));
    if (!text) break;
    messages.unshift({ role, content: text });
    remaining -= text.length;
    if (messages.length === 12 || !remaining) break;
  }
  return messages;
}

// Recover only an explicit, immediately pending clarification from existing stage dialogue.
// Ordinary reflective questions and independent new requests must not pin a new topic to an old task.
export function clarificationExchange(question: string, history: ConversationMessage[] = []): { request: string; answers: string[] } | undefined {
  if (!question.trim() || question.length > 500 || /취소|그만|다른\s*(?:질문|주제)|그(?:건|거|것)(?:은)?\s*말고|대신|cancel|forget that|new topic|instead|^(?:네|예|응|ok|thanks|감사합니다)[.!?\s]*$/i.test(question)
    || /(?:보여|찾아|검색해|생성해|그려|실행해|계산해|분석해|비교해)(?:줘|주세요)?[.!?\s]*$|\b(?:find|search|generate|draw|show)\b/i.test(question)) return;
  const pending = (text: string) => text.length < 700 && (/장소를 찾지 못했습니다[\s\S]*위치나 이름|No places were found[\s\S]*(?:location|name)/i.test(text) || /[?？]|알려주세요|provide/i.test(text) && (
    /어떤\s*(?:두\s*)?(?:지역|장소|위치|대상|자료|시설|종류|효과|기준|부분|점|방향|변화|대안).*(?:볼까요|비교할|확인하고|찾고|중요|개선하고|말씀|알려)|어느\s*(?:두\s*)?(?:지역|장소|위치)|말씀하시는\s*(?:건가요|뜻)|실행할.*(?:자료|대상|거리).*알려|실행할.*나머지.*알려/i.test(text)
    || /which (?:two |other )?(?:areas?|places?|locations?|targets?|effects?|criteria|facilities)|what (?:kind|type|effect)|do you mean|provide.*(?:layers|target|distance).*execute/i.test(text)));
  let index = history.length - 1;
  const answers = [question.trim()];
  let request: string | undefined;
  for (let turns = 0; turns < 3 && index >= 1; turns++) {
    const assistant = history[index], user = history[index - 1];
    if (assistant.role !== 'assistant' || user.role !== 'user' || !pending(assistant.content)) break;
    request = user.content;
    index -= 2;
    if (turns < 2 && index >= 0 && history[index].role === 'assistant' && pending(history[index].content)) answers.unshift(request);
    else break;
  }
  return request ? { request, answers } : undefined;
}

export function contextualQuestion(question: string, history: ConversationMessage[] = []): string {
  const clarified = clarificationExchange(question, history);
  if (clarified) return [clarified.request, ...clarified.answers].join("\n");
  const followUp = /(?:그|해당|위|앞서|이전|이)\s*(?:내용|논문|연구|사례|자료|결과|방법|대안|답변|사업)|거기|그럼|그러면|좀\s*더|더\s*자세|이어서|계속|(?:첫|두|세|[1-9])\s*번째|\b(?:this|that|these|those|previous|above|them|it|more|continue|expand)\b/i;
  if (!followUp.test(question)) return question;
  const questions = history.filter((message) => message.role === "user");
  const anchor = [...questions].reverse().find((message) => !followUp.test(message.content)) ?? questions[questions.length - 1];
  return anchor ? `${anchor.content.slice(0, 1500)}\n${question}` : question;
}

const timestamp = (value: unknown): string => {
  const createdAt = record(value)?.createdAt;
  return typeof createdAt === "string" ? createdAt : "";
};

const contentKey = (value: unknown): string | undefined => {
  const log = record(value);
  if (!log) return JSON.stringify(value);
  const sender = log.sender === "Planner" ? "user" : log.sender === "ChatGPT" ? "assistant" : log.sender;
  return JSON.stringify([sender, log.provider, log.text ?? "", log.imageId ?? "", log.imageUrl ?? "", record(log.activity)?.id ?? ""]);
};

// Each client submits a snapshot. Retain records from other clients rather than
// replacing their newer messages with an older snapshot of the conversation.
export function mergeStepChatLogs<T>(stored: T[], incoming: T[]): T[] {
  const merged = [...stored];
  const matched = new Set<number>();
  for (const log of incoming) {
    const key = contentKey(log);
    const createdAt = timestamp(log);
    const index = merged.findIndex((existing, position) => {
      if (matched.has(position) || contentKey(existing) !== key) return false;
      const existingTime = timestamp(existing);
      return !existingTime || !createdAt || existingTime === createdAt;
    });
    if (index < 0) {
      matched.add(merged.push(log) - 1);
    } else {
      // Legacy messages without timestamps remain intact; their temporary
      // display timestamps differ when restored on separate devices.
      if (timestamp(merged[index])) merged[index] = log;
      matched.add(index);
    }
  }
  return merged.sort((a, b) => timestamp(a).localeCompare(timestamp(b)));
}
