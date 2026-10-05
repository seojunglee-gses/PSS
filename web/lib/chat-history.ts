const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

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
