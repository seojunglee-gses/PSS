import type { NextApiRequest, NextApiResponse } from "next";
import { parseAnalysisRequest, retrieveEvidence } from "../../../lib/research/evidence";

export const config = { api: { bodyParser: { sizeLimit: "128kb" } } };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "Method not allowed" }); return; }
  let request;
  try { request = parseAnalysisRequest(req.body); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request." }); return; }
  res.status(200).json({ evidence: await retrieveEvidence(request) });
}
