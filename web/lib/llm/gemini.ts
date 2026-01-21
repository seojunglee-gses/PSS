import { GoogleGenerativeAI } from "@google/generative-ai";

type GeminiRequest = {
  model?: string;
  systemText: string;
  userText: string;
};

export const callGemini = async ({
  model,
  systemText,
  userText,
}: GeminiRequest): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const client = new GoogleGenerativeAI(apiKey);

  const generativeModel = client.getGenerativeModel({
    model: `models/${model ?? "gemini-2.5-flash"}`,
    systemInstruction: systemText,
    
  });

  const result = await generativeModel.generateContent({
    contents: [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ],
  });

  const text = result.response.text();
  if (!text) {
    throw new Error("No reply returned from Gemini.");
  }

  return text;
};
