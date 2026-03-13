import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ProjectMeta = {
  projectId: string;
  projectName: string;
  createdAt: string;
  lastModifiedAt: string;
};

type ProjectContextValue = {
  projects: ProjectMeta[];
  activeProjectId: string | null;
  activeProject: ProjectMeta | null;
  setActiveProjectId: (projectId: string) => void;
  createProject: (projectName: string) => ProjectMeta;
  touchProject: (projectId: string) => void;
};

const PROJECTS_KEY = "ppss-projects";
const ACTIVE_PROJECT_KEY = "ppss-active-project-id";
const LEGACY_PROJECT_ID = "project-1";

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

const nowIso = () => new Date().toISOString();

const buildDefaultProject = (): ProjectMeta => {
  const now = nowIso();
  return {
    projectId: LEGACY_PROJECT_ID,
    projectName: "Project #1",
    createdAt: now,
    lastModifiedAt: now,
  };
};

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let parsed: ProjectMeta[] = [];
    try {
      parsed = JSON.parse(window.localStorage.getItem(PROJECTS_KEY) ?? "[]") as ProjectMeta[];
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

  const createProject = (projectName: string) => {
    const now = nowIso();
    const item: ProjectMeta = {
      projectId: `project-${Date.now()}`,
      projectName,
      createdAt: now,
      lastModifiedAt: now,
    };
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

  const value = useMemo(
    () => ({
      projects,
      activeProjectId,
      activeProject: projects.find((project) => project.projectId === activeProjectId) ?? null,
      setActiveProjectId,
      createProject,
      touchProject,
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
