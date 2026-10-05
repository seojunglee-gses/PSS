import type { NextApiRequest, NextApiResponse } from "next";
import { adminDb, verifyUserRequest } from "../../../lib/firebaseAdmin";
import {
  AccessError,
  enterProject,
  validProjectId,
} from "../../../lib/membership/server";
export const config = { api: { bodyParser: { sizeLimit: "2kb" } } };
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
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
    return res.status(configurationError ? 503 : 401).json({
      error: configurationError
        ? "참여 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요."
        : "로그인 상태를 확인해주세요.",
    });
  }
  try {
    return res
      .status(200)
      .json(
        await enterProject(
          adminDb(),
          user,
          validProjectId(req.body?.projectId),
          req.body?.code,
        ),
      );
  } catch (error) {
    return res.status(error instanceof AccessError ? error.status : 503).json({
      ...(error instanceof AccessError && error.reason
        ? { reason: error.reason }
        : {}),
      error:
        error instanceof AccessError
          ? error.message
          : "참여 여부를 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
    });
  }
}
