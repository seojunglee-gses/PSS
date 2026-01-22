import type { NextApiRequest, NextApiResponse } from "next";
import { callLLM } from "../../lib/llm";
import { loadBackgroundKnowledge } from "../../lib/firebase";

const systemText = `You are a design planning expert.
Rewrite a new image-generation prompt based on user feedback.

Priority order:
1. User feedback (highest priority)
2. Previous prompt
3. Background knowledge (supporting context only)

Rules:
- Preserve the site context, camera angle, and base concept.
- Explicitly reflect the user's feedback.
- Ensure changes are visually obvious in the resulting image.
- The "prompt" must NOT mention feedback or revision.
- The "rationale" SHOULD clearly explain what changed and why.

- Also produce a short rationale explaining what changed and why. - Please emphasize the very unique points from the dialogue in this prompt and files that can clearly appear and be seen in the image and also design that other stakeholders might not have. Mention specific elements in the dialogues to generate images. Mention the specific elements in the dialogue to generate images.

Return JSON ONLY in this format:
{
  "prompt": "...",
  "rationale": "..."
}
`.trim();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { feedback, previousPrompt, provider } = req.body as {
    feedback?: string;
    previousPrompt?: string;
    provider?: "openai" | "gemini" | "deepseek";
  };

  if (!feedback?.trim()) {
    res.status(400).json({ error: "Feedback is required." });
    return;
  }

  try {
    const background = await loadBackgroundKnowledge();
    const backgroundText = background?.curatedText?.trim() ?? "None";
    const userText = [
      `Previous prompt: ${previousPrompt ?? "None"}`,
      `User feedback: ${feedback}`,
      `Background knowledge: ${backgroundText}`,
    ].join("\n\n");

    const responseText = await callLLM({
      provider: provider ?? "openai",
      model:
        provider === "gemini"
          ? "gemini-2.5-flash"
          : provider === "deepseek"
            ? "deepseek-chat"
            : "gpt-5-mini",
      systemText,
      userText,
    });

    const parsed = JSON.parse(responseText) as {
      prompt?: string;
      rationale?: string;
    };

    if (!parsed?.prompt || !parsed?.rationale) {
      res.status(500).json({ error: "Prompt revision failed." });
      return;
    }

    res.status(200).json({
      prompt: parsed.prompt,
      rationale: parsed.rationale,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}
