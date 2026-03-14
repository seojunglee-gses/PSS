import { useRouter } from "next/router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import AppShell from "../components/AppShell";
import { useAuth } from "../lib/auth";
import { normalizeRoleId, roleLabelKeys, useI18n, type RoleId } from "../lib/i18n";
import { useProject } from "../lib/projects";
import { getRoleForProject, isSystemAdmin } from "../lib/rbac";

type RoleItem = {
  id: RoleId;
  titleKey: string;
  descriptionKey: string;
  icon: ReactNode;
};

const roles: RoleItem[] = [
  {
    id: "public",
    titleKey: "role.public",
    descriptionKey: "roledesc.public",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <circle
          cx="12"
          cy="8"
          r="3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M5 19c1.6-3 4.2-4.5 7-4.5s5.4 1.5 7 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "business",
    titleKey: "role.business",
    descriptionKey: "roledesc.business",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <rect
          x="5"
          y="4"
          width="14"
          height="16"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M9 9h6M9 13h6M9 17h4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "planners",
    titleKey: "role.planners",
    descriptionKey: "roledesc.planners",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <path
          d="M5 5h10l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M15 5v4h4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    ),
  },
  {
    id: "government",
    titleKey: "role.government",
    descriptionKey: "roledesc.government",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <path
          d="M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M12 4l7 4H5l7-4z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

export default function Home() {
  const router = useRouter();
  const { signIn, signInWithGoogle, isConfigured, user } = useAuth();
  const { t } = useI18n();
  const { projects, createProject, setActiveProjectId, updateProject, deleteProject } = useProject();
  const [projectName, setProjectName] = useState("");
  const [projectAdminInput, setProjectAdminInput] = useState("test@snu.ac.kr");
  const [projectAccessCodeInput, setProjectAccessCodeInput] = useState("1234");
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectThumbnails, setProjectThumbnails] = useState<Record<string, string>>({});
  const userEmail = user?.email ?? null;
  const userIsSystemAdmin = isSystemAdmin(userEmail);
  const visibleProjects = projects.filter((project) => {
    const role = getRoleForProject(userEmail, project);
    return role === "system_admin" || role === "project_admin" || role === "participant";
  });
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState<RoleId | "">("");
  const [errorMessage, setErrorMessage] = useState("");


  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem("ppss-role");
    const normalized = normalizeRoleId(stored);
    if (stored && normalized && stored !== normalized) {
      window.localStorage.setItem("ppss-role", normalized);
    }
  }, []);

  useEffect(() => {
    if (!user || projects.length === 0) return;
    const entries = projects.map((project) => {
      const preview = project.workspaceContent?.problem?.imageUrl ?? "";
      return [project.projectId, preview] as const;
    });
    setProjectThumbnails(Object.fromEntries(entries));
  }, [user, projects]);

  const handleManageProject = (projectId: string) => {
    if (!userIsSystemAdmin) return;
    const target = projects.find((project) => project.projectId === projectId);
    if (!target) return;
    setEditingProjectId(projectId);
    setProjectName(target.projectName);
    setProjectAdminInput(target.projectAdmin);
    setProjectAccessCodeInput(target.accessCode);
    setShowProjectModal(true);
  };

  const handleDeleteProject = (projectId: string) => {
    if (!userIsSystemAdmin) return;
    const ok = window.confirm("Delete this project?");
    if (!ok) return;
    deleteProject(projectId);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    if (!selectedRole) {
      setErrorMessage(t("home.error.roleSignIn"));
      return;
    }
    try {
      await signIn(email, password);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("ppss-role", selectedRole);
      }
      setShowLogin(false);
      router.push("/");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("home.error.signIn")
      );
    }
  };

  const handleGoogleSignUp = async () => {
    setErrorMessage("");
    if (!selectedRole) {
      setErrorMessage(t("home.error.roleSignUp"));
      return;
    }
    try {
      await signInWithGoogle();
      if (typeof window !== "undefined") {
        window.localStorage.setItem("ppss-role", selectedRole);
      }
      setShowLogin(false);
      router.push("/");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("home.error.google")
      );
    }
  };



  const handleCreateProject = () => {
    const trimmed = projectName.trim();
    if (!trimmed) return;
    if (!/^\d{4}$/.test(projectAccessCodeInput)) return;
    const next = createProject(trimmed, {
      projectAdmin: projectAdminInput || userEmail || "test@snu.ac.kr",
      accessCode: projectAccessCodeInput,
      createdByEmail: userEmail || undefined,
    });
    setProjectName("");
    setActiveProjectId(next.projectId);
    setShowProjectModal(false);
    router.push({ pathname: "/workspace", query: { projectId: next.projectId } });
  };

  const handleSaveProject = () => {
    if (!editingProjectId) return;
    if (!/^\d{4}$/.test(projectAccessCodeInput)) return;
    updateProject(editingProjectId, {
      projectName: projectName.trim() || "Untitled Project",
      projectAdmin: projectAdminInput,
      accessCode: projectAccessCodeInput,
    });
    setShowProjectModal(false);
  };

  const handleOpenProject = (projectId: string) => {
    setActiveProjectId(projectId);
    router.push({ pathname: "/workspace", query: { projectId } });
  };
  return (
    <AppShell>
      {user ? (
        <>
          <section className="flex flex-col gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-300">Projects</p>
            <h2 className="text-3xl font-semibold text-slate-900">Select a project</h2>
            <p className="max-w-3xl text-sm text-slate-500">Open an existing workspace or create a new one from the gallery.</p>
          </section>

          <section className="grid grid-cols-1 gap-5 md:grid-cols-3 xl:grid-cols-4">
            {visibleProjects.map((project) => (
              <button
                key={project.projectId}
                type="button"
                onClick={() => handleOpenProject(project.projectId)}
                className="group overflow-hidden rounded-3xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100">
                  {projectThumbnails[project.projectId] ? (
                    <img
                      src={projectThumbnails[project.projectId]}
                      alt={`${project.projectName} thumbnail`}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400">
                      <span className="text-sm font-semibold">No preview</span>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{project.projectName}</h3>
                    <p className="mt-1 text-xs text-slate-500">Last modified: {new Date(project.lastModifiedAt).toLocaleString()}</p>
                    <p className="text-xs text-slate-400">Admin: {project.projectAdmin}</p>
                  </div>
                  {userIsSystemAdmin && (
                    <div className="flex gap-1">
                      <button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-[10px]" onClick={(e) => { e.stopPropagation(); handleManageProject(project.projectId); }}>Manage</button>
                      {project.projectId !== "project-1" && (
                        <button type="button" className="rounded-md border border-rose-200 px-2 py-1 text-[10px] text-rose-600" onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.projectId); }}>Delete</button>
                      )}
                    </div>
                  )}
                  </div>
                </div>
              </button>
            ))}

            {userIsSystemAdmin && (
            <button
              type="button"
              onClick={() => { setEditingProjectId(null); setProjectName(""); setProjectAdminInput("test@snu.ac.kr"); setProjectAccessCodeInput("1234"); setShowProjectModal(true); }}
              className="flex aspect-[4/3] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white text-slate-500 shadow-sm transition hover:-translate-y-1 hover:border-[var(--primary)] hover:text-[var(--primary)] hover:shadow-lg"
            >
              <span className="text-5xl leading-none">+</span>
              <span className="mt-2 text-sm font-semibold">Create Project</span>
            </button>
          )}
          </section>

          {showProjectModal && (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 px-4">
              <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold text-slate-900">Manage Project</h3>
                  <button type="button" className="rounded-full border border-slate-200 px-3 py-1 text-xs" onClick={() => setShowProjectModal(false)}>Close</button>
                </div>
                <div className="mt-4 space-y-3">
                  <input className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm" placeholder="Project name" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
                  <input className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm" placeholder="Project admin email" value={projectAdminInput} onChange={(event) => setProjectAdminInput(event.target.value)} />
                  <input className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm" placeholder="4-digit access code" value={projectAccessCodeInput} onChange={(event) => setProjectAccessCodeInput(event.target.value.replace(/\D/g, "").slice(0, 4))} />

                </div>
                <button className="mt-4 w-full rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-white" type="button" onClick={editingProjectId ? handleSaveProject : handleCreateProject}>
                  {editingProjectId ? "Save project" : "Create project"}
                </button>
                {editingProjectId && editingProjectId !== "project-1" && (
                  <button className="mt-2 w-full rounded-xl border border-rose-200 px-4 py-3 text-sm font-semibold text-rose-600" type="button" onClick={() => { handleDeleteProject(editingProjectId); setShowProjectModal(false); }}>
                    Delete project
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
      <section className="flex flex-col gap-3">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-300">
          {t("home.badge")}
        </p>
        <h2 className="text-3xl font-semibold text-slate-900">{t("home.title")}</h2>
        <p className="max-w-3xl text-sm text-slate-500">{t("home.description")}</p>
      </section>

      <section className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
        {roles.map((role) => {
          const roleTitle = t(role.titleKey);
          return (
            <div
              key={role.id}
              className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm"
            >
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-8 border-slate-100 text-[var(--primary)]">
                {role.icon}
              </div>
              <h3 className="mt-6 text-lg font-semibold text-slate-900">{roleTitle}</h3>
              <p className="mt-2 text-sm text-slate-500">{t(role.descriptionKey)}</p>
              <button
                className="mt-6 rounded-full bg-[var(--primary)] px-6 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
                type="button"
                onClick={() => {
                  setSelectedRole(role.id);
                  setShowLogin(true);
                }}
              >
                {t("home.signIn")}
              </button>
            </div>
          );
        })}
      </section>

      {showLogin && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-400">
                  {t("home.secureAccess")}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-900">
                  {t("home.signInWorkspace")}
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  {t("home.role")}: <span className="font-semibold">{selectedRole ? t(roleLabelKeys[selectedRole]) : ""}</span>
                </p>
              </div>
              <button
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 hover:border-slate-300"
                type="button"
                onClick={() => setShowLogin(false)}
              >
                {t("home.close")}
              </button>
            </div>
            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              {!isConfigured && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                  {t("home.authNotConfigured")}
                </div>
              )}
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">
                  {t("home.email")}
                </label>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-[var(--primary)] focus:outline-none"
                  placeholder="analyst@ppss-lab.com"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">
                  {t("home.password")}
                </label>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-[var(--primary)] focus:outline-none"
                  placeholder="••••••••"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              {errorMessage && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-600">
                  {errorMessage}
                </div>
              )}
              <button
                className="w-full rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
                type="submit"
                disabled={!isConfigured}
              >
                {t("home.continue")}
              </button>
              <div className="text-center text-xs text-slate-400">{t("home.or")}</div>
              <button
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                type="button"
                onClick={handleGoogleSignUp}
                disabled={!isConfigured}
              >
                {t("home.google")}
              </button>
            </form>
          </div>
        </div>
      )}
        </>
      )}
    </AppShell>
  );
}
