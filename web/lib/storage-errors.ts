export function storageFailureDetails(error: unknown, storagePath: string, authenticated: boolean) {
  const value = error as { code?: unknown } | null;
  const code = typeof value?.code === "string" && /^[a-z0-9_/-]{1,80}$/i.test(value.code) ? value.code
    : typeof value?.code === "number" ? String(value.code) : "unknown";
  return { code, storagePath: storagePath.split("?")[0], authenticated };
}
export function logStorageFailure(error: unknown, storagePath: string, authenticated: boolean) {
  console.error("Firebase Storage upload failed", storageFailureDetails(error, storagePath, authenticated));
}
