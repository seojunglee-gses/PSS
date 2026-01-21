import { GoogleGenerativeAI } from "@google/generative-ai";

type GeminiImageRequest = {
  prompt: string;
  imageBase64: string;
  mimeType: string;
};

export const generateGeminiImage = async ({
  prompt,
  imageBase64,
  mimeType,
}: GeminiImageRequest): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({ model: "gemini-2.5-flash-image" });
  const result = await model.generateContent([
    { text: prompt },
    {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    },
  ]);
  const parts = result.response.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    throw new Error("No image returned.");
  }
  return imagePart.inlineData.data;
};
