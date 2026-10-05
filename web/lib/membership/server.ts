import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { timingSafeEqual } from "node:crypto";
import { canManageProject, isSystemAdmin } from "../rbac";
import type { ProjectMeta } from "../projects";
export type Identity = { uid: string; email?: string };
export class AccessError extends Error {
  constructor(
    public status: number,
    message: string,
    public reason?: string,
  ) {
    super(message);
  }
}
export function validProjectId(id: unknown): string {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
    throw new AccessError(400, "사업을 다시 선택해주세요.");
  return id;
}
export function memberActive(data: Record<string, unknown> | undefined) {
  return !!data && data.role === "participant" && data.revoked !== true;
}
export const memberPath = (uid: string, projectId: string) =>
  `users/${uid}/projectMemberships/${projectId}`;
export function safeProject(
  project: ProjectMeta,
  user: Identity,
  joined: boolean,
) {
  const manager = canManageProject(user.email, project);
  const { accessCode, workspaceContent, ...metadata } = project;
  return {
    ...metadata,
    ...(manager ? { accessCode } : {}),
    workspaceContent:
      manager || joined
        ? workspaceContent
        : { problem: { imageUrl: workspaceContent?.problem?.imageUrl ?? "" } },
  };
}
export async function listProjects(db: Firestore, user: Identity) {
  const [projects, memberships, profile] = await Promise.all([
    db.collection("ppssProjects").get(),
    db.collection(`users/${user.uid}/projectMemberships`).get(),
    db.doc(`users/${user.uid}`).get(),
  ]);
  const projectDocs = [...projects.docs].sort(
    (a, b) =>
      new Date(b.data().lastModifiedAt ?? 0).getTime() -
      new Date(a.data().lastModifiedAt ?? 0).getTime(),
  );
  const memberIds = new Set(
    memberships.docs.filter((d) => memberActive(d.data())).map((d) => d.id),
  );
  const joinedIds = projectDocs
    .filter(
      (d) =>
        memberIds.has(d.id) ||
        canManageProject(user.email, d.data() as ProjectMeta),
    )
    .map((d) => d.id);
  const lastProjectId = profile.data()?.lastProjectId;
  return {
    projects: projectDocs.map((d) =>
      safeProject(
        { ...d.data(), projectId: d.id } as ProjectMeta,
        user,
        memberIds.has(d.id),
      ),
    ),
    joinedIds,
    lastProjectId: joinedIds.includes(lastProjectId) ? lastProjectId : null,
  };
}
export async function enterProject(
  db: Firestore,
  user: Identity,
  projectId: string,
  code?: unknown,
) {
  validProjectId(projectId);
  return db
    .runTransaction(async (tx) => {
      const projectRef = db.doc(`ppssProjects/${projectId}`),
        memberRef = db.doc(memberPath(user.uid, projectId)),
        profileRef = db.doc(`users/${user.uid}`);
      const [projectSnap, memberSnap, profileSnap] = await Promise.all([
        tx.get(projectRef),
        tx.get(memberRef),
        tx.get(profileRef),
      ]);
      if (!projectSnap.exists)
        throw new AccessError(
          404,
          "이 사업을 찾을 수 없습니다. 사업을 다시 선택해주세요.",
        );
      const project = { ...projectSnap.data(), projectId } as ProjectMeta;
      const manager = canManageProject(user.email, project);
      let joined = memberActive(memberSnap.data());
      let createdMembership = false;
      if (!manager && !joined) {
        // A revoked record remains blocked even if the invitation code is known.
        if (memberSnap.data()?.revoked === true)
          throw new AccessError(403, "이 프로젝트에 참여할 권한이 없습니다.");
        if (code === undefined)
          throw new AccessError(
            403,
            "참여 코드 입력이 필요합니다.",
            "code_required",
          );
        const previousAttempt = profileSnap.data()?.joinAttempt;
        if (
          previousAttempt &&
          Date.now() - (previousAttempt.startedAt ?? 0) < 15 * 60 * 1000 &&
          previousAttempt.count >= 10
        )
          throw new AccessError(429, "잠시 후 다시 시도해주세요.");
        if (
          typeof code !== "string" ||
          !/^\d{4}$/.test(code) ||
          typeof project.accessCode !== "string" ||
          !/^\d{4}$/.test(project.accessCode) ||
          !timingSafeEqual(Buffer.from(code), Buffer.from(project.accessCode))
        ) {
          const attempt = profileSnap.data()?.joinAttempt;
          const recent =
            attempt && Date.now() - (attempt?.startedAt ?? 0) < 15 * 60 * 1000;
          const count = recent ? Number(attempt.count ?? 0) + 1 : 1;
          tx.set(
            profileRef,
            {
              joinAttempt: {
                projectId,
                startedAt: recent ? attempt.startedAt : Date.now(),
                count,
              },
            },
            { merge: true },
          );
          // Return errors so the failed-attempt transaction commits without creating membership.
          return {
            error: new AccessError(400, "참여 코드를 다시 확인해주세요."),
          };
        }
        const attempt = profileSnap.data()?.joinAttempt;
        if (
          attempt?.projectId === projectId &&
          Date.now() - (attempt.startedAt ?? 0) < 15 * 60 * 1000 &&
          attempt.count >= 10
        )
          throw new AccessError(429, "잠시 후 다시 시도해주세요.");
        tx.set(memberRef, {
          projectId,
          role: "participant",
          joinedAt: FieldValue.serverTimestamp(),
        });
        joined = true;
        createdMembership = true;
      }
      tx.set(
        profileRef,
        {
          lastProjectId: projectId,
          lastOpenedAt: FieldValue.serverTimestamp(),
          ...(createdMembership ? { joinAttempt: FieldValue.delete() } : {}),
        },
        { merge: true },
      );
      return { project: safeProject(project, user, joined) };
    })
    .then((result) => {
      if ("error" in result) throw result.error;
      return result;
    });
}
export async function mutateProject(
  db: Firestore,
  user: Identity,
  body: Record<string, unknown>,
) {
  const id = validProjectId(body.projectId);
  const ref = db.doc(`ppssProjects/${id}`);
  return db.runTransaction(async (tx) => {
    const [snap, member] = await Promise.all([
      tx.get(ref),
      tx.get(db.doc(memberPath(user.uid, id))),
    ]);
    const current = snap.data() as ProjectMeta | undefined;
    if (body.action === "create") {
      if (!isSystemAdmin(user.email))
        throw new AccessError(403, "사업을 만들 권한이 없습니다.");
      if (snap.exists) throw new AccessError(409, "이미 등록된 사업입니다.");
    } else if (!snap.exists)
      throw new AccessError(404, "사업을 찾을 수 없습니다.");
    if (body.action === "touch") {
      if (
        !canManageProject(user.email, current) &&
        !memberActive(member.data())
      )
        throw new AccessError(403, "이 프로젝트에 참여할 권한이 없습니다.");
      tx.update(ref, { lastModifiedAt: new Date().toISOString() });
      return;
    }
    if (body.action === "delete") {
      if (!isSystemAdmin(user.email) || id === "project-1")
        throw new AccessError(403, "사업을 삭제할 권한이 없습니다.");
      tx.delete(ref);
      return;
    }
    if (body.action !== "create" && body.action !== "update")
      throw new AccessError(400, "잘못된 요청입니다.");
    if (body.action === "update" && !canManageProject(user.email, current))
      throw new AccessError(403, "사업을 수정할 권한이 없습니다.");
    const patch = body.project as Partial<ProjectMeta>;
    if (!patch || typeof patch !== "object")
      throw new AccessError(400, "사업 정보를 확인해주세요.");
    const clean: Record<string, unknown> = {};
    for (const key of [
      "projectName",
      "projectAdmin",
      "accessCode",
      "workspaceContent",
    ] as const)
      if (patch[key] !== undefined) clean[key] = patch[key];
    if (
      clean.accessCode !== undefined &&
      (typeof clean.accessCode !== "string" ||
        !/^\d{4}$/.test(clean.accessCode))
    )
      throw new AccessError(400, "참여 코드는 숫자 4자리로 입력해주세요.");
    for (const key of ["projectName", "projectAdmin"])
      if (
        clean[key] !== undefined &&
        (typeof clean[key] !== "string" || !(clean[key] as string).trim())
      )
        throw new AccessError(400, "사업 이름과 담당자를 확인해주세요.");
    if (
      clean.workspaceContent !== undefined &&
      (!clean.workspaceContent ||
        typeof clean.workspaceContent !== "object" ||
        Array.isArray(clean.workspaceContent))
    )
      throw new AccessError(400, "작업 공간 자료를 확인해주세요.");
    if (
      body.action === "create" &&
      (!clean.projectName ||
        !clean.projectAdmin ||
        !clean.accessCode ||
        !clean.workspaceContent)
    )
      throw new AccessError(400, "사업 정보를 모두 입력해주세요.");
    if (clean.workspaceContent && current)
      clean.workspaceContent = {
        ...current.workspaceContent,
        ...(clean.workspaceContent as object),
      };
    tx.set(
      ref,
      {
        ...clean,
        projectId: id,
        ...(body.action === "create"
          ? { createdAt: new Date().toISOString() }
          : {}),
        lastModifiedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  });
}
