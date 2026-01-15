import type { NextApiRequest, NextApiResponse } from "next";

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
        input: `${systemPrompt}\n\n${buildPrompt(req.body)}`,
        text: {
          format: { type: "json_object" },
        },
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
      res.status(500).json({ error: "No summary content returned." });
      return;
    }

    const parsed = JSON.parse(content);

    res.status(200).json(parsed);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}
