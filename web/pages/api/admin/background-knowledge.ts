import type { NextApiRequest, NextApiResponse } from "next";
import { adminBucket, adminDb, verifyAdminRequest } from "../../../lib/firebaseAdmin";

type UploadedFile = {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  data: string;
};

const stripDataPrefix = (data: string) =>
  data.includes(",") ? data.split(",")[1] : data;

const isImageType = (type: string) =>
  type.startsWith("image/") || ["image/png", "image/jpeg"].includes(type);

const truncate = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid Authorization header" });
    }

    const token = authHeader.replace("Bearer ", "");
    const decoded = await verifyAdminRequest(token);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
    }

    const { files } = req.body as { files?: UploadedFile[] };
    if (!files?.length) {
      res.status(400).json({ error: "At least one file is required." });
      return;
    }

    const bucket = adminBucket();
    const db = adminDb();
    const timestamp = new Date().toISOString();

    const textChunks: string[] = [];
    const imageInputs: { type: "input_image"; image_url: string }[] = [];
    const fileInputs: {
      type: "input_file";
      filename: string;
      file_data: string;
      mime_type?: string;
    }[] = [];

    await Promise.all(
      files.map(async (file) => {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `ppss-background-knowledge/originals/${timestamp}-${safeName}`;
        const raw = stripDataPrefix(file.data);
        const buffer = Buffer.from(raw, "base64");
        await bucket.file(storagePath).save(buffer, {
          contentType: file.type || "application/octet-stream",
        });

        await db.collection("ppssBackgroundKnowledgeArchives").add({
          fileName: file.name,
          storagePath,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          uploadedAt: timestamp,
          uploadedBy: decoded.email ?? decoded.uid,
        });

        if (isImageType(file.type)) {
          imageInputs.push({
            type: "input_image",
            image_url: `data:${file.type};base64,${raw}`,
          });
        } else if (file.type.startsWith("text/")) {
          const extracted = Buffer.from(raw, "base64").toString("utf-8");
          if (extracted.trim()) {
            textChunks.push(
              `File: ${file.name}\n${truncate(extracted.trim(), 12000)}`
            );
          }
        } else {
          fileInputs.push({
            type: "input_file",
            filename: file.name,
            file_data: raw,
            mime_type: file.type || undefined,
          });
        }
      })
    );

    if (!textChunks.length && !imageInputs.length && !fileInputs.length) {
      res.status(400).json({
        error: "Unable to extract any text or images from the uploaded files.",
      });
      return;
    }

    const promptText = `Summarize the uploaded background knowledge for the PPSS workspace.\n\nInstructions:\n- Write in Korean.\n- Capture 핵심 요약 so every workspace user can rely on it.\n- Organize with short headings for: 프로젝트 개요, 물리적 조건, 사회적 조건, 자주 요청되는 사항, 제약/주의사항.\n- Keep it concise and actionable.\n\nContent:\n${textChunks.join("\n\n")}`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "You summarize reference materials for a design planning workspace.",
              },
            ],
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: promptText },
              ...fileInputs,
              ...imageInputs,
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      res.status(500).json({
        error: errorPayload?.error?.message ?? "LLM request failed.",
      });
      return;
    }

    const result = await response.json();
    const curatedText = result.output
      ?.find((item: any) => item.type === "message")
      ?.content?.find((c: any) => c.type === "output_text")
      ?.text?.trim();

    if (!curatedText) {
      res.status(500).json({ error: "No summary returned." });
      return;
    }

    await db.doc("ppssBackgroundKnowledge/current").set(
      {
        curatedText,
        updatedBy: decoded.email ?? decoded.uid,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    res.status(200).json({ ok: true, curatedText });
  } catch (error) {
    console.error("ADMIN BACKGROUND ERROR:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error",
    });
  }
}
