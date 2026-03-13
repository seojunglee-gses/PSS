import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CaseStudyContent = {
  id: string;
  label: string;
  title: string;
  text: string;
  imageUrl: string;
};

export type StageWorkspaceContent = {
  problem: { title: string; text: string; imageUrl: string };
  data: { title: string; text: string; imageUrl: string; cases: CaseStudyContent[] };
  alternatives: { text: string; imageUrl: string };
  evaluation: { text: string; imageUrl: string };
  report: { text: string; imageUrl: string };
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
  createProject: (
    projectName: string,
    options?: { projectAdmin?: string; accessCode?: string; createdByEmail?: string }
  ) => ProjectMeta;

  touchProject: (projectId: string) => void;
  updateProject: (projectId: string, patch: Partial<ProjectMeta>) => void;
  deleteProject: (projectId: string) => void;
};

const PROJECTS_KEY = "ppss-projects";
const ACTIVE_PROJECT_KEY = "ppss-active-project-id";
const LEGACY_PROJECT_ID = "project-1";

const defaultDataCases = (): CaseStudyContent[] => [
  {
    id: "patterns",
    label: "789 Art Zone",
    title: "Case Study 1: 789 Art Zone",
    text: "Describe key regeneration patterns observed in this case.",
    imageUrl: "",
  },
  {
    id: "painpoints",
    label: "Gyeungui Line Forest Park",
    title: "Case Study 2: Gyeungui Line Forest Park",
    text: "Summarize major constraints, trade-offs, and local concerns.",
    imageUrl: "",
  },
  {
    id: "opportunities",
    label: "Highline Park",
    title: "Case Study 3: Highline Park",
    text: "Capture transferable opportunities for this project context.",
    imageUrl: "",
  },
];

const defaultWorkspaceContent = (): StageWorkspaceContent => ({
  problem: {
    title: "Problem Definition",
    text: "Add the core project challenge, context, and desired outcomes here.",
    imageUrl: "",
  },
  data: {
    title: "Data Analysis",
    text: "Add framing notes for the case studies and analytical focus.",
    imageUrl: "",
    cases: defaultDataCases(),
  },
  alternatives: { text: "", imageUrl: "" },
  evaluation: { text: "", imageUrl: "" },
  report: { text: "", imageUrl: "" },
});

const legacyProjectWorkspaceContent = (): StageWorkspaceContent => ({
  problem: {
    title: "Seoul Station Overpass Regeneration",
    text: "Before its transformation, the Seoul Station Overpass had aging infrastructure, fragmented connectivity, and local social concerns that required an integrated regeneration strategy.",
    imageUrl: "https://www.newswire.co.kr/data/datafile2/thumb_480/201605/20160525105554_6279709678.jpg",
  },
  data: {
    title: "Reference Case Studies",
    text: "Compare representative regeneration cases and extract transferable insights for implementation.",
    imageUrl: "",
    cases: [
      {
        id: "patterns",
        label: "789 Art Zone",
        title: "Case Study 1: 789 Art Zone",
        text: "Adaptive reuse of industrial heritage with strong creative-economy positioning, plus lessons on commercialization pressure.",
        imageUrl: "https://museumofwander.com/wp-content/uploads/2023/03/DSC00795.jpg",
      },
      {
        id: "painpoints",
        label: "Gyeungui Line Forest Park",
        title: "Case Study 2: Gyeungui Line Forest Park",
        text: "Linear-park regeneration emphasizing neighborhood reconnection, participatory governance, and balancing local impacts.",
        imageUrl: "https://parks.seoul.go.kr/images/egovframework/com/template/gus3.jpg",
      },
      {
        id: "opportunities",
        label: "Highline Park",
        title: "Case Study 3: Highline Park",
        text: "Citizen-led advocacy and public-private partnerships that transformed obsolete infrastructure into a global placemaking model.",
        imageUrl: "https://cdn.vox-cdn.com/thumbor/vfP32EdfHssHtEknAq-I1Tyv0Zw=/0x0:2000x1333/2070x828/filters:focal(840x507:1160x827):format(webp)/cdn.vox-cdn.com/uploads/chorus_image/image/63748975/Highline_Guide_Max_Touhey_20190416_0082.0.jpg",
      },
    ],
  },
  alternatives: { text: "", imageUrl: "" },
  evaluation: { text: "", imageUrl: "" },
  report: { text: "", imageUrl: "" },
});

const emptyWorkspaceContent = (): StageWorkspaceContent => ({
  problem: { title: "Problem Definition", text: "", imageUrl: "" },
  data: { title: "Data Analysis", text: "", imageUrl: "", cases: defaultDataCases().map((item) => ({ ...item, text: "", imageUrl: "" })) },
  alternatives: { text: "", imageUrl: "" },
  evaluation: { text: "", imageUrl: "" },
  report: { text: "", imageUrl: "" },
});

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

