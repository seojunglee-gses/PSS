import { loadProjectContext } from "../../../lib/project-context-server";
import { canManageProject } from "../../../lib/rbac";
import { prepareStorageUpload, readStorageUpload } from "../../../lib/storage-upload-server";
import { AccessError, validProjectId } from "../../../lib/membership/server";
import { MODELS } from "../../../lib/llm/openai";
import type { NextApiRequest, NextApiResponse } from "next";
import { adminDb } from "../../../lib/firebaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

type UploadedFile = { storagePath: string };

async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammothMod: any = await import("mammoth");
  const mammoth = mammothMod.default ?? mammothMod;
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try { return (await parser.getText()).text || ""; }
  finally { await parser.destroy(); }
}

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
  if (req.method === "OPTIONS") {
  res.setHeader("Allow", "POST, OPTIONS");
  return res.status(200).end();
}
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid Authorization header" });
    }

    const context = await loadProjectContext(req, "problem");
    if (!canManageProject(context.user.email, context.project)) throw new AccessError(403, "이 사업의 관리자만 배경 자료를 올릴 수 있습니다.");
    const decoded = context.user;
    if (req.body?.action === "prepare") { res.status(200).json(await prepareStorageUpload(req, decoded.uid, "ppss-background-knowledge/originals")); return; }
    const { files, projectId } = req.body as { files?: UploadedFile[]; projectId?: string };
    const scopedProjectId = validProjectId(projectId);
    if (!Array.isArray(files) || !files.length || files.length > 10) {
      res.status(400).json({ error: "At least one file is required." });
      return;
    }

    const db = adminDb();
    const timestamp = new Date().toISOString();

    const textChunks: string[] = [];
    const imageInputs: { type: "input_image"; image_url: string }[] = [];

  for (const input of files) {
    const { buffer, ...file } = await readStorageUpload(input, scopedProjectId, decoded.uid, "ppss-background-knowledge/originals");
    const { storagePath } = file;
    await db.collection(`ppssBackgroundKnowledgeArchives_${scopedProjectId}`).add({
      fileName: file.name,
      projectId: scopedProjectId,
      storagePath,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      uploadedAt: timestamp,
      uploadedBy: decoded.email ?? decoded.uid,
    });

    // 2. 이미지
    if (isImageType(file.type)) {
      imageInputs.push({
        type: "input_image",
        image_url: `data:${file.type};base64,${buffer.toString("base64")}`,
      });
      continue;
    }

    // 3. TXT
    if (file.type.startsWith("text/")) {
      const extracted = buffer.toString("utf-8");
      if (extracted.trim()) {
        textChunks.push(
          `File: ${file.name}\n${truncate(extracted.trim(), 12000)}`
        );
      }
      continue;
    }

    // 4. DOCX
    if (
      file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const extracted = await extractDocxText(buffer);
      if (extracted.trim()) {
        textChunks.push(
          `File: ${file.name}\n${truncate(extracted.trim(), 12000)}`
        );
      }
      continue;
    }

    // 5. PDF
    if (file.type === "application/pdf") {
      const extracted = await extractPdfText(buffer);
      if (extracted.trim()) {
        textChunks.push(
          `File: ${file.name}\n${truncate(extracted.trim(), 12000)}`
        );
      }
      continue;
    }
  }


      if (!textChunks.length && !imageInputs.length) {
      res.status(400).json({
        error: "Unable to extract any text or images from the uploaded files.",
      });
      return;
    }

    const promptText = `Summarize the uploaded background knowledge for the PPSS workspace.\n\nInstructions:\n- Capture main content so every workspace user can rely on it.\n- Organize with short headings for: Project overview, Physical constrainsts, Social contexts, stakeholderIssues, Common requests, ext.\n- Keep it concise and actionable.\n\nContent:\n${textChunks.join("\n\n")}`;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("파일은 저장했지만 요약을 생성하지 못했습니다. OPENAI_API_KEY 설정을 확인해주세요.");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODELS.chat,
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

    await db.doc(`ppssBackgroundKnowledge_${scopedProjectId}/current`).set(
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
    res.status(error instanceof AccessError ? error.status : 500).json({
      error: error instanceof Error ? error.message : "Unexpected error",
    });
  }
}
