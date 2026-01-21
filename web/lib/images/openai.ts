type OpenAIImageRequest = {
  prompt: string;
  imageBuffer: Buffer;
  mimeType: string;
};

const bufferToBlob = (buffer: Buffer, mimeType: string) =>
  new Blob([new Uint8Array(buffer)], { type: mimeType });

export const generateOpenAIImage = async ({
  prompt,
  imageBuffer,
  mimeType,
}: OpenAIImageRequest): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", prompt);
  form.append("response_format", "b64_json");
  form.append("image", bufferToBlob(imageBuffer, mimeType), "site-image");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(errorPayload?.error?.message ?? "Image request failed.");
  }

  const result = await response.json();
  const base64 = result?.data?.[0]?.b64_json;
  if (!base64) {
    throw new Error("No image returned.");
  }

  return base64;
};
