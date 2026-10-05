import type { NextApiRequest, NextApiResponse } from "next";
import { adminDb, verifyUserRequest } from "../../../lib/firebaseAdmin";
import {
  AccessError,
  listProjects,
  mutateProject,
} from "../../../lib/membership/server";
export const config = { api: { bodyParser: { sizeLimit: "512kb" } } };
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method ?? "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  let user;
  try {
    user = await verifyUserRequest(
      req.headers.authorization?.match(/^Bearer (.+)$/)?.[1],
    );
  } catch (error) {
    const configurationError =
      error instanceof SyntaxError ||
      (error instanceof Error &&
        error.message.includes("FIREBASE_SERVICE_ACCOUNT_KEY")) ||
      (typeof (error as { code?: string })?.code === "string" &&
        (error as { code: string }).code.startsWith("app/"));
    return res
      .status(configurationError ? 503 : 401)
      .json({
        error: configurationError
          ? "참여 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요."
          : "로그인 상태를 확인해주세요.",
      });
  }
  try {
    if (req.method === "GET")
      return res.status(200).json(await listProjects(adminDb(), user));
    if (!req.body || typeof req.body !== "object")
      throw new AccessError(400, "잘못된 요청입니다.");
    await mutateProject(adminDb(), user, req.body);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(error instanceof AccessError ? error.status : 503).json({
      error:
        error instanceof AccessError
          ? error.message
          : "사업 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.",
    });
  }
}
