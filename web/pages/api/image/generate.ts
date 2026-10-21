import { storeGeneratedImage } from "../../../lib/generated-image-server";
import { AccessError } from "../../../lib/membership/server";
import type { NextApiRequest, NextApiResponse } from "next";
import { adminDb } from "../../../lib/firebaseAdmin";
import { loadProjectContext } from "../../../lib/project-context-server";
import { generateImage } from "../../../lib/images";

type ImageRequest = {
  provider?: string;
  stepId?: string;
  prompt?: string;
  baseImageId?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { provider, stepId, prompt, baseImageId } = req.body as ImageRequest;
  if (stepId !== "alternatives") {
    res.status(400).json({ error: "Image generation is only for step 3." });
    return;
  }
  if (!prompt) {
    res.status(400).json({ error: "Prompt is required." });
    return;
  }
  const normalizedProvider =
    provider?.toLowerCase() === "gemini"
      ? "gemini"
      : provider?.toLowerCase() === "deepseek"
        ? "deepseek"
        : "openai";

  try {
    const context = await loadProjectContext(req, "alternatives");
    const baseImage = (await adminDb().doc(baseImageId
      ? `ppssGeneratedImages_${context.projectId}/${baseImageId}`
      : `ppssSiteImages_${context.projectId}/current`).get()).data();
    const baseImageUrl = baseImage?.downloadUrl;
    if (!baseImageUrl) {
      res.status(400).json({
        error: baseImageId
          ? "Base image is not available."
          : "Site image is not configured.",
      });
      return;
    }
    const imageResponse = await fetch(baseImageUrl);
    if (!imageResponse.ok) {
      res.status(500).json({ error: "Unable to load site image." });
      return;
    }
    const mimeType =
      imageResponse.headers.get("content-type") ?? "image/png";
    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const imageBase64 = buffer.toString("base64");

    const effectivePrompt = baseImageId
      ? `You are editing the provided image.
    Preserve the original composition, layout, and camera angle.
    Apply only the following modifications:
    ${prompt}`
      : prompt;

    const base64 = await generateImage({
      provider: normalizedProvider,
      prompt: effectivePrompt,
      imageBuffer: buffer,
      imageBase64,
      mimeType,
    });
    const imageId = crypto.randomUUID();

    const saved = await storeGeneratedImage({ projectId: context.projectId, imageId, base64, note: effectivePrompt,
      label: "Alternative", userId: context.user.uid });
    res.status(200).json({ imageId, downloadUrl: saved.downloadUrl, createdAt: saved.createdAt });
  } catch (error) {
    res.status(error instanceof AccessError ? error.status : 500).json({
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}
