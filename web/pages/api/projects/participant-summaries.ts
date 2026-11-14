import type { NextApiRequest, NextApiResponse } from "next";
import { adminDb, verifyUserRequest } from "../../../lib/firebaseAdmin";
import { AccessError, validProjectId } from "../../../lib/membership/server";
import { participantAccess, participantRecords, participantSummaries, softResetParticipantChat, softResetTestAdminChat } from "../../../lib/participants-server";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!["GET", "POST"].includes(req.method ?? "")) { res.setHeader("Allow", "GET, POST"); res.status(405).json({ error: "지원하지 않는 요청입니다." }); return; }
  let user;
  try { user = await verifyUserRequest(req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]); }
  catch { res.status(401).json({ error: "로그인 상태를 확인해주세요." }); return; }
  try {
    const db = adminDb(), projectId = validProjectId(req.method === "POST" ? req.body?.projectId : req.query.projectId);
    const { manager } = await participantAccess(db, user, projectId, req.method === "POST");
    if (req.method === "POST") {
      if (req.body?.action === "softResetTestAdminChat") await softResetTestAdminChat(db, user, projectId, req.body.stageId);
      else if (req.body?.action === "softResetChat") await softResetParticipantChat(db, user, projectId, req.body.userId, req.body.stageId);
      else throw new AccessError(400, "요청을 확인해주세요.");
      res.status(200).json({ ok: true });
    } else if (["evaluations", "submissions", "images"].includes(String(req.query.kind))) {
      const kind = req.query.kind as "evaluations" | "submissions" | "images";
      res.status(200).json({ [kind]: (await participantRecords(db, projectId, kind)).map(record => record.data) });
    }
    else {
      const summaries = await participantSummaries(db, projectId);
      res.status(200).json({ summaries: summaries.map(({ participantId, ...entry }) => ({ ...entry, ...(manager ? { participantId } : {}) })) });
    }
  } catch (error) { res.status(error instanceof AccessError ? error.status : 503).json({ error: error instanceof AccessError ? error.message : "참여자 자료를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." }); }
}
