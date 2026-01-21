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
    model: model || "gemini-1.5-flash",
    systemInstruction: systemText,
  });
  const result = await generativeModel.generateContent(userText);
  const text = result.response.text();
  if (!text) {
    throw new Error("No reply returned.");
  }
  return text;
};
