type DeepSeekRequest = {
  model?: string;
  systemText: string;
  userText: string;
};

export const callDeepSeek = async ({
  model,
  systemText,
  userText,
}: DeepSeekRequest): Promise<string> => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured.");
  }

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "deepseek-chat",
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: userText },
      ],
    }),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(errorPayload?.error?.message ?? "LLM request failed.");
  }

  const result = await response.json();
  const content = result?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No reply returned.");
  }
  return content;
};
