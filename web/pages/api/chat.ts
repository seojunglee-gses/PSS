import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  runtime: "nodejs",
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    console.log("🔥 CHAT API HIT 🔥");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing server API key" });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: "Reply with exactly: API IS WORKING",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("OPENAI ERROR:", text);
      return res.status(500).json({ error: text });
    }

    const result = await response.json();
    console.log("OPENAI RESULT:", result);

    return res.status(200).json({
      reply: result.output_text,
    });
  } catch (e) {
    console.error("SERVER ERROR:", e);
    return res.status(500).json({ error: "Server crashed" });
  }
}
