import type { NextApiRequest, NextApiResponse } from "next";
import { adminDb, verifyAdminRequest } from "../../../lib/firebaseAdmin";
import { loadBackgroundKnowledge } from "../../../lib/firebase";

type WorkspaceSummary = {
  stageSummaries: Record<string, string>;
  overallSummary: string;
};

const stageOrder = [
  { id: "problem", label: "Problem Definition" },
  { id: "data", label: "Data Analysis" },
  { id: "alternatives", label: "Design/Plan Alternatives" },
  { id: "evaluation", label: "Design/Plan Evaluation" },
  { id: "report", label: "Design/Plan Decision" },
];

const systemPromptBase =
  "You are an analyst generating an executive summary for a PPSS workflow report. Return ONLY valid JSON that matches the schema. No extra keys.";

const buildSystemPrompt = (backgroundKnowledge?: string) =>
  backgroundKnowledge
    ? `${systemPromptBase}\n\nBackground knowledge (stable system context for all planning stages):\n${backgroundKnowledge}`
    : systemPromptBase;

const buildPrompt = (payload: unknown) =>
  `Input JSON: ${JSON.stringify(payload)}\n\nReturn JSON with this schema:\n{\n  \"keywords\": [\"...\"],\n  \"stageSummaries\": {\n    \"problemDefinition\": \"...\",\n    \"dataAnalysis\": \"...\",\n    \"designAlternatives\": \"...\",\n    \"designEvaluation\": \"...\",\n    \"decision\": \"...\"\n  }\n}\n\nRules:\n- Summaries reflect all participants' workspace dialogue summaries.\n- Keywords should capture recurring themes across accumulated dialogues.\n- Keep output concise and structured.`;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await verifyAdminRequest(req.headers.authorization);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
      return;
    }

    const db = adminDb();
    const snapshot = await db.collection("ppssWorkspaceSummaries").get();
    const summaries = snapshot.docs.map((docSnap) => ({
      userId: docSnap.id,
      summary: docSnap.data() as WorkspaceSummary,
    }));

    const stageCounts = stageOrder.reduce<Record<string, number>>(
      (acc, stage) => {
        acc[stage.id] = summaries.filter((entry) =>
          entry.summary.stageSummaries?.[stage.id]?.trim()
        ).length;
        return acc;
      },
      {}
    );

    const currentStage =
      [...stageOrder]
        .reverse()
        .find((stage) => stageCounts[stage.id] > 0)?.label ??
      stageOrder[0].label;

    const aggregated = stageOrder.reduce<Record<string, string[]>>(
      (acc, stage) => {
        acc[stage.id] = summaries
          .map((entry) => entry.summary.stageSummaries?.[stage.id])
          .filter((text): text is string => Boolean(text && text.trim()));
        return acc;
      },
      {}
    );

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
        input: [
          { role: "system", content: buildSystemPrompt(curatedBackground) },
          {
            role: "user",
            content: buildPrompt({
              participants: summaries.length,
              stageCounts,
              stageSummaries: aggregated,
            }),
          },
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
      keywords: string[];
      stageSummaries: {
        problemDefinition: string;
        dataAnalysis: string;
        designAlternatives: string;
        designEvaluation: string;
        decision: string;
      };
    };

    const payload = {
      keywords: parsed.keywords ?? [],
      currentStage,
      stageSummaries: parsed.stageSummaries ?? {
        problemDefinition: "",
        dataAnalysis: "",
        designAlternatives: "",
        designEvaluation: "",
        decision: "",
      },
      createdAt: new Date().toISOString(),
    };

    await db.collection("ppssExecutiveSummaries").add(payload);

    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}
