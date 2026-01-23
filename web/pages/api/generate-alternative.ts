import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { loadCurrentSiteImage, loadGeneratedImage, } from "../../lib/firebase";
import { callLLM } from "../../lib/llm";
import { loadBackgroundKnowledge } from "../../lib/firebase";

const buildPromptInput = (payload: {
  workspaceSummary?: Record<string, string>;
  workspaceInput?: Record<string, string[]>;
  feedback?: string;
}) => {
  const summaryText = Object.entries(payload.workspaceSummary ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  const dialogueText = Object.entries(payload.workspaceInput ?? {})
    .map(([key, value]) => {
     if (Array.isArray(value)) {
      return `${key}: ${value.slice(-2).join(" | ")}`;
    }
    if (typeof value === "string") {
      return `${key}: ${value}`;
    }
    return `${key}:`;
  })
  .join("\n");
  
  const feedbackText = payload.feedback?.trim()
    ? `\n\nUser feedback:\n${payload.feedback}`
    : "";

  return `Workspace summary:
${summaryText}

Chat log highlights:
${dialogueText}${feedbackText}`;
};

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
    const currentSiteImage = await loadCurrentSiteImage();
    if (!currentSiteImage?.downloadUrl || !currentSiteImage.imageId) {
      res.status(400).json({ error: "Current site image is not configured." });
      return;
    }

    const background = await loadBackgroundKnowledge();
    const backgroundText = background?.curatedText?.trim();

    const {
      workspaceSummary,
      workspaceInput,
      provider,
      feedback,
      userID,
    } = req.body as {
      workspaceSummary: Record<string, string>;
      workspaceInput: Record<string, string[]>;
      provider?: "openai" | "gemini";
      feedback?: string;
      userID?: string;
    };
    if (!userID) {
      throw new Error("Authentication required.");
    }

    const normalizedProvider =
      provider === "gemini" ? "gemini" : "openai";

    const systemText = `
      ROLE:
      You generate a SINGLE image-generation prompt, not the image itself.
      
      IMAGE RULES:
      - The OVERPASS refers to the elevated roadway structure crossing above streets and rail lines in the image.
      - The provided site image is the IMMUTABLE base.
      - The OVERPASS is the PRIMARY and ONLY subject to redesign.
      - Surrounding buildings, streets, and background must remain unchanged.
      - Preserve camera angle, layout, and spatial structure.
      - Do NOT create a new scene.
      - The overpass is no longer for cars (NO cars).
      
      DESIGN MODE:
      - Generate a NEW design alternative (not an edit).
      - The overpass MUST show a CLEAR and VISIBLE design change.
      - Stay close to the original structure.
      
      FOCUS:
      - Describe specific, clearly visible design elements to the OVERPASS ITSELF.
      - Base ideas on the workspace summary.
    `.trim();

    const promptInput = buildPromptInput({
          workspaceSummary,
          workspaceInput,
          feedback,
   });

    const prompt = await callLLM({
      provider: normalizedProvider,
      systemText,
      userText: promptInput
    });

    if (!prompt) {
      res.status(500).json({ error: "Prompt generation failed." });
      return;
    }
    const imageId = crypto.randomUUID();

    const existing = await loadGeneratedImage(imageId);
    if (existing?.downloadUrl) {
      res.status(200).json({
        imageId: existing.imageId,
        label: existing.label,
        prompt: existing.note,
        downloadUrl: existing.downloadUrl,
        existing: true,
      });
      return;
    }

    const imageResponse = await fetch(currentSiteImage.downloadUrl);
    if (!imageResponse.ok) {
      res.status(500).json({ error: "Unable to fetch site image." });
      return;
    }
    const imageBlob = await imageResponse.blob();

    let base64: string | undefined;

    if (normalizedProvider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
        return;
      }
    
      const formData = new FormData();
      formData.append("model", "gpt-image-1");
      formData.append("prompt", prompt);
      formData.append("image", imageBlob, "site-image.png");
      formData.append("size", "1024x1024");
    
      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });
    
      const result = await response.json();
      base64 = result.data?.[0]?.b64_json;
    
    } else {
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        res.status(500).json({ error: "GEMINI_API_KEY is not configured." });
        return;
      }
    
      const imageArrayBuffer = await imageBlob.arrayBuffer();
      const siteimageBase64 = Buffer.from(imageArrayBuffer).toString("base64");
    
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const client = new GoogleGenerativeAI(geminiKey);
    
      const model = client.getGenerativeModel({
        model: "gemini-2.5-flash-image",
      });
    
      const result = await model.generateContent([
        { text: prompt },
        {
          inlineData: {
            mimeType: imageBlob.type || "image/png",
            data: siteimageBase64,
          },
        },
      ]);

  const candidate = result.response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  
  let imageBase64: string | undefined;
  
  for (const part of parts) {
    if (part.inlineData?.data) {
      imageBase64 = part.inlineData.data;
      break;
    }
  const fileDataAny = part.fileData as any;
    if (fileDataAny?.data) {
      imageBase64 = fileDataAny.data;
      break;
    }
  }
  
  base64 = imageBase64;
}
  if (!base64) {
      throw new Error("Failed to generate image base64 data");
      }
  
      res.status(200).json({
        imageId,
        prompt,
        base64,
      });
    return;
  
    } catch (error) {
      console.error("Generate Error:", error); // 서버 로그 확인용
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unexpected error.",
      });
    }
  }
