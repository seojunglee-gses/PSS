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
  for (const item of value.slice(-24).reverse()) {
    const log = record(item);
    if (!log || (stepId !== undefined && log.stepId !== stepId)) continue;
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

export function contextualQuestion(question: string, history: ConversationMessage[] = []): string {
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
  return JSON.stringify([sender, log.provider, log.text ?? "", log.imageId ?? "", log.imageUrl ?? ""]);
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
