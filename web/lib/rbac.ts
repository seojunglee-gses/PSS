import type { ProjectMeta } from "./projects";

export type UserRole = "system_admin" | "project_admin" | "participant";

const SYSTEM_ADMIN_EMAILS = new Set(["adm@snu.ac.kr", "test@snu.ac.kr"]);

export const getRoleForProject = (
  email?: string | null,
  project?: ProjectMeta | null
): UserRole => {
  if (!email) return "participant";
  const normalizedEmail = email.trim().toLowerCase();
  if (SYSTEM_ADMIN_EMAILS.has(normalizedEmail)) return "system_admin";
  if (project && (project.projectAdmin ?? "").trim().toLowerCase() === normalizedEmail) return "project_admin";
  return "participant";
};

export const isSystemAdmin = (email?: string | null) =>
  Boolean(email && SYSTEM_ADMIN_EMAILS.has(email.trim().toLowerCase()));

export const canManageProject = (email?: string | null, project?: ProjectMeta | null) => {
  const role = getRoleForProject(email, project);
  return role === "system_admin" || role === "project_admin";
};
