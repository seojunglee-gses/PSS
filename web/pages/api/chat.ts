import type { NextApiRequest, NextApiResponse } from "next";

type ChatRequest = {
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

  const { model, message, stepId } = req.body as ChatRequest;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
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
            content: [
              {
                type: "input_text",
                text:
                  "You are a PPSS assistant. Provide concise, helpful responses aligned with the current workflow stage. Do not repeat the user's message.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Stage: ${stepId ?? "unknown"}\nUser: ${message}`,
              },
            ],
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

    const content = result.output
      ?.find((item: any) => item.type === "message")
      ?.content?.find((c: any) => c.type === "output_text")
      ?.text;
    
    if (!content) {
      res.status(500).json({ error: "No reply returned." });
      return;
    }

    res.status(200).json({ reply: content });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}
