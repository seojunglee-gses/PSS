import type { NextApiRequest, NextApiResponse } from "next";
import { loadBackgroundKnowledge } from "../../lib/firebase";
import { callLLM } from "../../lib/llm";

type ChatRequest = {
  model?: string;
  stepId?: string;
  message?: string;
  provider?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { model, message, stepId, provider } = req.body as ChatRequest;

  if (!message) {
    res.status(400).json({ error: "Message is required." });
    return;
  }

  try {
    const backgroundKnowledge = await loadBackgroundKnowledge();
    const curatedBackground = backgroundKnowledge?.curatedText?.trim();
    const systemText = curatedBackground
      ? `You are a PPSS assistant. Provide concise, helpful responses aligned with the current workflow stage. Do not repeat the user's message.\n\nBackground knowledge (stable system context for all planning stages):\n${curatedBackground}`
      : "You are a PPSS assistant. Provide concise, helpful responses aligned with the current workflow stage. Do not repeat the user's message.";
    const normalizedProvider =
    provider?.toLowerCase() === "gemini"
      ? "gemini"
      : provider?.toLowerCase() === "deepseek"
        ? "deepseek"
        : "openai";
  
    const resolvedModel =
      normalizedProvider === "gemini"
        ? "gemini-2.5-flash"
        : normalizedProvider === "deepseek"
          ? "deepseek-chat"
          : model ?? "gpt-5-mini";
    
    const reply = await callLLM({
      provider: normalizedProvider,
      model: resolvedModel,
      systemText,
      userText: `Stage: ${stepId ?? "unknown"}\nUser: ${message}`,
    });
    res.status(200).json({
      provider: normalizedProvider,
      model,
      reply,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}
