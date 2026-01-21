import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { loadCurrentSiteImage, loadGeneratedImage } from "../../lib/firebase";
import { callLLM } from "../../lib/llm";

const buildPromptInput = (payload: {
  workspaceSummary?: Record<string, string>;
  workspaceInput?: Record<string, string[]>;
}) => {
  const summaryText = Object.entries(payload.workspaceSummary ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const dialogueText = Object.entries(payload.workspaceInput ?? {})
    .map(([key, value]) => `${key}: ${value.join(" ")}`)
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

    const { workspaceSummary, workspaceInput } = req.body as {
      workspaceSummary: Record<string, string>;
      workspaceInput: Record<string, string[]>;
    };

    const promptInput = buildPromptInput({ workspaceSummary, workspaceInput });
    const prompt = (await callLLM({
      provider: "openai",
      model: "gpt-5-mini",
      systemText:
        "You write a single concise prompt for an image-edit model. Use the site image as the base context and propose one grounded design alternative. Keep the camera angle and background structure unchanged. Output only the prompt text, no extra formatting.",
      userText: promptInput,
    })).trim();
    if (!prompt) {
      res.status(500).json({ error: "Prompt generation failed." });
      return;
    }
    const imageId = crypto
      .createHash("sha256")
      .update(`${currentSiteImage.imageId}-${prompt}`)
      .digest("hex");

    const existing = await loadGeneratedImage(imageId);
    if (existing?.downloadUrl) {
      res.status(200).json({
        imageId: existing.imageId,
        label: existing.label,
        note: existing.note,
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

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      res.status(500).json({
        error: errorPayload?.error?.message ?? "Image generation failed.",
      });
      return;
    }

    const result = await response.json();
    const base64 = result.data?.[0]?.b64_json as string | undefined;
    if (!base64) {
      res.status(500).json({ error: "No image data returned." });
      return;
    }

    res.status(200).json({
      imageId,
      label: "Generated Concept",
      note: "Generated with the current site image and recent workspace context.",
      base64,
      existing: false,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}
