import type { NextApiRequest, NextApiResponse } from "next";
import { adminDb, verifyAdminRequest } from "../../../lib/firebaseAdmin";
import { loadBackgroundKnowledge } from "../../../lib/firebase";

function extractOutputText(result: any): string | null {
  if (!result?.output || !Array.isArray(result.output)) {
    return null;
  }

  for (const item of result.output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (content.type === "output_text" && typeof content.text === "string") {
          return content.text;
        }
      }
    }
  }

  return null;
}


type WorkspaceSummary = {
  stageSummaries: Record<string, string>;
  overallSummary: string;
};

const scopedCollection = (base: string, projectId?: string) => `${base}_${projectId || "project-1"}`;

const stageOrder = [
  { id: "problem", label: "Problem Definition" },
  { id: "data", label: "Data Analysis" },
  { id: "alternatives", label: "Design/Plan Alternatives" },
  { id: "evaluation", label: "Design/Plan Evaluation" },
  { id: "report", label: "Design/Plan Decision" },
];

const systemPromptBase =
  "You are an analyst generating an executive summary for a PPSS workflow report. Return ONLY valid JSON that matches the schema. No extra keys.";

const buildSystemPrompt = (backgroundKnowledge?: string) =>
  backgroundKnowledge
    ? `${systemPromptBase}\n\nBackground knowledge (stable system context for all planning stages):\n${backgroundKnowledge}`
    : systemPromptBase;

