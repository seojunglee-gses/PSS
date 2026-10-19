export const MODELS = {
  fastChat: "gpt-6-luna",
  chat: "gpt-6.1-sol",
  image: "gpt-image-2.5-flare",
} as const;

export function selectOpenAIChatModel(message: string, stepId?: string): string {
  // Analysis, design, evaluation and reporting already have explicit workflow stages.
  if (["data", "alternatives", "evaluation", "report", "summary"].includes(stepId ?? "")) return MODELS.chat;
  const text = message.trim();
  // Be conservative: uncertain or compound tasks stay on the full Chat model.
  if (!text || text.length > 600 || /분석|추론|평가|비교|추천|제안|설계|계획|전략|의사\s*결정|종합|통합|근거|공간|도로\s*폭|면적|가중|대안|우선\s*(?:순위|지역|검토)|보고서|리포트|보고\s*작성|\b(?:analy\w*|reason\w*|evaluat\w*|compar\w*|recommend\w*|design\w*|plan\w*|strateg\w*|decision\w*|synthesi\w*|evidence|criteria|spatial|gis|report\w*|trade.?offs?)\b/i.test(text)) return MODELS.chat;
  const simple = /^(?:안녕(?:하세요)?|고마워요?|감사합니다|hello|hi|thanks|thank you)[.!?\s]*$/i.test(text)
    || /요약(?:해|해주세요|해줘)|간단히\s*정리|문장.{0,20}(?:다듬|고쳐|수정)|맞춤법|다시\s*써|쉽게\s*설명|(?:뜻|의미)(?:이|가|은|는)?\s*(?:뭐|무엇)|\b(?:summari[sz]e|rewrite|rephrase|proofread|fix (?:the )?(?:grammar|spelling)|what (?:is|are)|define|explain (?:briefly|simply))\b/i.test(text);
  return simple ? MODELS.fastChat : MODELS.chat;
}

type OpenAIRequest = {
  model?: string;
  systemText: string;
  userText: string;
};

export const callOpenAI = async ({
  model,
  systemText,
  userText,
}: OpenAIRequest): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || MODELS.chat,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemText,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: userText,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(errorPayload?.error?.message ?? "LLM request failed.");
  }

  const result = await response.json();

  const content = result.output
    ?.find((item: any) => item.type === "message")
    ?.content?.find((c: any) => c.type === "output_text")
    ?.text;

  if (!content) {
    throw new Error("No reply returned.");
  }

  return content;
};
