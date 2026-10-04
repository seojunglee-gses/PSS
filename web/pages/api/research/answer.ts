import type { NextApiRequest, NextApiResponse } from "next";
import { parseAnalysisRequest, retrieveEvidence } from "../../../lib/research/evidence";
import { answerFromEvidence, answerText } from "../../../lib/research/answer";
import { compactEvidence } from "../../../lib/research/types";

export const config = { api: { bodyParser: { sizeLimit: "128kb" } } };
export const maxDuration = 60;
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "Method not allowed" }); return; }
  let request;
  try { request = parseAnalysisRequest(req.body); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request." }); return; }
  // Retrieve on the server, not from client-provided paper claims or URLs.
  const evidence = await retrieveEvidence(request);
  try {
    const answer = await answerFromEvidence(request, evidence);
    res.status(200).json({ reply: answerText(answer), analysis: { selectedSources: request.selectedSources, answer, evidence: compactEvidence(evidence) } });
  } catch {
    res.status(502).json({ error: "Unable to synthesize the retrieved evidence. Check the selected AI provider configuration or try again.", evidence: compactEvidence(evidence) });
  }
}
