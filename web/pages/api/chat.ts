import type { NextApiRequest, NextApiResponse } from "next";

type ChatRequest = {
  apiKey?: string;
  provider?: string;
  model?: string;
  stepId?: string;
  message?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { apiKey, model, message, stepId } = req.body as ChatRequest;
  if (!apiKey) {
    res.status(400).json({ error: "API key is missing." });
    return;
  }

  if (!message) {
    res.status(400).json({ error: "Message is required." });
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
        model: model || "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "You are a PPSS assistant. Provide concise, helpful responses aligned with the current workflow stage. Do not repeat the user's message.",
          },
          {
            role: "user",
            content: `Stage: ${stepId ?? "unknown"}\nUser: ${message}`,
          },
        ],
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
    const content = result.output_text;
    if (!content) {
      console.error("RAW RESULT:", JSON.stringify(result, null, 2));
      res.status(500).json({ error: "No reply returned." });
      return;
}


    res.status(200).json({ reply: content });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
  console.log("OPENAI RAW RESPONSE:", JSON.stringify(result, null, 2));

}
