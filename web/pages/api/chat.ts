import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  runtime: "nodejs",
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { apiKey, message } = req.body;

    console.log("➡️ Sending request to OpenAI");

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

    console.log("⬅️ OpenAI responded");

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
