import type { NextApiRequest, NextApiResponse } from "next";
import { lookupBuildingUse } from "../../../lib/spatial/building-use-server";

export const config = { api: { bodyParser: { sizeLimit: "500kb" } } };
// Public reference labels only; accepts codes, never project geometry or a code-table upload.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "지원하지 않는 요청입니다." }); return; }
  const codes = req.body?.codes;
  if (!Array.isArray(codes) || codes.length > 20000 || codes.some((code) => typeof code !== "string" || !/^[0-9]{5}$/.test(code))) {
    res.status(400).json({ error: "5자리 건물 용도 코드를 확인해주세요." }); return;
  }
  res.status(200).json({ uses: Object.fromEntries([...new Set<string>(codes)].flatMap((code) => {
    const use = lookupBuildingUse(code);
    return use ? [[code, use]] : [];
  })) });
}
