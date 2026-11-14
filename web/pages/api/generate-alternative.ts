import type { NextApiRequest, NextApiResponse } from "next";
import { createHash } from "node:crypto";
import { adminDb } from "../../lib/firebaseAdmin";
import { loadProjectContext } from "../../lib/project-context-server";
import { AccessError } from "../../lib/membership/server";
import { callLLM } from "../../lib/llm";
import { conversationHistory } from "../../lib/chat-history";
import { storeGeneratedImage } from "../../lib/generated-image-server";
import { DESIGN_TRANSLATION } from "../../lib/design-alternatives";
import { confirmDesignDirection, prepareDesignDirection, readDesignDirection, withDesignOperation } from "../../lib/design-alternatives-server";
import { editDesignImage, readDesignImage, validateDesignMask } from "../../lib/design-image-server";
export const config = { maxDuration: 300, api: { bodyParser: { sizeLimit: "8mb" } } };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  try {
    const context = await loadProjectContext(req, "alternatives", true, true);
    const { action, feedback, revision, requestId, parentImageId, mask } = req.body;
    if (action && !["get-proposal", "prepare-proposal", "revise-proposal", "confirm-proposal"].includes(action)) throw new AccessError(400, "요청 종류를 확인해주세요.");
    if (feedback !== undefined && (typeof feedback !== "string" || feedback.length > 4000)) throw new AccessError(400, "수정 의견은 4,000자 안으로 말씀해주세요.");
    if (action === "get-proposal") {
      const submissions = await adminDb().collection(`ppssUserDesignSubmissions_${context.projectId}`).where("userId", "==", context.user.uid).get();
      const latest = submissions.docs.map(doc => doc.data()).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      res.status(200).json({ direction: await readDesignDirection(context), submittedImageId: latest?.imageId ?? null }); return;
    }
    const workspaceState = (await adminDb().doc(`ppssWorkspaceSummaries_${context.projectId}/${context.user.uid}`).get()).data();
    if (workspaceState?.completedStages?.includes("alternatives")) throw new AccessError(409, "이미 완료한 단계예요. 기존 계획안은 그대로 보관됩니다.");
    if (action === "revise-proposal" && !feedback?.trim()) throw new AccessError(400, "바꾸고 싶은 내용을 말씀해주세요.");
    if (action === "prepare-proposal" || action === "revise-proposal") {
      const direction = await withDesignOperation(context, "proposal", requestId, { action, feedback: feedback ?? null, revision: revision ?? null }, () => prepareDesignDirection(context, action === "revise-proposal" ? feedback : undefined, revision));
      res.status(200).json({ direction }); return;
    }
    if (action === "confirm-proposal") { res.status(200).json({ direction: await confirmDesignDirection(context, revision) }); return; }
    if (!process.env.OPENAI_API_KEY) throw new AccessError(503, "이미지 생성 설정을 확인해야 해요. 관리자에게 알려주세요.");
    if (parentImageId && (typeof parentImageId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(parentImageId))) throw new AccessError(400, "수정할 이미지를 확인해주세요.");
    const direction = await readDesignDirection(context);
    if (direction && (!direction.confirmedAt || revision !== direction.revision)) throw new AccessError(409, "이미지를 만들기 전에 현재 설계 방향을 확인해주세요.");
    const result = await withDesignOperation(context, "image", requestId, { feedback: feedback ?? null, revision: revision ?? null, parentImageId: parentImageId ?? null, mask: mask ? createHash("sha256").update(String(mask)).digest("hex") : null, provider: req.body.provider ?? "openai" }, async () => {
      const imageId = createHash("sha256").update(JSON.stringify([context.projectId, context.user.uid, requestId])).digest("hex");
      const existing = (await adminDb().doc(`ppssGeneratedImages_${context.projectId}/${imageId}`).get()).data();
      if (existing?.userId === context.user.uid && existing.downloadUrl) return existing;
      // Under the existing per-user lease: a second initial request reuses the saved image.
      // A chat edit without an explicit parent still edits the latest owned version.
      const savedImages = (await adminDb().collection(`ppssGeneratedImages_${context.projectId}`).where("userId", "==", context.user.uid).get()).docs.map(doc => doc.data()).sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const latest = savedImages.at(-1);
      if (!parentImageId && latest && !feedback?.trim()) return latest;
      const editParentId = parentImageId ?? latest?.imageId;
      const currentSiteImage = (await adminDb().doc(`ppssSiteImages_${context.projectId}/current`).get()).data();
      if (!editParentId && !currentSiteImage?.imageId) throw new AccessError(400, "대상지 이미지가 없습니다. 설정에서 현재 사업의 대상지 이미지를 등록해주세요.");
      let baseRecord = currentSiteImage;
      if (editParentId) {
        const parent = (await adminDb().doc(`ppssGeneratedImages_${context.projectId}/${editParentId}`).get()).data();
        if (!parent || parent.userId !== context.user.uid) throw new AccessError(403, "내가 생성한 이미지만 수정할 수 있어요.");
        if (!feedback?.trim()) throw new AccessError(400, "어떻게 바꿀지 말씀해주세요.");
        baseRecord = parent;
      } else if (mask) throw new AccessError(400, "수정할 이미지를 먼저 선택해주세요.");
      const rootImageId = editParentId ? baseRecord?.designMetadata?.rootImageId ?? editParentId : imageId;
      const versionNumber = editParentId ? Math.max(0, ...savedImages.filter(item => item.imageId === rootImageId || item.designMetadata?.rootImageId === rootImageId).map(item => Number(item.designMetadata?.versionNumber) || 0)) + 1 : 0;
      const label = editParentId ? `${versionNumber}차 수정 이미지` : "초기 이미지";
      const base = await readDesignImage(context.projectId, baseRecord!, Boolean(editParentId));
      const maskBuffer = mask ? await validateDesignMask(mask, base.width, base.height) : undefined;
      const history = conversationHistory(context.stageHistory.length ? context.stageHistory : req.body.history, "alternatives");
      // A confirmed direction is translated directly. No second LLM can silently change it.
      const prompt = editParentId ? `Edit the supplied selected generated image. Preserve its camera position, perspective, road alignment, buildings, storefronts and entrances. Existing design context (context only, not a request to redraw it): ${JSON.stringify(direction?.interventions ?? (typeof baseRecord?.note === "string" ? baseRecord.note.slice(0, 6000) : ""))}\nLatest resident edit request: ${feedback}` : direction ? `${DESIGN_TRANSLATION}\nConfirmed resident-reviewed direction: ${JSON.stringify(direction.interventions)}\nLatest request: ${feedback ?? "Visualize exactly this confirmed direction."}` : await callLLM({ provider: req.body.provider === "gemini" ? "gemini" : "openai", systemText: `Generate a SINGLE image-generation prompt based on this project's dialogue and workspace summaries. Never assume a particular site or scope. Preserve participant-stated preferences; AI options are not participant decisions. ${DESIGN_TRANSLATION}`, userText: JSON.stringify({ material: context.currentMaterial, summaries: context.previousSummaries, history, feedback: feedback ?? null }) });
      const editPrompt = editParentId ? `${prompt}\nEDIT THE SUPPLIED SELECTED GENERATED IMAGE, not the initial site photo. ${maskBuffer ? "Change only the transparent mask area. Preserve all opaque/unselected areas, composition and prior design elements as closely as possible." : "Apply the latest whole-image feedback while preserving unrelated elements."} User's edit request: ${feedback}` : prompt;
      let generated;
      if (req.body.provider === "gemini" && !editParentId && !direction) {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        if (!process.env.GEMINI_API_KEY) throw new AccessError(503, "이미지 생성 설정을 확인해주세요.");
        const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: "gemini-2.5-flash-image" });
        const response = await model.generateContent([{ text: editPrompt }, { inlineData: { mimeType: "image/png", data: base.buffer.toString("base64") } }]);
        const base64 = response.response.candidates?.[0]?.content?.parts.find(part => part.inlineData?.data)?.inlineData?.data;
        if (!base64) throw new AccessError(502, "이미지를 만들지 못했어요. 다시 시도해주세요.");
        generated = { base64, settings: { model: "gemini-2.5-flash-image" } };
      } else generated = await editDesignImage(base, editPrompt, maskBuffer);
      return storeGeneratedImage({ projectId: context.projectId, imageId, base64: generated.base64, label, note: editPrompt, userId: context.user.uid, metadata: { rootImageId, versionNumber, modelSettings: generated.settings, directionRevision: direction?.revision ?? null, parentImageId: editParentId ?? null, editRequest: feedback ?? null, maskedEdit: Boolean(maskBuffer), siteImageId: editParentId ? baseRecord?.designMetadata?.siteImageId ?? null : currentSiteImage!.imageId, requestId } });
    });
    res.status(200).json({ ...result, prompt: result.note });
  } catch (error) {
    const status = error instanceof AccessError ? error.status : 503;
    console.error("[design-alternative]", { status, failureType: error instanceof AccessError ? "request" : error instanceof Error && error.name === "TimeoutError" ? "timeout" : "generation-or-storage" });
    res.status(status).json({ error: error instanceof AccessError ? error.message : "설계 제안 또는 이미지를 처리하지 못했어요. 기존 자료는 그대로 있어요. 잠시 후 다시 시도해주세요." });
  }
}
