import type { User } from "firebase/auth";
export class ProjectRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public reason?: string,
  ) {
    super(message);
  }
}
export async function projectRequest(
  user: Pick<User, "getIdToken">,
  path: string,
  body?: unknown,
) {
  let token: string;
  try {
    token = await user.getIdToken();
  } catch {
    throw new ProjectRequestError(401, "로그인 상태를 확인해주세요.");
  }
  let r: Response;
  try {
    r = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ProjectRequestError(
      503,
      "참여 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
    );
  }
  let data;
  try {
    data = await r.json();
  } catch {
    throw new ProjectRequestError(
      r.ok ? 503 : r.status,
      "참여 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
    );
  }
  if (!r.ok)
    throw new ProjectRequestError(
      r.status,
      typeof data?.error === "string"
        ? data.error
        : "참여 여부를 확인하지 못했어요.",
      typeof data?.reason === "string" ? data.reason : undefined,
    );
  return data;
}
