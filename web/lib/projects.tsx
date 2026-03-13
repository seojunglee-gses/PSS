import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type StageWorkspaceContent = {
  problem: string;
  data: string;
  alternatives: string;
  evaluation: string;
  report: string;
};

export type ProjectMeta = {
  projectId: string;
  projectName: string;
  createdAt: string;
  lastModifiedAt: string;
  projectAdmin: string;
  accessCode: string;
  workspaceContent: StageWorkspaceContent;
};

type ProjectContextValue = {
  projects: ProjectMeta[];
  activeProjectId: string | null;
  activeProject: ProjectMeta | null;
  setActiveProjectId: (projectId: string) => void;
  createProject: (projectName: string, createdByEmail?: string) => ProjectMeta;
  touchProject: (projectId: string) => void;
  updateProject: (projectId: string, patch: Partial<ProjectMeta>) => void;
  deleteProject: (projectId: string) => void;
};

const PROJECTS_KEY = "ppss-projects";
const ACTIVE_PROJECT_KEY = "ppss-active-project-id";
const LEGACY_PROJECT_ID = "project-1";

const emptyWorkspaceContent = (): StageWorkspaceContent => ({
  problem: "",
  data: "",
  alternatives: "",
  evaluation: "",
  report: "",
});

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

const nowIso = () => new Date().toISOString();

const normalizeProject = (project: Partial<ProjectMeta>): ProjectMeta => ({
  projectId: project.projectId ?? `project-${Date.now()}`,
  projectName: project.projectName ?? "Untitled Project",
  createdAt: project.createdAt ?? nowIso(),
  lastModifiedAt: project.lastModifiedAt ?? nowIso(),
  projectAdmin: project.projectAdmin ?? "test@snu.ac.kr",
  accessCode: /^\d{4}$/.test(project.accessCode ?? "") ? (project.accessCode as string) : "1234",
  workspaceContent: {
    ...emptyWorkspaceContent(),
    ...(project.workspaceContent ?? {}),
  },
});

const buildDefaultProject = (): ProjectMeta =>
  normalizeProject({
    projectId: LEGACY_PROJECT_ID,
    projectName: "Project #1",
    projectAdmin: "test@snu.ac.kr",
    accessCode: "1234",
  });

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let parsed: ProjectMeta[] = [];
    try {
      const raw = JSON.parse(window.localStorage.getItem(PROJECTS_KEY) ?? "[]") as Partial<ProjectMeta>[];
      parsed = raw.map(normalizeProject);
    } catch {
      parsed = [];
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      parsed = [buildDefaultProject()];
      window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(parsed));
    }
    setProjects(parsed);

    const storedActive = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
    const resolvedActive = parsed.some((project) => project.projectId === storedActive)
      ? storedActive
      : parsed[0]?.projectId;
    if (resolvedActive) {
      setActiveProjectIdState(resolvedActive);
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, resolvedActive);
    }
  }, []);

  const persistProjects = (next: ProjectMeta[]) => {
    setProjects(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
    }
  };

  const setActiveProjectId = (projectId: string) => {
    setActiveProjectIdState(projectId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    }
  };

  const createProject = (projectName: string, createdByEmail?: string) => {
    const now = nowIso();
    const item: ProjectMeta = normalizeProject({
      projectId: `project-${Date.now()}`,
      projectName,
      createdAt: now,
      lastModifiedAt: now,
      projectAdmin: createdByEmail || "test@snu.ac.kr",
      accessCode: "1234",
      workspaceContent: emptyWorkspaceContent(),
    });
    const next = [item, ...projects];
    persistProjects(next);
    setActiveProjectId(item.projectId);
    return item;
  };

  const touchProject = (projectId: string) => {
    const next = projects.map((project) =>
      project.projectId === projectId
        ? { ...project, lastModifiedAt: nowIso() }
        : project
    );
    persistProjects(next);
  };

  const updateProject = (projectId: string, patch: Partial<ProjectMeta>) => {
    const next = projects.map((project) =>
      project.projectId === projectId
        ? normalizeProject({
            ...project,
            ...patch,
            workspaceContent: {
              ...project.workspaceContent,
              ...(patch.workspaceContent ?? {}),
            },
            lastModifiedAt: nowIso(),
          })
        : project
    );
    persistProjects(next);
  };

  const deleteProject = (projectId: string) => {
    const next = projects.filter((project) => project.projectId !== projectId);
    persistProjects(next);
    if (activeProjectId === projectId && next[0]) {
      setActiveProjectId(next[0].projectId);
    }
  };

  const value = useMemo(
    () => ({
      projects,
      activeProjectId,
      activeProject: projects.find((project) => project.projectId === activeProjectId) ?? null,
      setActiveProjectId,
      createProject,
      touchProject,
      updateProject,
      deleteProject,
    }),
    [projects, activeProjectId]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProject must be used within ProjectProvider");
  }
  return context;
}
