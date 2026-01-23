import type { NextApiRequest, NextApiResponse } from "next";
import { loadBackgroundKnowledge } from "../../lib/firebase";
import { callLLM } from "../../lib/llm";

type ChatRequest = {
  model?: string;
  stepId?: string;
  message?: string;
  provider?: string;
};

const caseStudyContext = `
Case studies to ground analysis:
- 789 Art Zone (Beijing): adaptive reuse of industrial heritage into a creative district, grassroots artist occupation evolving into a state-recognized cultural hub, commercialization pressures, and gentrification risks.
- Gyeongui Line Forest Park (Seoul): transformation of a disused rail corridor into a linear park with citizen-led governance, neighborhood reconnection, cultural programming, and tensions around gentrification and shared-use conflicts.
- High Line (New York): elevated rail reuse into a public park driven by civic advocacy, catalyzing urban revitalization, tourism, and adjacent development pressures.
`;

const buildSystemText = (background: string | null, stepId?: string) => {
  const base = `You are a PPSS assistant. Provide concise, helpful responses aligned with the current workflow stage. Do not repeat the user's message.`;
  const backgroundText = background
    ? `\n\nBackground knowledge (stable system context for all planning stages):\n${background}`
    : "";
  const stepText =
    stepId === "data"
      ? `\n\nUse the following case studies in addition to the background knowledge:\n${caseStudyContext}`
      : stepId === "evaluation"
        ? `\n\nFor evaluation, reference each submitted design's intent and included elements from the provided context. Be explicit and structured.`
        : "";
  return `${base}${backgroundText}${stepText}`;
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
    const systemText = buildSystemText(curatedBackground ?? null, stepId);
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
