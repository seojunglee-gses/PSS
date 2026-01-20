import type { NextApiRequest, NextApiResponse } from "next";
import { loadBackgroundKnowledge } from "../../lib/firebase";

type WorkspaceSummary = {
  stageSummaries: Record<string, string>;
  overallSummary: string;
};

const systemPromptBase =
  "You are an analyst creating structured workspace summaries for a PPSS workflow. Return ONLY valid JSON that matches the schema. No extra keys.";

const buildSystemPrompt = (backgroundKnowledge?: string) =>
  backgroundKnowledge
    ? `${systemPromptBase}\n\nBackground knowledge (stable system context for all planning stages):\n${backgroundKnowledge}`
    : systemPromptBase;

const buildPrompt = (payload: unknown) =>
  `Input JSON: ${JSON.stringify(payload)}\n\nReturn JSON with this schema:\n{\n  \"workspaceSummary\": {\n    \"stageSummaries\": {\n      \"problem\": \"...\",\n      \"data\": \"...\",\n      \"alternatives\": \"...\",\n      \"evaluation\": \"...\",\n      \"report\": \"...\"\n    },\n    \"overallSummary\": \"...\"\n  }\n}\n\nRules:\n- Workspace summary is ONLY the current user's dialogues grouped by stage.\n- Provide stage-specific insights and a concise overall summary.\n- Use abstract insights, not raw quotes.`;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
    if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS");
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
    return;
  }

  try {
    const backgroundKnowledge = await loadBackgroundKnowledge();
    const curatedBackground = backgroundKnowledge?.curatedText?.trim();
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: `${buildSystemPrompt(curatedBackground)}\n\n${buildPrompt(req.body)}`,
        text: {
          format: { type: "json_object" }, 
        },
      }),
    });
    ;

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      res.status(500).json({
        error: errorPayload?.error?.message ?? "LLM request failed.",
      });
      return;
    }

    const result = await response.json();
    const content =
    typeof result.output_text === "string"
      ? result.output_text
      : null;
    if (!content) {
      res.status(500).json({ error: "No summary content returned." });
      return;
    }

    const parsed = JSON.parse(content) as {
      workspaceSummary: WorkspaceSummary;
    };

    res.status(200).json(parsed);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}