const nowIso = () => new Date().toISOString();

const normalizeProject = (
  project: Partial<ProjectMeta>,
  options?: { forNewProject?: boolean }
): ProjectMeta => ({
  projectId: project.projectId ?? `project-${Date.now()}`,
  projectName: project.projectName ?? "Untitled Project",
  createdAt: project.createdAt ?? nowIso(),
  lastModifiedAt: project.lastModifiedAt ?? nowIso(),
  projectAdmin: project.projectAdmin ?? "test@snu.ac.kr",
  accessCode: /^\d{4}$/.test(project.accessCode ?? "") ? (project.accessCode as string) : "1234",
  workspaceContent: (() => {
    const defaults = options?.forNewProject
      ? defaultWorkspaceContent()
      : project.projectId === LEGACY_PROJECT_ID
        ? legacyProjectWorkspaceContent()
        : emptyWorkspaceContent();
    const incoming = project.workspaceContent ?? ({} as Partial<StageWorkspaceContent>);
    const normalizeStage = (
      value: unknown,
      fallback: { text: string; imageUrl: string }
    ) => {
      if (typeof value === "string") {
        return { text: value, imageUrl: "" };
      }
      if (value && typeof value === "object") {
        const stage = value as { text?: string; imageUrl?: string };
        return {
          text: typeof stage.text === "string" ? stage.text : fallback.text,
          imageUrl:
            typeof stage.imageUrl === "string" ? stage.imageUrl : fallback.imageUrl,
        };
      }
      return fallback;
    };
    return {
      problem: {
        ...normalizeStage(incoming.problem, defaults.problem),
        title:
          typeof (incoming.problem as { title?: string } | undefined)?.title ===
          "string"
            ? (incoming.problem as { title: string }).title
            : defaults.problem.title,
      },
      data: {
        ...normalizeStage(incoming.data, defaults.data),
        title:
          typeof (incoming.data as { title?: string } | undefined)?.title === "string"
            ? (incoming.data as { title: string }).title
            : defaults.data.title,
        cases: Array.isArray((incoming.data as { cases?: unknown[] } | undefined)?.cases)
          ? ((incoming.data as { cases: unknown[] }).cases
              .map((item, index) => {
                const fallback = defaults.data.cases[index] ?? {
                  id: `case-${index + 1}`,
                  label: `Case ${index + 1}`,
                  title: `Case ${index + 1}`,
                  text: "",
                  imageUrl: "",
                };
                if (!item || typeof item !== "object") {
                  return fallback;
                }
                const value = item as Partial<CaseStudyContent>;
                return {
                  id: typeof value.id === "string" ? value.id : fallback.id,
                  label:
                    typeof value.label === "string" ? value.label : fallback.label,
                  title:
                    typeof value.title === "string" ? value.title : fallback.title,
                  text: typeof value.text === "string" ? value.text : fallback.text,
                  imageUrl:
                    typeof value.imageUrl === "string"
                      ? value.imageUrl
                      : fallback.imageUrl,
                };
              })
              .slice(0, 3) as CaseStudyContent[])
          : defaults.data.cases.map((item) => ({ ...item })),
      },
      alternatives: normalizeStage(incoming.alternatives, defaults.alternatives),
      evaluation: normalizeStage(incoming.evaluation, defaults.evaluation),
      report: normalizeStage(incoming.report, defaults.report),
    };
  })(),
});

const buildDefaultProject = (): ProjectMeta =>
  normalizeProject(
    {
      projectId: LEGACY_PROJECT_ID,
      projectName: "Project #1",
      projectAdmin: "test@snu.ac.kr",
      accessCode: "1234",
    },
    { forNewProject: false }
  );

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let parsed: ProjectMeta[] = [];
    try {
      const raw = JSON.parse(window.localStorage.getItem(PROJECTS_KEY) ?? "[]") as Partial<ProjectMeta>[];
      parsed = raw.map((item) => normalizeProject(item, { forNewProject: false }));
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

  const createProject = (
    projectName: string,
    options?: { projectAdmin?: string; accessCode?: string; createdByEmail?: string }
  ) => {

    const now = nowIso();
    const item: ProjectMeta = normalizeProject(
      {
        projectId: `project-${Date.now()}`,
        projectName,
        createdAt: now,
        lastModifiedAt: now,
        projectAdmin:
          options?.projectAdmin || options?.createdByEmail || "test@snu.ac.kr",
        accessCode: /^\d{4}$/.test(options?.accessCode ?? "")
          ? (options?.accessCode as string)
          : "1234",

        workspaceContent: defaultWorkspaceContent(),
      },
      { forNewProject: true }
    );
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
        ? normalizeProject(
            {
              ...project,
              ...patch,
              workspaceContent: {
                ...project.workspaceContent,
                ...(patch.workspaceContent ?? {}),
              },
              lastModifiedAt: nowIso(),
            },
            { forNewProject: false }
          )
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
