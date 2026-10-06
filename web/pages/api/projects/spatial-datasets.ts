import type { NextApiRequest, NextApiResponse } from "next";
import { adminBucket, adminDb, verifyUserRequest } from "../../../lib/firebaseAdmin";
import { AccessError } from "../../../lib/membership/server";
import { listDatasets, mutateDataset, readDataset } from "../../../lib/spatial/dataset-server";

export const config = { api: { bodyParser: { sizeLimit: "4500kb" } } };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!["GET", "POST"].includes(req.method ?? "")) { res.setHeader("Allow", "GET, POST"); res.status(405).json({ error: "지원하지 않는 요청입니다." }); return; }
  let user;
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) { res.status(401).json({ error: "로그인이 필요합니다." }); return; }
    user = await verifyUserRequest(header.slice(7));
  } catch (error) {
    const misconfigured = error instanceof SyntaxError || (error instanceof Error && /FIREBASE_SERVICE_ACCOUNT_KEY|invalid-credential/.test(error.message));
    res.status(misconfigured ? 503 : 401).json({ error: misconfigured ? "공간정보 서버 설정을 확인해주세요." : "로그인 상태를 확인해주세요." }); return;
  }
  try {
    const db = adminDb();
    if (req.method === "POST") {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw new AccessError(400, "요청을 확인해주세요.");
      res.status(200).json(await mutateDataset(db, adminBucket(), user, req.body));
    } else {
      const projectId = req.query.projectId;
      if (typeof projectId !== "string") throw new AccessError(400, "사업을 다시 선택해주세요.");
      if (req.query.datasetId !== undefined) {
        if (typeof req.query.datasetId !== "string" || typeof req.query.revisionId !== "string") throw new AccessError(400, "공간정보를 다시 선택해주세요.");
        res.status(200).json(await readDataset(db, adminBucket(), user, projectId, req.query.datasetId, req.query.revisionId));
      } else res.status(200).json(await listDatasets(db, user, projectId));
    }
  } catch (error) { res.status(error instanceof AccessError ? error.status : 503).json({ error: error instanceof AccessError ? error.message : "공간정보를 처리하지 못했어요. 잠시 후 다시 시도해주세요." }); }
}
