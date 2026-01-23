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
 if (payload.mode === "iteration") {
    return payload.feedback?.trim()
      ? `User feedback:\n${payload.feedback}`
      : "User feedback: None";
  }
 const summaryText = Object.entries(payload.workspaceSummary ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const dialogueText = Object.entries(payload.workspaceInput ?? {})
    .map(([key, value]) => {
      const recent = value.slice(-2).join(" | ");
      return `${key}: ${recent}`;
    })
    .join("\n");

  return `Workspace summary:\n${summaryText}\n\nChat log highlights:\n${dialogueText}`;
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
      mode,
      workspaceSummary,
      workspaceInput,
      provider,
      feedback,
      userID,
    } = req.body as {
      mode: "initial" | "iteration";
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

    const SITE_IMAGE_RULES = `
    CRITICAL IMAGE EDITING RULE:
    - The provided site image is the IMMUTABLE base.
    - Preserve camera angle, background, layout, and spatial structure.
    - Do NOT create a new scene or a new overall composition.
    - Only apply localized, realistic modifications on top of the site image.
    `;

     const systemText = 
      SITE_IMAGE_RULES +
       (mode === "initial"
    ? `
    You are creating the FIRST design alternative.
    You write a single concise prompt for an image-edit model.
    Translate summaries into a concrete initial design.
     Please emphasize the very unique points from the dialogue in this prompt and files that can clearly appear and be seen in the image and also design that other stakeholders might not have. Mention specific elements in the dialogues to generate images. Mention the specific elements in the dialogue to generate images.
    `
        : `
      You are MODIFYING an existing design.
      Preserve the prior design intent.
      Apply user's feedback to the promt.
      
      `);

    const promptInput = buildPromptInput({
            workspaceSummary,
            workspaceInput,
            feedback
          });

    const prompt = await callLLM({
      mode,
      workspaceSummary: mode === "initial" ? workspaceSummary : undefined,
      workspaceInput: mode === "initial" ? workspaceInput : undefined,
      feedback: mode === "iteration" ? feedback : undefined,
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
      const imageBase64 = Buffer.from(imageArrayBuffer).toString("base64");
    
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
            data: imageBase64,
          },
        },
      ]);

  const parts = result.response.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p: any) => p.inlineData);

  base64 = imagePart?.inlineData?.data;
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