const buildPrompt = (payload: {
  stageId: string;
  stageLabel: string;
  participants: number;
  stageCounts: Record<string, number>;
  stageSummary: string[];
}) => {
  const isDecisionStage = payload.stageId === "report";
  return `Input JSON: ${JSON.stringify(payload)}\n\nReturn JSON with this schema:\n{\n  \"keywords\": [\"...\"],\n  \"conclusion\": \"...\"\n}\n\nRules:\n- Conclusion reflects all participants' workspace dialogue summaries for the requested stage.\n- Keywords should capture the top 5 themes people care about most. Return exactly 5 keywords.\n- Keep output concise and structured.\n${
    isDecisionStage
      ? "- For the decision stage, synthesize the full set of stage summaries into a final executive summary."
      : ""
  }`;
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

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }
    const token = authHeader.replace("Bearer ", "");

    await verifyAdminRequest(token);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
      return;
    }

    const { stageId, projectId } = req.body as { stageId?: string; projectId?: string };
    const stage = stageOrder.find((entry) => entry.id === stageId);
    if (!stage) {
      res.status(400).json({ error: "Invalid stage selection." });
      return;
    }

    const db = adminDb();
    const snapshot = await db.collection(scopedCollection("ppssWorkspaceSummaries", projectId)).get();
    const summaries = snapshot.docs.map((docSnap) => ({
      userId: docSnap.id,
      summary: docSnap.data() as WorkspaceSummary,
    }));

    const stageCounts = stageOrder.reduce<Record<string, number>>(
      (acc, stage) => {
        acc[stage.id] = summaries.filter((entry) =>
          entry.summary.stageSummaries?.[stage.id]?.trim()
        ).length;
        return acc;
      },
      {}
    );

    const aggregated = stageOrder.reduce<Record<string, string[]>>(
      (acc, stage) => {
        acc[stage.id] = summaries
          .map((entry) => entry.summary.stageSummaries?.[stage.id])
          .filter((text): text is string => Boolean(text && text.trim()));
        return acc;
      },
      {}
    );

    const combinedDecisionSummaries = summaries
      .map((entry) => {
        const lines = stageOrder
          .map(({ id, label }) => {
            const text = entry.summary.stageSummaries?.[id];
            if (!text || !text.trim()) {
              return null;
            }
            return `${label}:\n${text}`;
          })
          .filter((line): line is string => Boolean(line));
        if (!lines.length) {
          return null;
        }
        return lines.join("\n\n");
      })
      .filter((text): text is string => Boolean(text));

    const backgroundKnowledge = await loadBackgroundKnowledge(projectId);
    const curatedBackground = backgroundKnowledge?.curatedText?.trim();

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: [
          { role: "system", content: buildSystemPrompt(curatedBackground) },
          {
            role: "user",
            content: buildPrompt({
              stageId: stage.id,
              stageLabel: stage.label,
              participants: summaries.length,
              stageCounts,
              stageSummary:
                stage.id === "report"
                  ? combinedDecisionSummaries
                  : aggregated[stage.id] ?? [],
            }),
          },
        ],
        text: {
          format: { type: "json_object" },
        }
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
    console.log(
      "EXEC SUMMARY RAW RESULT:",
      JSON.stringify(result, null, 2)
    );
    
    const content = extractOutputText(result);
    
    if (!content) {
      throw new Error("No summary content returned.");
    }

    const parsed = JSON.parse(content) as {
      keywords: string[];
      conclusion: string;
    };
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.slice(0, 5)
      : [];

    const payload = {
      keywords,
      currentStage: stage.label,
      stageId: stage.id,
      stageSummaries: {
        problemDefinition: "",
        dataAnalysis: "",
        designAlternatives: "",
        designEvaluation: "",
        decision: "",
        ...(stage.id === "problem"
          ? { problemDefinition: parsed.conclusion ?? "" }
          : {}),
        ...(stage.id === "data"
          ? { dataAnalysis: parsed.conclusion ?? "" }
          : {}),
        ...(stage.id === "alternatives"
          ? { designAlternatives: parsed.conclusion ?? "" }
          : {}),
        ...(stage.id === "evaluation"
          ? { designEvaluation: parsed.conclusion ?? "" }
          : {}),
        ...(stage.id === "report"
          ? { decision: parsed.conclusion ?? "" }
          : {}),
      },
      createdAt: new Date().toISOString(),
    };

    await db.collection(scopedCollection("ppssExecutiveSummaries", projectId)).add(payload);

    if (stage.id === "alternatives") {
      const submissionsSnap = await db
        .collection(scopedCollection("ppssUserDesignSubmissions", projectId))
        .get();
      const latestByUser = submissionsSnap.docs.reduce<
        Record<string, { imageId: string; createdAt: string }>
      >((acc, docSnap) => {
        const data = docSnap.data() as {
          userId?: string;
          imageId?: string;
          createdAt?: string;
        };
        if (!data.userId || !data.imageId || !data.createdAt) {
          return acc;
        }
        const existing = acc[data.userId];
        if (!existing || data.createdAt > existing.createdAt) {
          acc[data.userId] = {
            imageId: data.imageId,
            createdAt: data.createdAt,
          };
        }
        return acc;
      }, {});

      const evaluationImages = await Promise.all(
        Object.entries(latestByUser).map(async ([userId, submission]) => {
          const imageSnap = await db
            .collection(scopedCollection("ppssGeneratedImages", projectId))
            .doc(submission.imageId)
            .get();
          if (!imageSnap.exists) {
            return null;
          }
          const image = imageSnap.data() as {
            label?: string;
            note?: string;
            downloadUrl?: string;
          };
          if (!image?.downloadUrl) {
            return null;
          }
          return {
            userId,
            imageId: submission.imageId,
            createdAt: submission.createdAt,
            label: image.label ?? "Submitted design",
            note: image.note ?? "",
            downloadUrl: image.downloadUrl,
          };
        })
      );

      const evaluationCollection = db.collection(scopedCollection("ppssEvaluationImages", projectId));
      const existing = await evaluationCollection.get();
      const batch = db.batch();
      existing.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      evaluationImages
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .forEach((entry) => {
          const docRef = evaluationCollection.doc(entry.userId);
          batch.set(docRef, entry);
        });
      await batch.commit();
    }

    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
}
