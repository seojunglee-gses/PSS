import type { NextApiRequest, NextApiResponse } from "next";

type ExecutiveSummary = {
  keywords: string[];
  currentStage: string;
  stageSummaries: {
    problemDefinition: string;
    dataAnalysis: string;
    designAlternatives: string;
    designEvaluation: string;
    decision: string;
  };
};

type WorkspaceSummary = {
  stageSummaries: Record<string, string>;
  overallSummary: string;
};

const systemPrompt =
  "You are an analyst creating structured summaries for a PPSS workflow report. Return ONLY valid JSON that matches the schema. No extra keys.";

const buildPrompt = (payload: unknown) =>
  `Input JSON: ${JSON.stringify(payload)}\n\nReturn JSON with this schema:\n{\n  \"executiveSummary\": {\n    \"keywords\": [\"keyword1\", \"keyword2\", \"keyword3\", \"keyword4\"],\n    \"currentStage\": \"Problem Definition | Data Analysis | Design Alternatives | Design Evaluation | Decision\",\n    \"stageSummaries\": {\n      \"problemDefinition\": \"...\",\n      \"dataAnalysis\": \"...\",\n      \"designAlternatives\": \"...\",\n      \"designEvaluation\": \"...\",\n      \"decision\": \"...\"\n    }\n  },\n  \"workspaceSummary\": {\n    \"stageSummaries\": {\n      \"problem\": \"...\",\n      \"data\": \"...\",\n      \"alternatives\": \"...\",\n      \"evaluation\": \"...\",\n      \"report\": \"...\"\n    },\n    \"overallSummary\": \"...\"\n  }\n}\n\nRules:\n- Keywords: exactly 4 items.\n- Base executive summary on ALL users' dialogues grouped by stage and stakeholder.\n- Workspace summary is ONLY the current user's dialogues grouped by stage.\n- Use abstract insights, not raw quotes.`;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
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
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildPrompt(req.body) },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      res.status(500).json({
        error: errorPayload?.error?.message ?? "LLM request failed.",
      });
      return;
    }

    const result = await response.json();
    const content = result?.output?.[0]?.content?.[0]?.text;
    if (!content) {
      res.status(500).json({ error: "No summary content returned." });
      return;
    }

    const parsed = JSON.parse(content) as {
      executiveSummary: ExecutiveSummary;
      workspaceSummary: WorkspaceSummary;
    };

    res.status(200).json(parsed);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}
