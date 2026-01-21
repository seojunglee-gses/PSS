import { callDeepSeek } from "./deepseek";
import { callGemini } from "./gemini";
import { callOpenAI } from "./openai";

type Provider = "openai" | "gemini" | "deepseek";

type LLMRequest = {
  provider: Provider;
  model?: string;
  systemText: string;
  userText: string;
};

function resolveModel(provider: Provider, model?: string): string {
  switch (provider) {
    case "gemini":
      if (!model || !model.startsWith("gemini-")) {
        return "gemini-3-flash-preview";
      }
      return model;

    case "deepseek":
      if (!model || !model.startsWith("deepseek")) {
        return "deepseek-chat";
      }
      return model;

    case "openai":
    default:
      return model ?? "gpt-5-mini";
  }
}

export const callLLM = async ({
  provider,
  model,
  systemText,
  userText,
}: LLMRequest): Promise<string> => {
  const resolvedModel = resolveModel(provider, model);

  if (provider === "gemini") {
    return callGemini({
      model: resolvedModel,
      systemText,
      userText,
    });
  }

  if (provider === "deepseek") {
    return callDeepSeek({
      model: resolvedModel,
      systemText,
      userText,
    });
  }

  return callOpenAI({
    model: resolvedModel,
    systemText,
    userText,
  });
};
