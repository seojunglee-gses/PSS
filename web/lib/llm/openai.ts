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
      model: model || "gpt-5-mini",
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
