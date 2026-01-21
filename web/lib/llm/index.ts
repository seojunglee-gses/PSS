import { callDeepSeek } from "./deepseek";
import { callGemini } from "./gemini";
import { callOpenAI } from "./openai";

type LLMRequest = {
  provider: "openai" | "gemini" | "deepseek";
  model?: string;
  systemText: string;
  userText: string;
};

export const callLLM = async ({
  provider,
  model,
  systemText,
  userText,
}: LLMRequest): Promise<string> => {
  if (provider === "gemini") {
    return callGemini({ model, systemText, userText });
  }
  if (provider === "deepseek") {
    return callDeepSeek({ model, systemText, userText });
  }
  return callOpenAI({ model, systemText, userText });
};
