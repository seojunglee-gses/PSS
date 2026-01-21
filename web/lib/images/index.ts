import { generateGeminiImage } from "./gemini";
import { generateOpenAIImage } from "./openai";

type ImageRequest = {
  provider: "openai" | "gemini" | "deepseek";
  prompt: string;
  imageBuffer: Buffer;
  imageBase64: string;
  mimeType: string;
};

export const generateImage = async ({
  provider,
  prompt,
  imageBuffer,
  imageBase64,
  mimeType,
}: ImageRequest): Promise<string> => {
  if (provider === "gemini") {
    return generateGeminiImage({ prompt, imageBase64, mimeType });
  }
  if (provider === "openai") {
    return generateOpenAIImage({ prompt, imageBuffer, mimeType });
  }
  throw new Error("Image generation is not supported for this provider.");
};
