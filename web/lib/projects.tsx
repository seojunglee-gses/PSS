import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { projectRequest } from "./membership/client";
import { useAuth } from "./auth";

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
  ) => Promise<ProjectMeta>;

  touchProject: (projectId: string) => void;
  updateProject: (projectId: string, patch: Partial<ProjectMeta>) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  loadingProjects: boolean;
  projectError: string;
  joinedProjectIds: string[];
  lastProjectId: string | null;
  refreshProjects: () => Promise<void>;
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
  accessCode: project.accessCode ?? "",
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

const createProjectId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `project-${crypto.randomUUID()}`;
  }
  return `project-${Date.now()}`;
};

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(
    null,
  );
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectError, setProjectError] = useState("");
  const [joinedProjectIds, setJoinedProjectIds] = useState<string[]>([]);
  const [lastProjectId, setLastProjectId] = useState<string | null>(null);
  const uidRef = useRef(user?.uid);
  const projectLoadRef = useRef(0);
  const [ownerUid, setOwnerUid] = useState<string | undefined>();
  const refreshProjects = useCallback(async () => {
    if (!user) return;
    const owner = user.uid;
    const requestId = ++projectLoadRef.current;
    let data;
    try {
      data = await projectRequest(user, "/api/projects");
    } catch (error) {
      if (uidRef.current === owner && requestId === projectLoadRef.current)
        setProjectError(
          error instanceof Error
            ? error.message
            : "사업 정보를 불러오지 못했어요.",
        );
      throw error;
    }
    if (uidRef.current !== owner || requestId !== projectLoadRef.current)
      return;
    const next = (data.projects as Partial<ProjectMeta>[]).map((p) =>
      normalizeProject(p),
    );
    setProjects(next);
    setJoinedProjectIds(data.joinedIds);
    setLastProjectId(data.lastProjectId);
    setActiveProjectIdState((previous) =>
      previous && data.joinedIds.includes(previous) && next.some((p) => p.projectId === previous)
        ? previous
        : (data.lastProjectId ??
          (data.joinedIds.length === 1 ? data.joinedIds[0] : null)),
    );
    setProjectError("");
  }, [user]);
  useEffect(() => {
    let current = true;
    uidRef.current = user?.uid;
    projectLoadRef.current += 1;
    setOwnerUid(user?.uid);
    setProjects([]);
    setJoinedProjectIds([]);
    setLastProjectId(null);
    setProjectError("");
    setActiveProjectIdState(null);
    // Remove legacy plaintext project caches; none of these grant authorization.
    try { localStorage.removeItem(PROJECTS_KEY); } catch { /* Optional cache. */ }
    if (!user) {
      setLoadingProjects(false);
      return;
    }
    setLoadingProjects(true);
    let cached: string | null = null;
    try { cached = localStorage.getItem(`${ACTIVE_PROJECT_KEY}-${user.uid}`); } catch { /* Firebase remains authoritative. */ }
    if (cached) setActiveProjectIdState(cached);
    refreshProjects()
      .catch((e) => {
        if (current)
          setProjectError(
            e instanceof Error ? e.message : "사업 정보를 불러오지 못했어요.",
          );
      })
      .finally(() => {
        if (current) setLoadingProjects(false);
      });
    return () => {
      current = false;
    };
  }, [user, refreshProjects]);
  const setActiveProjectId = useCallback(
    (projectId: string) => {
      setActiveProjectIdState(projectId);
      if (user)
        try { localStorage.setItem(`${ACTIVE_PROJECT_KEY}-${user.uid}`, projectId); } catch { /* Optional navigation cache. */ }
    },
    [user],
  );
  const mutate = async (
    action: string,
    projectId: string,
    project?: Partial<ProjectMeta>,
  ) => {
    if (!user) throw new Error("로그인 상태를 확인해주세요.");
    try {
      await projectRequest(user, "/api/projects", {
        action,
        projectId,
        ...(project ? { project } : {}),
      });
      if (uidRef.current === user.uid) projectLoadRef.current += 1;
    } catch (e) {
      if (uidRef.current === user.uid)
        setProjectError(
          e instanceof Error ? e.message : "사업 정보를 저장하지 못했어요.",
        );
      throw e;
    }
  };
  const createProject = async (
    projectName: string,
    options?: {
      projectAdmin?: string;
      accessCode?: string;
      createdByEmail?: string;
    },
  ) => {
    const item = normalizeProject(
      {
        projectId: createProjectId(),
        projectName,
        projectAdmin:
          options?.projectAdmin || options?.createdByEmail || "test@snu.ac.kr",
        accessCode: options?.accessCode,
        workspaceContent: defaultWorkspaceContent(),
      },
      { forNewProject: true },
    );
    await mutate("create", item.projectId, item);
    if (uidRef.current === user?.uid) {
      setProjects((prev) => [item, ...prev]);
      setActiveProjectId(item.projectId);
    }
    return item;
  };
  const updateProject = async (
    projectId: string,
    patch: Partial<ProjectMeta>,
  ) => {
    await mutate("update", projectId, patch);
    if (uidRef.current !== user?.uid) return;
    setProjects((prev) =>
      prev.map((p) =>
        p.projectId === projectId
          ? normalizeProject({
              ...p,
              ...patch,
              workspaceContent: {
                ...p.workspaceContent,
                ...patch.workspaceContent,
              },
              lastModifiedAt: nowIso(),
            })
          : p,
      ),
    );
  };
  const touchProject = (projectId: string) => {
    void mutate("touch", projectId).catch(() => {});
  };
  const deleteProject = async (projectId: string) => {
    await mutate("delete", projectId);
    if (uidRef.current !== user?.uid) return;
    setProjects((prev) => prev.filter((p) => p.projectId !== projectId));
    setJoinedProjectIds((prev) => prev.filter((id) => id !== projectId));
    if (activeProjectId === projectId) setActiveProjectIdState(null);
  };
  const owned = ownerUid === user?.uid;
  const activeProject = owned
    ? (projects.find((p) => p.projectId === activeProjectId) ?? null)
    : null;
  const value = {
    projects: owned ? projects : [],
    activeProjectId: owned ? activeProjectId : null,
    activeProject,
    setActiveProjectId,
    createProject,
    touchProject,
    updateProject,
    deleteProject,
    loadingProjects: !owned || loadingProjects,
    projectError: owned ? projectError : "",
    joinedProjectIds: owned ? joinedProjectIds : [],
    lastProjectId: owned ? lastProjectId : null,
    refreshProjects,
  };
  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}
export function useProject() {
  const context = useContext(ProjectContext);
  if (!context)
    throw new Error("useProject must be used within ProjectProvider");
  return context;
}
