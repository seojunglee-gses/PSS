// File bytes go directly to Storage. Only small descriptors pass through the application API.
export async function uploadProjectFile(endpoint: string, file: File, projectId: string, token: string) {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("파일당 최대 20MB까지 올릴 수 있습니다.");
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "prepare", projectId, name: file.name, type: file.type || "application/octet-stream", size: file.size }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "업로드를 준비하지 못했습니다.");
  const uploaded = await fetch(payload.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  if (!uploaded.ok) throw new Error("파일을 올리지 못했습니다. 네트워크 연결을 확인하고 다시 시도해주세요.");
  return { storagePath: payload.storagePath };
}
