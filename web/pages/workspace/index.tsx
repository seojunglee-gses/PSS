import { MODELS } from "../../lib/llm/openai";
import { createPortal } from "react-dom";
import { spatialGoals } from "../../lib/spatial/goals";
import type { GeoResult } from "../../lib/spatial/geo-query";
import { analysisActivities, analysisActivityText, analysisSessionQuestion, parseAnalysisActivity, type AnalysisActivity } from "../../lib/analysis-session";
import { mergeStepChatLogs } from "../../lib/chat-history";
import {isDesignGenerationRequest} from "../../lib/facilitation";
import { useGeoWorkspace } from "../../lib/spatial/use-geo";
import { isGeoQuestion, mapPointLabel, spatialConversationQuestion, placeResultFollowUp, spatialToolRequest, isSpatialToolExplanation, isSpatialToolCancelled } from "../../lib/spatial/geo-query";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import SpatialSummary from "../../components/spatial/SpatialSummary";
import { parseSpatialResult } from "../../lib/spatial/context";
import type { SpatialResult } from "../../lib/spatial/types";
function SpatialLoading() { const { t } = useI18n(); return <p className="p-6 text-sm text-slate-500">{t("spatial.loadingView")}</p>; }
const SpatialAnalysis = dynamic(() => import("../../components/spatial/SpatialAnalysis"), { ssr: false, loading: SpatialLoading });

import ProjectAccessGate from "../../components/projects/ProjectAccessGate";
import AppShell from "../../components/AppShell";
import WorkspacePanels from "../../components/WorkspacePanels";
import ContentEditor, { ContentText, type ContentEditorHandle } from "../../components/ContentEditor";
import ProjectImageGallery from "../../components/ProjectImageGallery";
import CaseSourceManager from "../../components/analysis/CaseSourceManager";
import { DEFAULT_PANEL_RATIO, type WorkspacePanelView } from "../../lib/workspace-layout";
import ChatMessageContent from "../../components/chat/ChatMessageContent";
import StageChatEmptyState from "../../components/chat/StageChatEmptyState";
import { resolveSources, sourceRoutingQuestion } from "../../lib/research/routing";
import { dataAnalysisStarterPrompts, stageChatGuide } from "../../lib/stage-chat-guides";
import {
  loadChatLogsFromFirestore,
  loadCurrentSiteImage,
  loadStageLocks,
  loadWorkspaceSummary,
  loadConfirmedStageSummaries,
  saveConfirmedStageSummary,
  saveChatLogsToFirestore,
  saveUserDesignSubmission,
  saveWorkspaceSummary,
  sendEvaluationResult,
  loadEvaluationResults,
  loadEvaluationImages,
  saveStageLocks,
  loadLatestExecutiveSummariesByStage,
  saveStepChatLogs,
  loadStepChatLogs,
  loadAllWorkspaceSummaries,
} from "../../lib/firebase";
import { useAuth } from "../../lib/auth";
import { useRouter } from "next/router";
import { useProject } from "../../lib/projects";
import { canManageProject, isSystemAdmin } from "../../lib/rbac";
import { loadGeneratedImages } from "../../lib/firebase";
import type { SiteImage } from "../../lib/firebase";
import { normalizeRoleId, roleLabelKeys, useI18n, localizeDefaultContent } from "../../lib/i18n";
import SourceSelector from "../../components/analysis/SourceSelector";
import EvidencePanel from "../../components/analysis/EvidencePanel";
import AnalysisAnswerView from "../../components/analysis/AnalysisAnswer";
import { conversationHistory, clarificationExchange } from "../../lib/chat-history";
import type { Finding } from "../../lib/research/types";
import { researchLabels } from "../../lib/research/labels";
import { DEFAULT_SOURCES, usedAnswerEvidence, type AnalysisRecord, type EvidenceSource } from "../../lib/research/types";

const providerLabel = (value: string) => /^chatgpt$/i.test(value) ? "ChatGPT" : value;

const getChatModelByProvider = (provider: string) => {
  if (provider.toLowerCase() === "gemini") {
    return "gemini-1.5-flash";
  }
  if (provider.toLowerCase() === "deepseek") {
    return "deepseek-chat";
  }
  return MODELS.chat;
};


const steps = [
  { id: "problem", titleKey: "step.problem", icon: "1" },
  { id: "data", titleKey: "step.data", icon: "2" },
  { id: "alternatives", titleKey: "step.alternatives", icon: "3" },
  { id: "evaluation", titleKey: "step.evaluation", icon: "4" },
  { id: "report", titleKey: "step.report", icon: "5" },
];

const providerStorageKeyBase = "ppss-active-provider";
const pieColors = [
  "#2563eb",
  "#38bdf8",
  "#a855f7",
  "#f97316",
  "#10b981",
  "#facc15",
  "#f43f5e",
];

type ChatLog = {
  stepId: string;
  provider: string;
  sender: "user" | "assistant";
  text: string;
  label: string;
  createdAt: string;
  imageUrl?: string;
  imageId?: string;
  imageLabel?: string;
  imageNote?: string;
  selectedSources?: EvidenceSource[];
  analysis?: AnalysisRecord;
  activity?: AnalysisActivity;
};

function normalizeSender(
  sender?: string
): "user" | "assistant" | undefined {
  if (sender === "Planner") return "user";
  if (sender === "ChatGPT") return "assistant";
  if (sender === "user" || sender === "assistant") return sender;
  return undefined;
}

type DesignImage = {
  id: string;
  label: string;
  note: string;
  imageUrl?: string;
  createdAt?: string;
  submittedBy?: string;
  userId?: string;
};

type ExecutiveSummary = {
  keywords: string[];
  stageSummaries: {
    problemDefinition: string;
    dataAnalysis: string;
    designAlternatives: string;
    designEvaluation: string;
    decision: string;
  };
};

type WorkspaceSummaryRecord = {
  userId: string;
  summary: {
    stageSummaries: Record<string, string>;
    overallSummary: string;
    role?: string;
  };
};

const roleDescriptionKeys: Record<string, string> = {
  public: "roledesc.public",
  business: "roledesc.business",
  planners: "roledesc.planners",
  government: "roledesc.government",
};

const roleIcons: Record<string, React.ReactElement> = {
  All: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
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
  public: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
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
  business: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
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
  planners: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
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
  government: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
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
};

const formatParticipantLabel = (index: number, userId?: string) => {
  if (userId) {
    return `Participant ${index + 1}`;
  }
  return `Participant ${index + 1}`;
};

export default function Workspace() {
  return <ProjectAccessGate><AuthorizedWorkspace /></ProjectAccessGate>;
}

function AuthorizedWorkspace() {
  const [currentSiteImage, setCurrentSiteImage] =
  useState<SiteImage | null>(null);
  const router = useRouter();
  const { t, locale, localize } = useI18n();
  const analysisLabels = researchLabels(locale);
  const { activeProjectId, setActiveProjectId, touchProject, activeProject, updateProject, projectError } = useProject();
  const { user, loading } = useAuth();
  const userKey = user?.uid;
  const queryProjectId = typeof router.query.projectId === "string" ? router.query.projectId : null;
  const projectId = queryProjectId ?? activeProjectId ?? "project-1";
  const [geoChat, setGeoChat] = useState<{time: string; question: string} | null>(null);
  const providerStorageKey = `${providerStorageKeyBase}-${projectId}`;
  const activeStepStorageKey = `ppss-active-step-${projectId}`;
  const [activeStep, setActiveStep] = useState(steps[0]);
  const [panelRatio, setPanelRatio] = useState(DEFAULT_PANEL_RATIO);
  const [panelView, setPanelView] = useState<WorkspacePanelView>("information");
  const [compactHeader, setCompactHeader] = useState(true);
  const [activeTab, setActiveTab] = useState("patterns");
  const [inputValue, setInputValue] = useState("");
  const [expandedStarterScope, setExpandedStarterScope] = useState<string | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [starterOverlay, setStarterOverlay] = useState<React.CSSProperties | null>(null);
  const starterButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setPortalReady(true); }, []);
  useEffect(() => {
    if (!expandedStarterScope) { setStarterOverlay(null); return; }
    const button = starterButton.current;
    const shell = button?.closest<HTMLElement>(".workspace-shell");
    if (!button || shell?.dataset.tablet !== "true") { setStarterOverlay(null); return; }
    const position = () => {
      const anchor = button.getBoundingClientRect(), panel = button.closest(".workspace-chat")?.getBoundingClientRect();
      if (!panel) return;
      setStarterOverlay({ left: panel.left + 16, top: anchor.bottom, width: Math.max(0, anchor.left - panel.left - 28), transform: "translateY(-100%)" });
    };
    position();
    const observer = new ResizeObserver(position); observer.observe(button); if (button.closest(".workspace-chat")) observer.observe(button.closest(".workspace-chat")!);
    window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position); window.visualViewport?.addEventListener("scroll", position);
    return () => { observer.disconnect(); window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); window.visualViewport?.removeEventListener("resize", position); window.visualViewport?.removeEventListener("scroll", position); };
  }, [expandedStarterScope]);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const [selectedSources, setSelectedSources] = useState<EvidenceSource[]>([]);
  const [inspectedSpatial, setInspectedSpatial] = useState<SpatialResult | null>(null);
  const [inspectedCaseFindings, setInspectedCaseFindings] = useState<Finding[]>([]);
  const [inspectedResearchFindings, setInspectedResearchFindings] = useState<Finding[]>([]);
  const [inspectedEvidence, setInspectedEvidence] = useState<AnalysisRecord["evidence"] | null>(null);
  const [spatialCategory, setSpatialCategory] = useState<number | null>(null);
  const [analysisView, setAnalysisView] = useState<"cases" | "spatial" | "answer">("cases");
  const [spatialResult, setSpatialResult] = useState<SpatialResult | null>(null);
  const spatialStorageKey = userKey ? `ppss-spatial-${projectId}-${userKey}` : null;
  useEffect(() => {
    setSpatialResult(null);
    if (!spatialStorageKey) return;
    try {
      const saved = localStorage.getItem(spatialStorageKey);
      const restored = saved ? parseSpatialResult(JSON.parse(saved)) : undefined;
      if (restored?.projectId === projectId) setSpatialResult(restored);
    } catch { /* Invalid or unavailable local storage does not affect the workspace. */ }
  }, [spatialStorageKey, projectId]);
  const updateSpatialResult = (result: SpatialResult | null) => {
    if (result && result.projectId !== projectId) return;
    setSpatialResult(result);
    try {
      if (spatialStorageKey) {
        if (result) localStorage.setItem(spatialStorageKey, JSON.stringify(result));
        else localStorage.removeItem(spatialStorageKey);
      }
    } catch { /* The in-memory result remains usable when storage is unavailable. */ }
  };
  const [highlightedEvidence, setHighlightedEvidence] = useState<string | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const chatGenerationRef = useRef(0);
  useEffect(() => () => { analysisAbortRef.current?.abort(); }, [projectId, userKey]);
  const [role, setRole] = useState("Guest");
  const normalizedActiveRole = normalizeRoleId(role);
  const [activeProvider, setActiveProvider] = useState("ChatGPT");
  const geo = useGeoWorkspace(projectId, activeProvider);




  const chatStorageKey = useMemo(
    () => (userKey ? `ppss-chat-logs-${projectId}-${userKey}` : null),
    [userKey, projectId]
  );
  
  useEffect(() => {
    if (queryProjectId && queryProjectId !== activeProjectId) {
      setActiveProjectId(queryProjectId);
    }
  }, [queryProjectId, activeProjectId, setActiveProjectId]);

  useEffect(() => {
    chatGenerationRef.current += 1;
    sendingRef.current = false;
    setIsSending(false);
    setIsLoadingAlternatives(false);
    dataLogsRef.current = [];
    setChatLogsByStep({});
    setLoadedChatScope(null);
    setSavedSummaries({});
    setCompletedStages([]);
    setGeneratedImages([]);
    setEvaluationImages([]);
    setEvaluationResults([]);
    setExecutiveSummary(null);
    setAllWorkspaceSummaries([]);
    setCurrentSiteImage(null);
    setSiteImageId(null);
    setSelectedImage(null);
    setSelectedAlternative(null);
    setSelectedSources([]);
    setInspectedEvidence(null);
    setInspectedResearchFindings([]);
    setInspectedCaseFindings([]);
    setInspectedSpatial(null);
    setHighlightedEvidence(null);
    setAnalysisView("cases");
    setSpatialCategory(null);
    setExpandedStarterScope(null);
    setErrorMessage(null);
  }, [projectId, userKey]);

  useEffect(() => {
  if (typeof window === "undefined") return;
  
    const saved = localStorage.getItem(activeStepStorageKey);
    if (!saved) return;
  
    const step = steps.find((s) => s.id === saved);
    if (step) {
      setActiveStep(step);
      setExpandedStarterScope(null);
    }
  }, [activeStepStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(activeStepStorageKey, activeStep.id);
  }, [activeStep.id]);

  const persistChatLogs = async (stepId: string, logs: ChatLog[]) => {
    if (!userKey) return;
    try {
      await saveStepChatLogs(userKey, stepId, sanitizeLogs(logs), projectId);
    } catch {
      throw new Error(t("workspace.chatSaveError"));
    }
  };

  const [isSending, setIsSending] = useState(false);
  const [sendingChatScope, setSendingChatScope] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedAlternative, setSelectedAlternative] = useState<string | null>(
    null
  );
  const [showSiteImageWarning, setShowSiteImageWarning] = useState(false);
  type FinishNotice = { status: "uploading" | "success" | "error"; message: string };
  const [finishNotice, setFinishNotice] = useState<FinishNotice | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isLoadingAlternatives, setIsLoadingAlternatives] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const messageHeightRef = useRef(0);
  const messageScrollRef = useRef(0);
  const [generatedImages, setGeneratedImages] = useState<DesignImage[]>([]);
  const [siteImageId, setSiteImageId] = useState<string | null>(null);
  const [evaluationImages, setEvaluationImages] = useState<DesignImage[]>([]);
  const [isLoadingEvaluationImages, setIsLoadingEvaluationImages] =
    useState(false);
  const [lastGeneratedImageId, setLastGeneratedImageId] = useState<
    string | null
  >(null);
  const [rankings, setRankings] = useState<Record<string, number>>(() => {
    return {};
  });
  const [evaluationResults, setEvaluationResults] = useState<
    Array<{
      submittedAt: string;
      rankings: Record<string, number>;
      userId?: string;
      role?: string;
    }>
  >([]);

  const [chatLogsByStep, setChatLogsByStep] = useState<
    Record<string, ChatLog[]>
  >({});
  const dataLogsRef = useRef<ChatLog[]>([]);
  const commitDataLogs = (logs: ChatLog[]) => {
    const merged = mergeStepChatLogs(dataLogsRef.current, logs);
    dataLogsRef.current = merged;
    setChatLogsByStep(prev => ({ ...prev, data: merged }));
    return merged;
  };
  const chatLogs = useMemo(
    () => Object.values(chatLogsByStep).flat(),
    [chatLogsByStep]
  );
  const latestAnalysis = [...(chatLogsByStep.data ?? [])].reverse().find((log) => log.analysis)?.analysis;
  const answerSpatial = inspectedEvidence ? inspectedSpatial : latestAnalysis?.spatialContext;
  const analysisEvidence = inspectedEvidence ?? (latestAnalysis ? usedAnswerEvidence(latestAnalysis) : null);
  const chatScope = `${userKey}/${projectId}/${activeStep.id}`;
  const [loadedChatScope, setLoadedChatScope] = useState<string | null>(null);
  const hasLoadedChatLogs = loadedChatScope === chatScope;
  const hasAnyAlternativeImage = useMemo(() => {
    return chatLogs.some(
      (log) => log.stepId === "alternatives" && Boolean(log.imageUrl)
    );
  }, [chatLogs]);
  
  const [savedSummaries, setSavedSummaries] = useState<
    Record<string, string>
  >({});
  const [executiveSummary, setExecutiveSummary] =
    useState<ExecutiveSummary | null>(null);
  const [allWorkspaceSummaries, setAllWorkspaceSummaries] = useState<
    WorkspaceSummaryRecord[]
  >([]);
  const [activeReportTab, setActiveReportTab] = useState("all");
  const [activeUserTabs, setActiveUserTabs] = useState<Record<string, number>>(
    {}
  );

  const roleByUserId = useMemo(() => {
    const map = new Map<string, string>();
    evaluationResults.forEach((result) => {
      if (result.userId && result.role) {
        const normalized = normalizeRoleId(result.role);
        map.set(result.userId, normalized ? t(roleLabelKeys[normalized]) : result.role);
      }
    });
    return map;
  }, [evaluationResults, t]);

  const buildImageGenerationInput = useCallback(() => {
  const MAX_MESSAGES = 6;

  const relevantLogs = chatLogs
    .filter(
      (log) =>
        log.stepId === "problem" ||
        log.stepId === "data" ||
        log.stepId === "alternatives"
    )
    .slice(-MAX_MESSAGES)
    .map((log) => log.text);

  return {
    problemSummary: savedSummaries.problem ?? "",
    dataSummary: savedSummaries.data ?? "",
    alternativesSummary: savedSummaries.alternatives ?? "",
    recentDiscussion: relevantLogs.join(" "),
  };
}, [chatLogs, savedSummaries]);
  
  const [completedStages, setCompletedStages] = useState<string[]>([]);
  const [completionOpen, setCompletionOpen] = useState(false);
  const completionResolver = useRef<((confirmed: boolean) => void) | null>(null);
  const completionDialog = useRef<HTMLDialogElement>(null);
  const confirmCompletion = () => new Promise<boolean>((resolve) => {
    if (completionResolver.current) { resolve(false); return; }
    completionResolver.current = resolve;
    setCompletionOpen(true);
  });
  const closeCompletion = (confirmed: boolean) => {
    setCompletionOpen(false);
    completionResolver.current?.(confirmed);
    completionResolver.current = null;
  };
  useEffect(() => {
    if (completionOpen) completionDialog.current?.showModal();
    else completionDialog.current?.close();
    if (!completionOpen) return;
    const position = () => {
      const dialog = completionDialog.current, viewport = window.visualViewport;
      if (!dialog) return;
      dialog.style.left = `${(viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) / 2}px`;
      dialog.style.top = `${(viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) / 2}px`;
      dialog.style.maxHeight = `${Math.max(100, (viewport?.height ?? window.innerHeight) - 32)}px`;
    };
    position(); window.addEventListener("resize", position); window.visualViewport?.addEventListener("resize", position); window.visualViewport?.addEventListener("scroll", position);
    return () => { window.removeEventListener("resize", position); window.visualViewport?.removeEventListener("resize", position); window.visualViewport?.removeEventListener("scroll", position); };
  }, [completionOpen, portalReady]);
  useEffect(() => () => completionResolver.current?.(false), []);
  const [summaryOpen,setSummaryOpen]=useState(false);
  const [summaryDraft,setSummaryDraft]=useState("");
  const summaryDialog=useRef<HTMLDialogElement>(null);
  const summaryResolver=useRef<((value:{text:string}|null)=>void)|null>(null);
  const reviewGeneratedSummary=(text:string)=>new Promise<{text:string}|null>(resolve=>{summaryResolver.current=resolve;setSummaryDraft(text);setSummaryOpen(true);});
  const closeSummaryReview=(confirmed:boolean)=>{summaryResolver.current?.(confirmed?{text:summaryDraft.trim()}:null);summaryResolver.current=null;setSummaryOpen(false);};
  useEffect(()=>{if(summaryOpen)summaryDialog.current?.showModal();else summaryDialog.current?.close();},[summaryOpen]);
  useEffect(()=>{summaryResolver.current?.(null);summaryResolver.current=null;setSummaryOpen(false);setSummaryDraft("");},[projectId,userKey,activeStep.id]);
  useEffect(()=>()=>summaryResolver.current?.(null),[]);
  const [lockedStages, setLockedStages] = useState<Record<string, boolean>>({});
  const [revisedAfterLock, setRevisedAfterLock] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (!loading && !user) {
      router.push("/");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!userKey) {
      return;
    }
    let cancelled = false;
    const loadSavedSummaries = async () => {
      const [summary,confirmed]=await Promise.all([loadWorkspaceSummary(userKey,projectId),loadConfirmedStageSummaries(userKey,projectId)]);
      if (cancelled) return;
      setSavedSummaries({...summary?.stageSummaries,...confirmed});
      setCompletedStages(summary?.completedStages ?? []);
    };
    loadSavedSummaries();
    return () => { cancelled = true; };
  }, [userKey, projectId]);

  useEffect(() => {
    if (!userKey) {
      return;
    }
    const loadEvaluations = async () => {
      const results = await loadEvaluationResults(projectId);
      if (results.length) {
        setEvaluationResults(results);
      }
    };
    loadEvaluations();
  }, [userKey, projectId]);

  useEffect(() => {
    if (!userKey) {
      return;
    }
    const loadExecutiveSummary = async () => {
      const summary = await loadLatestExecutiveSummariesByStage(projectId);
      if (summary) {
        setExecutiveSummary(summary);
      }
    };
    loadExecutiveSummary();
  }, [userKey, projectId]);

  useEffect(() => {
    if (!userKey) {
      return;
    }
    const loadSummaries = async () => {
      const summaries = await loadAllWorkspaceSummaries(projectId);
      setAllWorkspaceSummaries(summaries);
    };
    loadSummaries();
  }, [userKey, projectId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedRole = window.localStorage.getItem("ppss-role");
    if (storedRole) {
      const normalized = normalizeRoleId(storedRole);
      setRole(normalized ?? storedRole);
    }
    const storedProvider = window.localStorage.getItem(providerStorageKey);
    if (storedProvider) {
      setActiveProvider(storedProvider);
    }
  }, [providerStorageKey]);

  const normalizeLogs = useCallback(
    (
      logs: Array<
        Partial<ChatLog> & {
          sender?: "Planner" | "ChatGPT" | "user" | "assistant";
        }
      >
    ) =>
      logs
        .map((log, index) => {
          const sender = normalizeSender(log.sender);

          if (!sender || !log.provider) {
            return null;
          }
          const stepId = log.stepId ?? "unknown";
          const label =
            log.label ?? (sender === "assistant" ? log.provider : role);
          const createdAt =
            log.createdAt ?? new Date(Date.now() + index).toISOString();
          const text = log.text ?? "";
          const imageUrl = log.imageUrl;
          const imageId = log.imageId;
          const imageLabel = log.imageLabel;
          const imageNote = log.imageNote;
          if (!text && !imageUrl) {
            return null;
          }
          return {
            stepId,
            provider: log.provider,
            sender,
            text,
            label,
            createdAt,
            imageUrl,
            imageId,
            imageLabel,
            imageNote,
            ...(log.analysis ? { analysis: log.analysis } : {}),
            ...(log.activity && parseAnalysisActivity(log.activity, projectId) ? { activity: parseAnalysisActivity(log.activity, projectId) } : {}),
            ...(log.selectedSources ? { selectedSources: log.selectedSources } : {}),
          } as ChatLog;
        })
        .filter((log): log is ChatLog => Boolean(log))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [role, projectId]
  );

  useEffect(() => {
    if (!userKey) return;
    let cancelled = false;

    const loadStepLogs = async () => {
      setLoadedChatScope(null);
      try {
        const stepLogs = await loadStepChatLogs<
          Array<
            Partial<ChatLog> & {
              sender?: "Planner" | "ChatGPT" | "user" | "assistant";
            }
          >
        >(userKey, activeStep.id, projectId);
        if (cancelled) return;

        const normalized = (stepLogs ?? [])
          .map((log, index) => {
            const sender = normalizeSender(log.sender);
            if (!sender || !log.provider) return null;

            return {
              stepId: activeStep.id,
              provider: log.provider,
              sender,
              text: log.text ?? "",
              label: log.label ?? (sender === "assistant" ? log.provider : role),
              createdAt: log.createdAt ?? new Date(Date.now() + index).toISOString(),
              imageUrl: log.imageUrl,
              imageId: log.imageId,
              imageLabel: log.imageLabel,
              imageNote: log.imageNote,
              ...(log.analysis ? { analysis: log.analysis } : {}),
              ...(log.activity && parseAnalysisActivity(log.activity, projectId) ? { activity: parseAnalysisActivity(log.activity, projectId) } : {}),
              ...(log.selectedSources ? { selectedSources: log.selectedSources } : {}),
            } as ChatLog;
          })
          .filter((log): log is ChatLog => Boolean(log))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        if (activeStep.id === "data") {
          dataLogsRef.current = normalized;
          const current = analysisActivities(normalized, projectId).at(-1);
          if (current?.type === "cases") setActiveTab(current.referenceId);
          if (current?.type === "spatial") {
            updateSpatialResult(current.result ?? null);
            const category = /^category-([0-3])$/.exec(current.referenceId);
            if (category) setSpatialCategory(Number(category[1]));
          }
          const selection = [...analysisActivities(normalized, projectId)].reverse().find(activity => activity.location?.reply === "Selected project feature; location only." || activity.location?.places.some(place => place.id === "map-point"));
          const place = selection?.location?.places.find(place => place.id === "map-point") ?? selection?.location?.places[0] ?? (current?.location?.places.length === 1 ? current.location.places[0] : undefined);
          const scope = selection?.location?.scopeMeters ?? current?.location?.scopeMeters;
          if (place) geo.setContext({ point: place.coordinate, ...(place.layerId && place.featureId ? { selected: { layerId: place.layerId, featureId: place.featureId } } : {pointLabel:place.name}), ...([0, 500, 1000].includes(scope ?? -1) ? { scopeMeters: scope as 0 | 500 | 1000 } : {}) });
        }
        setChatLogsByStep((prev) => ({ ...prev, [activeStep.id]: normalized }));
        setLoadedChatScope(chatScope);
      } catch {
        if (!cancelled) setErrorMessage(t("workspace.chatLoadError"));
      }
    };

    loadStepLogs();
    return () => { cancelled = true; };
  }, [userKey, activeStep.id, projectId, role, t, chatScope]);


  useEffect(() => {
    if (!user) {
      return;
    }
    const loadLocks = async () => {
      const state = await loadStageLocks(projectId);
      if (!state) {
        setLockedStages({});
        setRevisedAfterLock({});
        return;
      }
      setLockedStages(state.lockedStages ?? {});
      setRevisedAfterLock(state.revisedAfterLock ?? {});
    };
    loadLocks();
  }, [user, projectId]);

  const alternativeImages = useMemo(
    () =>
      chatLogs
        .filter((log) => log.stepId === "alternatives" && log.imageUrl)
        .map((log, index) => ({
          id: log.imageId ?? `image-${log.createdAt}`,
          label: `Alternative ${index + 1}`,
          note: log.imageNote ?? "",
          imageUrl: log.imageUrl,
          createdAt: log.createdAt,
        })),
    [chatLogs]
  );

   const refreshEvaluationImages = useCallback(async () => {
    setIsLoadingEvaluationImages(true);
    try {
      const submissions = await loadEvaluationImages(projectId);
      if (!submissions.length) {
        setEvaluationImages([]);
        return;
      }
  
      const byUser = new Map<string, typeof submissions[number]>();
  
      submissions.forEach((submission) => {
        if (!submission.userId) return;
  
      const prev = byUser.get(submission.userId);
        if (!prev || submission.createdAt > prev.createdAt) {
          byUser.set(submission.userId, submission);
        }
      });
  
      const filtered = Array.from(byUser.values());
  
      setEvaluationImages(
        filtered.map((submission, index) => ({
          id: submission.imageId,
          label: `Alternative ${index + 1}`,
          note: submission.note,
          imageUrl: submission.downloadUrl,
          createdAt: submission.createdAt,
          submittedBy: formatParticipantLabel(index, submission.userId),
          userId: submission.userId,
        }))
      );
    } finally {
      setIsLoadingEvaluationImages(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!userKey) {
      return;
    }
    refreshEvaluationImages();
  }, [refreshEvaluationImages, userKey]);
  
  useEffect(() => {
    const loadSiteImage = async () => {
      const current = await loadCurrentSiteImage(projectId);
      if (current?.imageId) {
        setSiteImageId(current.imageId);
        setCurrentSiteImage(current);
      } else {
        setSiteImageId(null);
      }
    };
    loadSiteImage();
  }, [projectId]);

  useEffect(() => {
    setRankings((prev) => {
      const next = { ...prev };
      evaluationImages.forEach((image, index) => {
        if (!next[image.id]) {
          next[image.id] = index + 1;
        }
      });
      Object.keys(next).forEach((key) => {
        if (!evaluationImages.find((image) => image.id === key)) {
          delete next[key];
        }
      });
      return next;
    });
  }, [evaluationImages]);

  const rankingOptions = useMemo(() => {
    if (!evaluationImages.length) {
      return ["1"];
    }
    return evaluationImages.map((_, index) => String(index + 1));
  }, [evaluationImages]);

  const progressValue = useMemo(() => {
    const index = steps.findIndex((step) => step.id === activeStep.id);
    if (index === -1) {
      return 0;
    }
    return Math.round((index / (steps.length - 1)) * 100);
  }, [activeStep.id]);

  const renderSummaryLines = useCallback((summary?: string) => {
    if (!summary) {
      return null;
    }
    return summary.split(/\n+/).map((line, index) => (
      <p key={`${line}-${index}`} className="text-sm text-slate-600">
        {line}
      </p>
    ));
  }, []);

  const roleGroups = useMemo(() => {
    return allWorkspaceSummaries.reduce<Record<string, WorkspaceSummaryRecord[]>>(
      (acc, entry) => {
        const normalizedRole = normalizeRoleId(entry.summary.role);
        const roleLabel = normalizedRole ?? entry.summary.role ?? "unassigned";
        if (!acc[roleLabel]) {
          acc[roleLabel] = [];
        }
        acc[roleLabel].push(entry);
        return acc;
      },
      {}
    );
  }, [allWorkspaceSummaries]);

  const roleTabs = useMemo(
    () => [
      { id: "all", label: t("workspace.role.all") },
      { id: "public", label: t("role.public") },
      { id: "business", label: t("role.business") },
      { id: "planners", label: t("role.planners") },
      { id: "government", label: t("role.government") },
    ],
    [t]
  );

  useEffect(() => {
    if (!roleTabs.find((tab) => tab.id === activeReportTab)) {
      setActiveReportTab("all");
    }
  }, [activeReportTab, roleTabs]);

  useEffect(() => {
    if (activeReportTab === "evaluation-report") {
      return;
    }
    const entries = roleGroups[activeReportTab] ?? [];
    const currentIndex = activeUserTabs[activeReportTab] ?? 0;
    if (entries.length && currentIndex >= entries.length) {
      setActiveUserTabs((prev) => ({ ...prev, [activeReportTab]: 0 }));
    }
  }, [activeReportTab, activeUserTabs, roleGroups]);

  const getParticipantRoleLabel = useCallback(
    (image?: DesignImage) => {
      if (!image) {
        return t("workspace.participant");
      }
      if (image.userId && roleByUserId.has(image.userId)) {
        return roleByUserId.get(image.userId) ?? t("workspace.participant");
      }
      return localize(image.submittedBy ?? t("workspace.participant"));
    },
    [roleByUserId, t, localize]
  );

  const buildEvaluationContext = useCallback(() => {
    const summariesText = Object.entries(savedSummaries)
      .map(([stage, summary]) => {
        return `${stage.toUpperCase()} SUMMARY:\n${summary}`;
      })
      .join("\n\n");
  
    const alternativesDialogue = chatLogs
      .filter(
        (log) =>
          log.stepId === "alternatives" &&
          log.sender === "user" &&
          log.text
      )
      .map((log, index) => `- ${log.text}`)
      .join("\n");
  
    const alternativesContext = alternativeImages
      .map((img, index) => {
        return `
  Alternative ${index + 1}:
  Design intention (generation prompt):
  ${img.note}
  `;
      })
      .join("\n\n");
  
    const submittedContext = evaluationImages
      .map((img, index) => {
        return `
  Submitted Design ${index + 1}:
  Label: ${img.label}
  Intent and elements (from prompt/notes):
  ${img.note}
  `;
      })
      .join("\n\n");
    return `
    === WORKSPACE DIALOGUE SUMMARIES ===
    ${summariesText}
    
    === DESIGN ALTERNATIVES EVOLUTION (USER FEEDBACK) ===
    ${alternativesDialogue || "No explicit user feedback recorded."}
    
    === GENERATED DESIGN ALTERNATIVES ===
    ${alternativesContext}

    === SUBMITTED DESIGNS (FOR EVALUATION) ===
    ${submittedContext || "No submitted designs available yet."}
    `;
  },  [savedSummaries, chatLogs, alternativeImages, evaluationImages]);
  

  const requestGeneratedImage = useCallback(
  async (feedback?: string) => {
    const generation = chatGenerationRef.current;
    if (!userKey) {
      throw new Error(t("common.authRequired"));
    }

    const isInitial = alternativeImages.length === 0;
    const response = await fetch("/api/generate-alternative", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user!.getIdToken()}` },
      body: JSON.stringify({
          projectId,
        mode: isInitial ? "initial" : "iteration",
        history: conversationHistory(chatLogsByStep.alternatives ?? [], "alternatives"),
    
        // ✅ initial일 때만 보낸다
        workspaceSummary: isInitial ? savedSummaries : undefined,
        workspaceInput: isInitial ? {
          ...buildImageGenerationInput(),
          recentDiscussion: [buildImageGenerationInput().recentDiscussion, feedback].filter(Boolean).join("\n"),
        } : undefined,
    
        // ✅ iteration일 때는 이것만
        feedback: isInitial ? undefined : feedback,
    
        siteImageId,
        label: `Alternative ${alternativeImages.length + 1}`,
        provider:
          activeProvider.toLowerCase() === "gemini"
            ? "gemini"
            : "openai",
        userID: userKey,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (response.status === 400 && /대상지 이미지|site image/i.test(err.error ?? "")) setShowSiteImageWarning(true);
      throw new Error(err.error ?? t("workspace.imageFailed"));
    }

    const payload = (await response.json()) as {
      imageId: string;
      base64?: string;
      downloadUrl?: string;
      prompt?: string;
    };
    if (generation !== chatGenerationRef.current) throw new Error(t("workspace.imageCancelled"));

    const label = `Alternative ${alternativeImages.length + 1}`;
    const note =
      typeof payload.prompt === "string"
        ? payload.prompt
        : "";

    if (!payload.downloadUrl) throw new Error(t("image.missingUrl"));
    setLastGeneratedImageId(payload.imageId);
    return { id: payload.imageId, label, note, imageUrl: payload.downloadUrl, createdAt: new Date().toISOString() };
  },
  [
    activeProvider,
    t,
    alternativeImages.length,
    buildImageGenerationInput,
    chatLogsByStep,
    savedSummaries,
    siteImageId,
    projectId,
    user,
    userKey,
  ]
);

const sanitizeLogs = (logs: ChatLog[]) =>
  logs.map((log) => ({
    ...log,
    imageUrl: log.imageUrl ?? "",
    imageId: log.imageId ?? "",
    imageLabel: log.imageLabel ?? "",
    imageNote: log.imageNote ?? "",
  }));

const sendingRef = useRef(false);

const recordAnalysisActivity = (input: Omit<AnalysisActivity, "id" | "projectId">) => {
  if (activeStep.id !== "data" || !userKey || !hasLoadedChatLogs || lockedStages.data || completedStages.includes("data") || editingStageId === "data") return;
  const activity = parseAnalysisActivity({ ...input, projectId, id: crypto.randomUUID() }, projectId);
  if (!activity) return;
  const previous = analysisActivities(dataLogsRef.current, projectId).at(-1);
  if (previous && JSON.stringify({ ...previous, id: "" }) === JSON.stringify({ ...activity, id: "" })) return;
  const generation = chatGenerationRef.current;
  const logs = commitDataLogs([{ stepId: "data", provider: activeProvider, sender: "assistant", label: "activity", text: analysisActivityText(activity, locale), createdAt: new Date().toISOString(), activity }]);
  void persistChatLogs("data", logs).catch(() => { if (generation === chatGenerationRef.current) setErrorMessage(t("workspace.chatSaveError")); });
};
const recordCaseView = (id: string) => {
  const item = activeProject?.workspaceContent.data.cases?.find(c => c.id === id);
  if (item) recordAnalysisActivity({ type: "cases", referenceId: item.id, title: item.title || item.label });
};
const recordSpatialResult = (result: SpatialResult | null) => {
  updateSpatialResult(result);
  if (result?.projectId === projectId) recordAnalysisActivity({ type: "spatial", referenceId: result.timestamp, title: localize(spatialGoals.find(goal => goal.type === result.type)?.name ?? analysisLabels.spatial), result });
};

const seenGeoResult = useRef<GeoResult | null>(null);
useEffect(() => {
  const result = geo.result;
  if (!result || seenGeoResult.current === result) return;
  seenGeoResult.current = result;
  if (result.clarify || (!result.places.length && !result.resolvedPlaces?.length && !result.computedResult)) return;
  updateSpatialResult(result.computedResult ?? null);
  recordAnalysisActivity({ type: "spatial", referenceId: crypto.randomUUID(), title: result.question,
    ...(result.computedResult ? { result: result.computedResult } : {}),
    location: { question: result.question, reply: result.reply, ...(result.scopeMeters !== undefined ? { scopeMeters: result.scopeMeters } : {}), places: [...(result.resolvedPlaces ?? []), ...result.places] },
  });
  // Result identity changes only after a query/choice, never on map pan, zoom or tab changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [geo.result]);

const handleSend = async (suggestedQuestion?: string) => {
  const userMessage = (suggestedQuestion ?? inputValue).trim();
  if (!userMessage) return;
  if (!userKey || !hasLoadedChatLogs) return;
  if (lockedStages[activeStep.id] || completedStages.includes(activeStep.id)) return;

  if (sendingRef.current) return;
  if (activeStep.id === "alternatives" && isLoadingAlternatives) {
    setErrorMessage(t("workspace.imageBusy"));
    return;
  }
  if (activeStep.id === "data" && analysisView === "cases" && /여기서|여기에|이\s*사례|그\s*사례|적용할|\b(?:here|this case|apply)\b/i.test(userMessage)) {
    const cases = activeProject?.workspaceContent.data.cases ?? [];
    const current = cases.find(item => item.id === activeTab) ?? cases[0];
    if (current) recordCaseView(current.id);
  }
  sendingRef.current = true;
  followLatestRef.current = true;
  const generation = chatGenerationRef.current;
  const isCurrentConversation = () => generation === chatGenerationRef.current;
  setErrorMessage(null);

  const stepId = activeStep.id;
  const history = conversationHistory((chatLogsByStep[stepId] ?? []).map(log=>stepId==="data"&&geoChat?.time===log.createdAt&&geo.result?.question===geoChat.question?{...log,text:geo.result.reply}:log), stepId);
  const spatialQuestion = stepId === "data" ? spatialConversationQuestion(userMessage,history) : userMessage;
  const sessionQuestion = stepId === "data" ? (clarificationExchange(userMessage,history) ? sourceRoutingQuestion(userMessage,history) : analysisSessionQuestion(userMessage, analysisActivities(dataLogsRef.current, projectId), activeProject?.workspaceContent.data.cases)) : userMessage;
  const placeFollowUp = stepId === "data" && Boolean(((placeResultFollowUp(userMessage)==="search-comparison"&&geo.recentSearches.length)||geo.result?.places.length || analysisActivities(dataLogsRef.current, projectId).at(-1)?.location?.places.length) && !geo.result?.clarify && placeResultFollowUp(userMessage));
  const toolRequest = stepId === "data" ? spatialToolRequest(spatialQuestion,history) : undefined;
  const effectiveSources = resolveSources(placeFollowUp || toolRequest || (spatialQuestion!==userMessage&&isGeoQuestion(spatialQuestion)) ? "공간 분석" : sessionQuestion !== userMessage ? sessionQuestion : sourceRoutingQuestion(userMessage, history), mapPointLabel(userMessage) && (geo.context.point || geo.context.selected) ? [] : selectedSources, activeProject?.workspaceContent.data.cases, sessionQuestion !== userMessage ? [] : history);
  setSendingChatScope(chatScope);
  setIsSending(true);
  setErrorMessage(null);

    const nextUserLogs: ChatLog[] = [
  ...(chatLogsByStep[stepId] ?? []),
  {
    stepId,
    provider: activeProvider,
    sender: "user" as const,
    text: userMessage,
    label: role,
    createdAt: new Date().toISOString(),
    ...(stepId === "data" ? { selectedSources: [...effectiveSources] } : {}),
  },
];

  if (stepId === "data") commitDataLogs(nextUserLogs);
  else setChatLogsByStep((prev) => ({ ...prev, [stepId]: nextUserLogs }));

  setInputValue("");
  setExpandedStarterScope(null);

  try {
    await persistChatLogs(stepId, stepId === "data" ? dataLogsRef.current : nextUserLogs);
    if (!isCurrentConversation()) return;
    if (stepId === "data") {
      if (effectiveSources.includes("spatial") && !effectiveSources.some(source => source === "cases" || source === "research") && !isSpatialToolExplanation(userMessage) && !isSpatialToolCancelled(userMessage) && ((isGeoQuestion(spatialQuestion) && (!clarificationExchange(userMessage,history) || spatialQuestion!==userMessage)) || placeFollowUp || toolRequest)) {
        setAnalysisView("spatial"); setPanelView("information");
        const result = await geo.run(userMessage,undefined,history);
        if (!isCurrentConversation()) return;
        if (result) {
          if(result.computedResult)updateSpatialResult(result.computedResult);
          const createdAt = new Date().toISOString();
          setGeoChat({ time: createdAt, question: userMessage });
          const nextLogs: ChatLog[] = [...nextUserLogs, { stepId, provider: activeProvider, sender: "assistant", text: result.reply, label: activeProvider, createdAt }];
          await persistChatLogs(stepId, sanitizeLogs(commitDataLogs(nextLogs)));
        }
        return;
      }
      setInspectedEvidence(null);
      setInspectedResearchFindings([]);
      setInspectedCaseFindings([]);
      setInspectedSpatial(null);
      setHighlightedEvidence(null);
      const controller = new AbortController();
      analysisAbortRef.current = controller;
      const response = await fetch("/api/research/answer", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user!.getIdToken()}` },
        body: JSON.stringify({
          projectId,
          question: userMessage,
          history,
          spatialSelection:geo.context,
          selectedSources,
          ...(effectiveSources.includes("spatial") && spatialResult?.projectId === projectId ? { spatialContext: spatialResult } : {}),
          provider: activeProvider,
        }),
      });
      const payload = await response.json();
      if (controller.signal.aborted || !isCurrentConversation()) return;
      if (!response.ok) {
        throw new Error(payload.error ?? t("workspace.analysisFailed"));
      }
      const analysis = payload.analysis as AnalysisRecord;
      const nextLogs: ChatLog[] = [...nextUserLogs, {
        stepId, provider: activeProvider, sender: "assistant", text: payload.reply,
        label: activeProvider, createdAt: new Date().toISOString(), analysis,
      }];
      if (activeStep.id === "data") {
        setPanelView("information");
        if (analysis.selectedSources.includes("research")) setAnalysisView("answer");
        else if (analysis.selectedSources.includes("cases") && analysis.evidence.cases.length && analysis.evidence.cases[0].origin !== "external") {
          setActiveTab(analysis.evidence.cases[0].id); setAnalysisView("cases"); recordCaseView(analysis.evidence.cases[0].id);
        } else setAnalysisView("answer");
      }
      await persistChatLogs(stepId, sanitizeLogs(commitDataLogs(nextLogs)));
      return;
    }
    let finalMessage = userMessage;
      if (stepId === "alternatives" && isDesignGenerationRequest(userMessage)) {

      setIsLoadingAlternatives(true);
      try {
        const latestPrompt =
          alternativeImages[alternativeImages.length - 1]?.note;

        const imageRecord = await requestGeneratedImage(userMessage);
        if (!isCurrentConversation()) return;

        if (!imageRecord?.imageUrl) {
          setErrorMessage(t("workspace.imageFailed"));
          return;
        }

          const nextEvaluationLogs: ChatLog[] = [
            ...nextUserLogs,
            {
              stepId,
              provider: activeProvider,
              sender: "assistant" as const,
              text: t("workspace.imageFeedback"),
              label: activeProvider,
              createdAt: new Date().toISOString(),
              imageUrl: imageRecord.imageUrl,
              imageId: imageRecord.id,
              imageLabel: imageRecord.label,
              imageNote: imageRecord.note,
            },
          ];
          setChatLogsByStep((prev) => ({ ...prev, [stepId]: nextEvaluationLogs }));
          await persistChatLogs(stepId, sanitizeLogs(nextEvaluationLogs));
          await saveWorkspaceSummary(userKey, { alternativesInitialized: true }, projectId);

      } finally {
        if (isCurrentConversation()) setIsLoadingAlternatives(false);
      }
      return;
    }
      if (stepId === "evaluation") {
       const evaluationContext = buildEvaluationContext();
       finalMessage = `${evaluationContext}\n\nUser question:\n${userMessage}`;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user!.getIdToken()}` },
        body: JSON.stringify({
          projectId,
          provider: activeProvider,
          model: getChatModelByProvider(activeProvider),
          stepId,
          message: finalMessage,
          history,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? t("workspace.chatFailed"));
      }
      const payload = (await response.json()) as { reply: string };
      if (!isCurrentConversation()) return;
      const reply = payload.reply;
     const baseLogs = [...nextUserLogs];
      const nextAssistantLogs: ChatLog[] = [
       ...baseLogs,
       {
         stepId,
         provider: activeProvider,
         sender: "assistant" as const,
         text: reply,
         label: activeProvider,
         createdAt: new Date().toISOString(),
       },
     ];
    
     setChatLogsByStep((prev) => ({ ...prev, [stepId]: nextAssistantLogs }));
     await persistChatLogs(stepId, nextAssistantLogs);
      } catch (error) {
        if (!isCurrentConversation()) return;
        if (error instanceof Error && error.name === "AbortError") return;
        setErrorMessage(
          error instanceof Error
            ? error.message
            : t("workspace.connectFailed")
        );
      } finally {
        if (isCurrentConversation()) {
          setIsSending(false);
          sendingRef.current = false;
        }
      }
    };

  const handleCompleteStep = async (confirmed = false) => {
    if (isSummarizing || completedStages.includes(activeStep.id)) return;
    if (lockedStages[activeStep.id]) {
      setFinishNotice({
        status: "error",
        message: t("workspace.lockedError"),
      });
    return;
    }
    if (!userKey) {
      setFinishNotice({
        status: "error",
        message: t("common.authRequired"),
        });
      return;
    }
    if (!confirmed && !await confirmCompletion()) return;
    const summaryGeneration=chatGenerationRef.current;
    setIsSummarizing(true);
    setFinishNotice({ status: "uploading", message: t("workspace.finishStage") + "..." });
    
    try {
      const response = await fetch("/api/workspace-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user!.getIdToken()}` },
        body: JSON.stringify({
          projectId,
          currentStage: activeStep.id,
          participantPerspective: normalizedActiveRole ? t(roleLabelKeys[normalizedActiveRole]) : undefined,
          historyByStage:{[activeStep.id]:conversationHistory(chatLogsByStep[activeStep.id]??[],activeStep.id)},
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? t("workspace.summaryFailed"));
      }
      const payload = (await response.json()) as {
        workspaceSummary: {
          stageSummaries: Record<string, string>;
          overallSummary: string;
        };
      };
      if(summaryGeneration!==chatGenerationRef.current)return;
      const generated=(payload.workspaceSummary.stageSummaries?.[activeStep.id]?.trim()??"").slice(0,12000);
      const reviewed=await reviewGeneratedSummary(generated);
      if(!reviewed||summaryGeneration!==chatGenerationRef.current)return;
      const stageSummary=reviewed.text;
      const mergedStageSummaries = {
        ...savedSummaries,
        ...(stageSummary ? { [activeStep.id]: stageSummary } : {}),
      };
      const nextCompletedStages = Array.from(
        new Set([...completedStages, activeStep.id])
      );
      await saveConfirmedStageSummary(userKey,activeStep.id,stageSummary,projectId);
      const previousPublic=await loadWorkspaceSummary(userKey,projectId);
      const shared={...previousPublic?.stageSummaries,[activeStep.id]:stageSummary};
      await saveWorkspaceSummary(userKey, {
        stageSummaries: shared,
        overallSummary: Object.values(shared).join("\n\n"),
        role,
        completedStages: nextCompletedStages,
      }, projectId);
      touchProject(projectId);
      if (stageSummary) {
        setSavedSummaries(mergedStageSummaries);
      }
      setCompletedStages(nextCompletedStages);
      setFinishNotice({ status: "success", message: t("workspace.reportTitle") + " ✓" });
      return true;
    } catch (error) {
      setFinishNotice({
        status: "error",
        message:
           error instanceof Error
            ? `Upload failed: ${error.message}`
            : t("workspace.uploadFailed"),
        });
    } finally {
      setIsSummarizing(false);
      setTimeout(() => {
          setFinishNotice(null);
        }, 3000);
    }
  };
    
  const handleRankingChange = (imageId: string, value: string) => {
    setRankings((prev) => ({
      ...prev,
      [imageId]: Number(value),
    }));
  };
  const selectedImageItem = selectedImage
    ? evaluationImages.find((image) => image.id === selectedImage) ||
      alternativeImages.find((image) => image.id === selectedImage)
    : undefined;

  const handleSubmitAlternative = async () => {
    if (!selectedAlternative) {
      return;
    }
    if (!userKey) {

      return;
    }
    const selected = alternativeImages.find(
      (image) => image.id === selectedAlternative
    );
    if (!selected) {
      return;
    }

    if (!await confirmCompletion()) return;
    setEvaluationImages((prev) => {
      const exists = prev.some((image) => image.id === selected.id);
      if (exists) {
        return prev;
      }
      return [...prev, selected];
    });
    setRankings((prev) => ({
      ...prev,
      [selected.id]: Object.keys(prev).length + 1,
    }));
    await saveUserDesignSubmission(userKey, selected.id, projectId);
    await refreshEvaluationImages();
    setSelectedAlternative(null);
    await handleCompleteStep(true);
  };

  const handleSubmitRankings = async () => {
    if (!userKey) {
      return;
    }
    if (!evaluationImages.length) {
      return;
    }
    if (!await confirmCompletion()) return;
    const payload = {
      submittedAt: new Date().toISOString(),
      rankings,
      userId: userKey,
      role,
    };
    setEvaluationResults((prev) => {
      const updated = [...prev, payload];
      return updated;
    });
    await sendEvaluationResult(payload, projectId);

    await handleCompleteStep(true);
  };

  useEffect(() => {
    followLatestRef.current = true;
    messageScrollRef.current = 0;
  }, [chatScope]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [projectId]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    const resize = new ResizeObserver(() => {
      if (!list.clientHeight) return;
      messageHeightRef.current = list.clientHeight;
      // A keyboard resize follows the latest message only if the reader was already at the end.
      list.scrollTop = followLatestRef.current ? list.scrollHeight : messageScrollRef.current;
    });
    resize.observe(list);
    return () => resize.disconnect();
  }, [activeStep.id, loading, user]);

  useEffect(() => {
    const list = messageListRef.current;
    if (list && list.clientHeight && followLatestRef.current) list.scrollTop = list.scrollHeight;
  }, [chatLogs, activeStep.id, isSending, hasLoadedChatLogs]);

  const aggregatedResults = useMemo(() => {
    if (!evaluationResults.length) {
      return evaluationImages.map((image) => ({
        id: image.id,
        label: image.label,
        average: 0,
        topChoice: 0,
        voteCount: 0,
        submittedBy: image.submittedBy,
      }));
    }
    return evaluationImages.map((image) => {
      const scores = evaluationResults
        .map((result) => result.rankings?.[image.id])
        .filter((value): value is number => typeof value === "number" && value > 0);
      const average = scores.length
        ? scores.reduce((sum, value) => sum + value, 0) / scores.length
        : 0;
      const topChoice = scores.filter((value) => value === 1).length;
      return {
        id: image.id,
        label: image.label,
        average,
        topChoice,
        voteCount: scores.length,
        submittedBy: image.submittedBy,
      };
    });
  }, [evaluationResults, evaluationImages]);

  const topPreference = useMemo(() => {
    const ranked = aggregatedResults.filter((result) => result.voteCount > 0);
    if (!ranked.length) {
      return evaluationImages[0];
    }
    const best = [...ranked].sort((a, b) => {
      if (b.topChoice !== a.topChoice) {
        return b.topChoice - a.topChoice;
      }
      return a.average - b.average;
    })[0];
    return evaluationImages.find((image) => image.id === best.id);
  }, [aggregatedResults, evaluationImages]);

  const topPreferenceRankTotals = useMemo(() => {
    if (!topPreference) {
      return [];
    }
    return rankingOptions.map((rankLabel) => {
      const rank = Number(rankLabel);
      const value = evaluationResults.filter(
        (result) => result.rankings?.[topPreference.id] === rank
      ).length;
      return { rank, value };
    });
  }, [evaluationResults, rankingOptions, topPreference]);

  const pieGradient = useMemo(() => {
    const total = topPreferenceRankTotals.reduce(
      (sum, item) => sum + item.value,
      0
    );
    if (!total) {
      return "conic-gradient(#e2e8f0 0deg 360deg)";
    }
    let current = 0;
    const segments = topPreferenceRankTotals.map((item, index) => {
      const start = current;
      const slice = (item.value / total) * 360;
      current += slice;
      return `${pieColors[index % pieColors.length]} ${start.toFixed(
        2
      )}deg ${current.toFixed(2)}deg`;
    });
    return `conic-gradient(${segments.join(", ")})`;
  }, [topPreferenceRankTotals]);

  const activeRoleEntries = roleGroups[activeReportTab] ?? [];
  const activeUserIndex = activeUserTabs[activeReportTab] ?? 0;
  const activeUserEntry = activeRoleEntries[activeUserIndex];

  const groupedAlternativeImages = useMemo(() => {
    const sorted = [...alternativeImages].sort((a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
    );
    return sorted.map((image, index) => ({
      revisionLabel: `Revision ${index + 1}`,
      images: [image],
    }));
  }, [alternativeImages]);
  const isAlternativesLoading =
    activeStep.id === "alternatives" &&
    !hasLoadedChatLogs &&
    alternativeImages.length === 0;

  useEffect(() => {
    if (activeStep.id !== "alternatives") {
      setLastGeneratedImageId(null);
      return;
    }
    const latest = alternativeImages[alternativeImages.length - 1];
    setLastGeneratedImageId(latest?.id ?? null);
  }, [activeStep.id, alternativeImages]);

  const isSystem = isSystemAdmin(user?.email);
  const canEditContent = canManageProject(user?.email, activeProject);

  type EditableStageId = "problem" | "data";
  const [editingStageId, setEditingStageId] = useState<EditableStageId | null>(null);
  const [problemDraft, setProblemDraft] = useState(() => activeProject?.workspaceContent.problem ?? { title: "", text: "", imageUrl: "" });
  const [dataDraft, setDataDraft] = useState(() => activeProject?.workspaceContent.data ?? { title: "", text: "", imageUrl: "", cases: [] });

  useEffect(() => {
    if (!activeProject) return;
    setProblemDraft(activeProject.workspaceContent.problem);
    setDataDraft(activeProject.workspaceContent.data);
    setEditingStageId(null);
  }, [activeProject?.projectId]);

  const [imageUploading, setImageUploading] = useState(false);
  const [isSavingContent, setIsSavingContent] = useState(false);
  const [contentSaveError, setContentSaveError] = useState("");
  const [contentSaveNotice, setContentSaveNotice] = useState("");
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [pendingDeleteCaseId, setPendingDeleteCaseId] = useState<string | null>(null);
  const caseDeleteDialog = useRef<HTMLDialogElement>(null);
  const problemEditor = useRef<ContentEditorHandle>(null);
  const caseEditor = useRef<ContentEditorHandle>(null);
  const isEditingExplanation = editingStageId !== null;
  const hasUnsavedExplanationChanges = useMemo(() => {
    if (!activeProject || !editingStageId) return false;
    if (editingStageId === "problem") {
      return JSON.stringify(problemDraft) !== JSON.stringify(activeProject.workspaceContent.problem);
    }
    return JSON.stringify(dataDraft) !== JSON.stringify(activeProject.workspaceContent.data);
  }, [activeProject, editingStageId, problemDraft, dataDraft]);

  const confirmDiscardUnsaved = useCallback(() => {
    if (imageUploading || isSavingContent) return false;
    if (!hasUnsavedExplanationChanges) return true;
    return window.confirm(t("workspace.unsavedDiscard"));
  }, [hasUnsavedExplanationChanges, imageUploading, isSavingContent, t]);

  const beginEditStage = useCallback(
    (stageId: EditableStageId) => {
      if (!activeProject || !canEditContent) return;
      if (!confirmDiscardUnsaved()) return;
      setProblemDraft(activeProject.workspaceContent.problem);
      setDataDraft(activeProject.workspaceContent.data);
      setEditingStageId(stageId);
      setEditingCaseId(stageId === "data" ? (activeProject.workspaceContent.data.cases.find((item) => item.id === activeTab) ?? activeProject.workspaceContent.data.cases[0])?.id ?? null : null);
      setContentSaveError(""); setContentSaveNotice("");
    },
    [activeProject, canEditContent, confirmDiscardUnsaved, activeTab]
  );

  const cancelEditStage = useCallback(() => {
    if (!activeProject) return;
    if (!confirmDiscardUnsaved()) return;
    setProblemDraft(activeProject.workspaceContent.problem);
    setDataDraft(activeProject.workspaceContent.data);
    setEditingStageId(null);
    setEditingCaseId(null); setContentSaveError(""); setContentSaveNotice("");
    if (!activeProject.workspaceContent.data.cases.some((item) => item.id === activeTab)) setActiveTab(activeProject.workspaceContent.data.cases[0]?.id ?? "");
  }, [activeProject, confirmDiscardUnsaved, activeTab]);

  const saveEditStage = async () => {
    if (!activeProject || !editingStageId || isSavingContent || imageUploading) return;
    setIsSavingContent(true); setContentSaveError(""); setContentSaveNotice("");
    try {
      const problem = editingStageId === "problem" ? { ...problemDraft, text: problemEditor.current?.getValue() ?? problemDraft.text } : activeProject.workspaceContent.problem;
      const data = editingStageId === "data" ? { ...dataDraft, cases: dataDraft.cases.map((item) => item.id === editingCaseId ? { ...item, text: caseEditor.current?.getValue() ?? item.text } : item) } : activeProject.workspaceContent.data;
      await updateProject(projectId, { workspaceContent: editingStageId === "problem" ? { problem } : { data } });
      setEditingStageId(null); setEditingCaseId(null); setContentSaveNotice(t("common.saved"));
    } catch (error) { setContentSaveError(error instanceof Error ? error.message : t("common.saveFailed")); }
    finally { setIsSavingContent(false); }
  };

  const addCase = () => {
    if (!activeProject || !canEditContent || editingStageId !== "data" || imageUploading || isSavingContent) return;
    const item = { id: `case-${crypto.randomUUID()}`, label: t("cases.new"), title: t("cases.new"), text: "", imageUrl: "" };
    const currentText = caseEditor.current?.getValue();
    setDataDraft((prev) => ({ ...prev, cases: [...prev.cases.map((entry) => entry.id === editingCaseId && currentText !== undefined ? { ...entry, text: currentText } : entry), item] }));
    setEditingStageId("data"); setEditingCaseId(item.id); setActiveTab(item.id);
    setContentSaveError(""); setContentSaveNotice("");
  };
  const deleteCase = (caseId: string) => {
    if (!canEditContent || editingStageId !== "data" || imageUploading || isSavingContent) return;
    const currentText = caseEditor.current?.getValue();
    const cases = dataDraft.cases.filter((item) => item.id !== caseId).map((item) => item.id === editingCaseId && currentText !== undefined ? { ...item, text: currentText } : item);
    setDataDraft((prev) => ({ ...prev, cases }));
    if (editingCaseId === caseId) { setActiveTab(cases[0]?.id ?? ""); setEditingCaseId(cases[0]?.id ?? null); }
    setPendingDeleteCaseId(null); caseDeleteDialog.current?.close();
  };

  const saveDataCaseDraft = useCallback((caseId: string, patch: Record<string, unknown>) => {
    setDataDraft((prev) => ({
      ...prev,
      cases: prev.cases.map((item) => (item.id === caseId ? { ...item, ...patch } : item)),
    }));
  }, []);

  useEffect(() => {
    const onRouteChangeStart = () => {
      if (!isEditingExplanation || !hasUnsavedExplanationChanges) return;
      if (!window.confirm(t("workspace.unsavedLeave"))) {
        router.events.emit("routeChangeError");
        throw "Abort route change. Unsaved explanation changes.";
      }
    };
    router.events.on("routeChangeStart", onRouteChangeStart);
    return () => {
      router.events.off("routeChangeStart", onRouteChangeStart);
    };
  }, [router.events, isEditingExplanation, hasUnsavedExplanationChanges, t]);

  if (loading) {
    return (
      <AppShell>
        <div className="rounded-3xl border border-[var(--border)] bg-white p-6 text-sm text-slate-500">
          {t("workspace.loading")}
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <div className="rounded-3xl border border-[var(--border)] bg-white p-6 text-sm text-slate-500">
          {t("workspace.authRedirect")}
        </div>
      </AppShell>
    );
  }


  const isCurrentStageCompleted = Boolean(lockedStages[activeStep.id]) || completedStages.includes(activeStep.id);
  const completedLabel = locale === "ko" ? "단계 완료됨" : t("workspace.stageCompleted");
  const compactCompletionLabel = locale === "ko" ? isCurrentStageCompleted ? "완료됨" : "완료"
    : locale === "zh" ? isCurrentStageCompleted ? "已完成" : "完成"
    : isCurrentStageCompleted ? "Done" : "Finish";
  const renderStageCompletion = (placement: "header" | "chat" | "report") => (
    <button type="button" data-completed={isCurrentStageCompleted} aria-busy={isSummarizing}
      aria-label={isCurrentStageCompleted ? completedLabel : t("workspace.finishStage")}
      className={`workspace-stage-complete ${placement === "header" ? "workspace-header-complete" : `${placement === "chat" ? "workspace-chat-finish mt-4 lg:mt-4" : "workspace-report-complete mt-6"} rounded-full border border-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary)] hover:bg-blue-50`}`}
      disabled={isSummarizing || isCurrentStageCompleted} onClick={() => { void handleCompleteStep(); }}>
      {isSummarizing ? t("workspace.updating") : placement === "header" ? compactCompletionLabel
        : isCurrentStageCompleted ? completedLabel : t("workspace.finishStage")}
    </button>
  );

  const renderChatPanel = () => {
    const stepLogs = chatLogs.filter((log) => log.stepId === activeStep.id);
    const defaultGuide = stageChatGuide(activeStep.id, locale, normalizedActiveRole);
    const context = analysisView === "cases" ? "cases" : analysisView === "spatial"
      ? spatialCategory === 0 ? "facilities" : spatialCategory !== null || spatialResult || geo.result ? "spatial-result" : "spatial"
      : analysisEvidence?.papers.length ? "research" : analysisEvidence?.cases.length ? "cases" : answerSpatial ? "spatial-result" : "project";
    const guide = activeStep.id === "data" && defaultGuide ? { ...defaultGuide, suggestedQuestions: dataAnalysisStarterPrompts(locale, context) } : defaultGuide;
    const displayedMessages = stepLogs;
    const hasDialogue = stepLogs.some(log => !log.activity);
    const selectStarterPrompt = (prompt: string) => {
      setInputValue(prompt);
      setExpandedStarterScope(null);
      composerInputRef.current?.focus({ preventScroll: true });
    };
    const isStageLocked = Boolean(lockedStages[activeStep.id]) || completedStages.includes(activeStep.id);
    return (
    <div className="workspace-chat relative rounded-3xl border border-[var(--border)] bg-white p-4 shadow-sm xl:p-6">
      <div className="workspace-chat-header flex items-center justify-between">
        <div className="workspace-chat-title">
          <p className="text-xs font-semibold tracking-[0.3em] text-blue-400">
            {providerLabel(activeProvider)}
          </p>
          <h3 className="mt-2 text-lg font-semibold">{activeStep.id === "data" ? analysisLabels.analysisChat : t("workspace.apiConversation")}</h3>
        </div>
        <div className="workspace-chat-controls flex flex-wrap items-center gap-2">
          {canEditContent && (
            <>
              <button
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                type="button"
                onClick={async () => {
                  if (!await handleCompleteStep()) return;
                  const nextLocks = { ...lockedStages, [activeStep.id]: true };
                  setLockedStages(nextLocks);
                  await saveStageLocks({ lockedStages: nextLocks, revisedAfterLock, updatedBy: user.email ?? user.uid }, projectId);
                }}
                disabled={isStageLocked}
              >
                🔒 {t("workspace.lockStage")}
              </button>
              <button
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                type="button"
                onClick={async () => {
                  const nextLocks = {
                    ...lockedStages,
                    [activeStep.id]: false,
                  };
                  const nextRevised = {
                    ...revisedAfterLock,
                    [activeStep.id]: true,
                  };
                  setLockedStages(nextLocks);
                  setRevisedAfterLock(nextRevised);
                  await saveStageLocks({
                    lockedStages: nextLocks,
                    revisedAfterLock: nextRevised,
                    updatedBy: user.email ?? user.uid,
                  }, projectId);
                }}
                disabled={!lockedStages[activeStep.id]}
              >
                🔓 {t("workspace.reopenStage")}
              </button>
            </>
          )}
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[var(--primary)]">
            {providerLabel(activeProvider)}
          </span>
        </div>
      </div>
      {isStageLocked && (
        <div className="workspace-chat-lock mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-700">{t("workspace.stageCompleted")}</p>
          <p className="mt-1">
            🔒 {t("workspace.stageCompletedDesc")}
          </p>
          {savedSummaries[activeStep.id]&&<details className="mt-2"><summary className="cursor-pointer font-semibold">{t("facilitation.mySummary")}</summary><p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-line break-words">{savedSummaries[activeStep.id]}</p></details>}
          {revisedAfterLock[activeStep.id] && (
            <p className="mt-2 text-[11px] text-slate-500">
              {t("workspace.revisedAfterLock")}
            </p>
          )}
        </div>
      )}
      <div ref={messageListRef} className="workspace-chat-messages mt-4 text-sm text-slate-600"
        onScroll={(event) => {
          const list = event.currentTarget;
          if (!list.clientHeight || list.clientHeight !== messageHeightRef.current) return;
          messageScrollRef.current = list.scrollTop;
          followLatestRef.current = list.scrollHeight - list.clientHeight - list.scrollTop < 80;
        }}
        onWheel={(event) => { if (event.deltaY < 0) followLatestRef.current = false; }}>
        {hasLoadedChatLogs && !hasDialogue && guide && (
          <>
            {activeStep.id === "data" && <div className="mb-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-slate-700">
              <h4 className="font-semibold">{guide.title}</h4>
              <p className="mt-2 leading-relaxed">{guide.description}</p>
            </div>}
            <StageChatEmptyState guide={guide} showFullPrompts
              disabled={isSending || isLoadingAlternatives || isStageLocked}
              onSelect={selectStarterPrompt} />
          </>
        )}
        {displayedMessages.map((message, index) => {
          if (activeStep.id === "data" && message.activity) return <div key={message.activity.id} className="mx-auto w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500" data-analysis-activity={message.activity.type}>{analysisActivityText(message.activity, locale)}</div>;
          const isAssistant = message.sender === "assistant";
          return (
            <div
              key={`${activeStep.id}-${index}`}
              className={`max-w-[85%] rounded-2xl border px-4 py-3 ${
                isAssistant
                  ? "border-blue-100 bg-blue-50 text-slate-700"
                  : "border-slate-200 bg-white"
              } ${isAssistant ? "mr-auto" : "ml-auto"}`}
            >
              <p className={`${isAssistant ? "workspace-assistant-label " : ""}text-xs font-semibold text-slate-400`}>
                {normalizeRoleId(message.label) ? t(roleLabelKeys[normalizeRoleId(message.label)!]) : localize(providerLabel(message.label))}
              </p>
              {message.analysis && <AnalysisAnswerView answer={message.analysis.answer} additionalSources={[...(message.analysis.evidence.projectContext ? ["project" as const] : []), ...(message.analysis.spatialContext ? ["spatial" as const] : [])]} onViewEvidence={(sourceId) => {
                setInspectedEvidence(usedAnswerEvidence(message.analysis!));
                const viewedPaper = message.analysis!.evidence.papers.find(paper => paper.sourceId === sourceId);
                if (viewedPaper) recordAnalysisActivity({type:"research",referenceId:viewedPaper.openAlexId,title:viewedPaper.title});
                const viewedCase = message.analysis!.evidence.cases.find(item => item.sourceId === sourceId);
                if (viewedCase) recordCaseView(viewedCase.id);
                setInspectedResearchFindings(message.analysis!.answer.researchFindings);
                setInspectedCaseFindings(message.analysis!.answer.caseFindings);
                setInspectedSpatial(message.analysis!.spatialContext ?? null);
                setAnalysisView("answer");
                setPanelView("information");
                setHighlightedEvidence(sourceId ?? null);
                if (sourceId) window.setTimeout(() => {
                  const target = document.getElementById(`evidence-${sourceId}`);
                  const panel = target?.closest<HTMLElement>(".workspace-information");
                  if (target && panel) panel.scrollTo({ top: panel.scrollTop + target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 12, behavior: "smooth" });
                }, 0);
              }} />}
              {message.text && !message.analysis && (
                <div className="mt-2">
                  <ChatMessageContent text={geoChat?.time === message.createdAt && geo.result?.question === geoChat.question ? geo.result.reply : isAssistant && message.imageUrl ? localize(message.text) : message.text} />
                </div>
              )}
              {message.imageUrl && (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <img
                    src={message.imageUrl}
                    alt={t("workspace.generatedConcept")}
                    className="h-48 w-full object-cover"
                  />
                </div>
              )}
            </div>
          );
        })}
        {isSending && sendingChatScope === chatScope && [...displayedMessages].reverse().find(message => !message.activity)?.sender === "user" && (
          <div role="status" aria-live="polite" aria-atomic="true"
            className="mr-auto flex max-w-[85%] items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-slate-600">
            <span aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600 motion-reduce:animate-none" />
            <span>{activeStep.id === "data" ? analysisLabels.loading : t("workspace.replyLoading")}</span>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      <div className="workspace-chat-footer">
      {hasLoadedChatLogs && guide && <div className="workspace-starter-help mt-2" data-has-dialogue={hasDialogue}>
        <button ref={starterButton} type="button" className="workspace-help-button inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-200 text-slate-600" aria-label={t("workspace.starterPrompts")} title={t("workspace.starterPrompts")} aria-expanded={expandedStarterScope === chatScope} aria-controls="workspace-starter-prompts" disabled={isSending || isLoadingAlternatives || isStageLocked} onClick={() => setExpandedStarterScope(current => current === chatScope ? null : chatScope)}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-.9.7-1.5 1.6-1.5 3.5h-4c0-1.9-.6-2.8-1.5-3.5Z" /></svg>
        </button>
        {expandedStarterScope === chatScope && (starterOverlay && portalReady ? createPortal(
          <div id="workspace-starter-prompts" className="workspace-tablet-help-overlay" style={starterOverlay}><StageChatEmptyState guide={guide} disabled={isSending || isLoadingAlternatives || isStageLocked} onSelect={selectStarterPrompt} /></div>, document.body
        ) : <div id="workspace-starter-prompts" className="workspace-help-popover max-h-36 overflow-y-auto overscroll-contain">
          <StageChatEmptyState guide={guide} disabled={isSending || isLoadingAlternatives || isStageLocked} onSelect={selectStarterPrompt} />
        </div>)}
      </div>}

      <div className="workspace-composer mt-4 bg-white">
        <div className="flex items-center gap-2">
        {activeStep.id === "data" && <SourceSelector selected={selectedSources} onChange={setSelectedSources} disabled={isSending || isStageLocked} />}
        <input ref={composerInputRef}
          className="min-w-0 flex-1 rounded-full border border-slate-200 px-4 py-2 text-base focus:border-[var(--primary)] focus:outline-none disabled:bg-slate-100"
          placeholder={t("workspace.promptPlaceholder")}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSend();
            }
          }}
          disabled={isStageLocked || !hasLoadedChatLogs || (activeStep.id === "data" && isSending)}
          maxLength={activeStep.id === "data" ? 2000 : undefined}
        />
        <button
          className="rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
          type="button"
          onClick={() => { void handleSend(); }}
          disabled={isSending || isStageLocked || isLoadingAlternatives || !hasLoadedChatLogs}
        >
          {isLoadingAlternatives ? `${t("workspace.sending")}…`
          :isSending ? t("workspace.sending") : t("workspace.send")}
        </button>
        </div>
      </div>
      {!hasLoadedChatLogs && !errorMessage && <p role="status" className="mt-3 text-xs text-slate-500">{t("workspace.chatLoading")}</p>}
      {errorMessage && (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-600">
          {localize(errorMessage, "common.requestFailed")}
        </div>
      )}
      {finishNotice && (
        <div
          className={`mt-3 flex items-center gap-2 rounded-2xl border px-4 py-3 text-xs ${
            finishNotice.status === "uploading" || finishNotice.status === "error"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
      {isSummarizing && (
         <div className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-300 border-t-transparent" />
      )}
      {finishNotice.status === "uploading" && (
        <div className="h-3 w-3 animate-spin rounded-full border-2 border-rose-300 border-t-transparent" />
      )}
        {localize(finishNotice.message, "common.requestFailed")}
      </div>
      )}
      {renderStageCompletion("chat")}
      </div>
    </div>
  );
  };

  const stageNavigation = (
    <section className="workspace-stage-nav rounded-3xl border border-[var(--border)] bg-white px-4 py-4 shadow-sm lg:px-6 lg:py-6">
        <div className="workspace-stage-list">
          {steps.map((step, index) => {
            const isActive = step.id === activeStep.id;
            return (
              <button
                key={step.id}
                aria-current={isActive ? "step" : undefined}
                className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-left text-xs font-semibold transition ${
                  isActive
                    ? "bg-[var(--primary)] text-white shadow-md"
                    : "border border-slate-200 bg-slate-50 text-slate-600 hover:border-[var(--primary)]"
                }`}
                type="button"
                onClick={() => {
                  if (imageUploading || isSavingContent || step.id === activeStep.id) return;
                  if (isEditingExplanation && hasUnsavedExplanationChanges) {
                    const ok = window.confirm(t("workspace.unsavedSwitchStage"));
                    if (!ok) return;
                    setProblemDraft(activeProject?.workspaceContent.problem ?? problemDraft);
                    setDataDraft(activeProject?.workspaceContent.data ?? dataDraft);
                    setEditingStageId(null);
                  }
                  setExpandedStarterScope(null);
                  setActiveStep(step);
                  if (step.id === "data") setAnalysisView("cases");
                }}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "border border-slate-200 bg-white text-[var(--primary)]"
                  }`}
                >
                  <span className="workspace-stage-icon">{step.icon}</span><span className="workspace-stage-number">{locale === "ko" ? `${index + 1}단계` : locale === "zh" ? `第${index + 1}步` : `Step ${index + 1}`}</span>
                </span>
                <span className="whitespace-nowrap">{t(step.titleKey)}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-5 h-2 w-full rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-[var(--primary)] transition-all"
            style={{ width: `${progressValue}%` }}
          />
        </div>
      </section>
  );

  return (
    <AppShell workspaceLayout>
      {projectError && !contentSaveError && <p role="alert" className="mb-4 text-sm text-rose-600">{localize(projectError, "common.requestFailed")}</p>}
      <div className="workspace-content" data-header-compact={compactHeader}>
      <section className="workspace-intro flex flex-col gap-2" aria-label={t("workspace.title")}>
        <p className="workspace-intro-badge text-sm font-semibold uppercase tracking-[0.3em] text-blue-300">
          {t("workspace.badge")}
        </p>
        <div className="workspace-intro-heading"><h2 className="text-3xl font-semibold">{t("workspace.title")}<span className="workspace-compact-stage"> · {t(activeStep.titleKey)}</span></h2>
        <button type="button" className="workspace-intro-toggle" aria-expanded={!compactHeader} aria-controls="workspace-intro-details" onClick={() => setCompactHeader(value => !value)}>{t(compactHeader ? "workspace.expandDetails" : "workspace.collapseDetails")} <span aria-hidden="true">{compactHeader ? "⌄" : "⌃"}</span></button></div>
        <div id="workspace-intro-details" className="workspace-intro-details"><div>
        <p className="max-w-3xl text-sm text-slate-500">
          {(normalizedActiveRole ? t(roleDescriptionKeys[normalizedActiveRole]) : undefined) ?? t("workspace.fallback")}
        </p>
        <div className="text-xs font-semibold tracking-[0.3em] text-blue-300">
          {t("workspace.provider")}: {providerLabel(activeProvider)}
        </div>
        </div></div>
      </section>

      <div className="workspace-desktop-navigation">{stageNavigation}</div>

      {activeStep.id === "problem" && (
        <WorkspacePanels navigation={stageNavigation} stageTitle={t(activeStep.titleKey)} completionControl={renderStageCompletion("header")} ratio={panelRatio} onRatioChange={setPanelRatio} view={panelView} onViewChange={setPanelView}>
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="workspace-stage-heading text-lg font-semibold text-slate-900">{t("step.problem")}</h3>
            <p className="workspace-stage-heading mt-1 text-sm text-slate-500">{t("workspace.problemIntro")}</p>
            <div className="mt-4 flex items-start justify-end gap-3">
              {canEditContent && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${editingStageId === "problem" ? "border-[var(--primary)] text-[var(--primary)]" : "border-slate-200"}`}
                    onClick={() => {
                      if (editingStageId === "problem") {
                        cancelEditStage();
                        return;
                      }
                      beginEditStage("problem");
                    }}
                  >
                    {editingStageId === "problem" ? t("workspace.editing") : t("workspace.edit")}
                  </button>
                  {editingStageId === "problem" && (
                    <>
                      <button type="button" className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold" disabled={imageUploading || isSavingContent} onClick={cancelEditStage}>{t("workspace.cancel")}</button>
                      <button type="button" className="rounded-full bg-[var(--primary)] px-3 py-1 text-xs font-semibold text-white" disabled={imageUploading || isSavingContent} onClick={saveEditStage}>{t("workspace.save")}</button>
                    </>
                  )}
                </div>
              )}
            </div>
            {contentSaveError && <p role="alert" className="mt-3 text-sm text-rose-600">{localize(contentSaveError, "common.requestFailed")}</p>}
            {contentSaveNotice && <p role="status" className="mt-3 text-sm text-emerald-700">{localize(contentSaveNotice)}</p>}
            <ProjectImageGallery value={(editingStageId === "problem" ? problemDraft.imageUrl : activeProject?.workspaceContent.problem.imageUrl) ?? ""}
              captions={(editingStageId==='problem'?problemDraft.imageCaptions:activeProject?.workspaceContent.problem.imageCaptions)??[]} onCaptionsChange={imageCaptions=>setProblemDraft(previous=>({...previous,imageCaptions}))}
              editable={canEditContent && editingStageId === "problem" && !isSavingContent} projectId={projectId} onBusyChange={setImageUploading}
              onChange={(imageUrl) => setProblemDraft((prev) => ({ ...prev, imageUrl }))} />
            {editingStageId === "problem" && canEditContent ? <input aria-label={t("editor.projectTitle")} className="mt-4 w-full rounded-lg border p-2 text-lg font-semibold" value={problemDraft.title}
              disabled={isSavingContent} onChange={(event) => setProblemDraft((prev) => ({ ...prev, title: event.target.value }))} />
              : <h4 className="mt-4 whitespace-pre-wrap text-lg font-semibold">{localizeDefaultContent(locale, activeProject?.workspaceContent.problem.title || t("workspace.defaultProjectTitle"))}</h4>}
            {canEditContent && editingStageId === "problem" ? (
              <ContentEditor ref={problemEditor} disabled={isSavingContent} label={t("editor.projectBody")} value={problemDraft.text} onChange={(text) => setProblemDraft((prev) => ({ ...prev, text }))} />
            ) : <ContentText value={localizeDefaultContent(locale, activeProject?.workspaceContent.problem.text || t("workspace.defaultProblemText"))} />}

          </div>
          {renderChatPanel()}
        </WorkspacePanels>
      )}

      {activeStep.id === "data" && (
        <WorkspacePanels navigation={stageNavigation} stageTitle={t(activeStep.titleKey)} completionControl={renderStageCompletion("header")} ratio={panelRatio} onRatioChange={setPanelRatio} view={panelView} onViewChange={setPanelView}>
          <div className="workspace-analysis rounded-3xl border border-[var(--border)] bg-white shadow-sm">
            <div className="workspace-stage-heading border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">{t("boundary.dataTitle")}</h3>
              <p className="mt-1 text-sm text-slate-500">{t("boundary.dataIntro")}</p>


            </div>
            <div role="tablist" aria-label={`${t("cases.heading")} / ${t("workspace.goal.spatial")} / ${analysisLabels.answerEvidence}`} className="workspace-analysis-tabs flex gap-1 border-b border-slate-200 bg-slate-50 p-3">
              {(["cases", "spatial", "answer"] as const).map((view) => <button key={view} type="button" role="tab"
                id={`analysis-${view}-tab`} aria-controls={`analysis-${view}-panel`} aria-selected={analysisView === view}
                tabIndex={analysisView === view ? 0 : -1}
                onClick={() => setAnalysisView(view)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    const views = ["cases", "spatial", "answer"] as const;
                    const next = views[(views.indexOf(view) + (event.key === "ArrowRight" ? 1 : 2)) % views.length];
                    setAnalysisView(next);
                    document.getElementById(`analysis-${next}-tab`)?.focus();
                  }
                }}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${analysisView === view ? "bg-white text-[var(--primary)] shadow-sm" : "text-slate-500 hover:bg-white/60"}`}>
                {view === "cases" ? (locale === "ko" ? "실제 사례" : locale === "zh" ? "实际案例" : "Real cases") : view === "spatial" ? t("workspace.goal.spatial") : analysisLabels.answerEvidence}
              </button>)}
            </div>
            {analysisView === "spatial" && <div role="tabpanel" id="analysis-spatial-panel" aria-labelledby="analysis-spatial-tab">
              <SpatialAnalysis category={spatialCategory} onCategoryChange={(category, layers) => {
                setSpatialCategory(category); updateSpatialResult(null);
                recordAnalysisActivity({ type: "spatial", referenceId: `category-${category}`, title: t(`boundary.category.${category}`), location: { question: t(`boundary.category.${category}`), reply: JSON.stringify({ displayedLayers: layers.map(layer => ({ id: layer.config.id, name: layer.config.label, featureCount: layer.data.features.length })), scope: "Counts cover uploaded datasets, not measured need or facility adequacy." }), places: [] } });
              }} onInspect={selection => { updateSpatialResult(null); recordAnalysisActivity({ type: "spatial", referenceId: selection.layerId && selection.featureId ? `${selection.layerId}/${selection.featureId}` : "map-point", title: selection.name, location: { question: selection.name, reply: "Selected project feature; location only.", ...(selection.scopeMeters !== undefined ? { scopeMeters: selection.scopeMeters } : {}), places: [{ id: selection.layerId && selection.featureId ? `${selection.layerId}/${selection.featureId}` : "map-point", name: selection.name, coordinate: selection.coordinate, ...(selection.layerId && selection.featureId ? {layerId: selection.layerId, featureId: selection.featureId} : {}) }] } }); }} geo={geo} key={`${projectId}-${userKey}`} projectId={projectId} result={spatialResult?.projectId === projectId ? spatialResult : null} onResult={recordSpatialResult} included={selectedSources.includes("spatial")} onInclude={(included) => setSelectedSources((prev) => included ? [...new Set([...prev, "spatial" as const])] : prev.filter((source) => source !== "spatial"))} />
            </div>}
            {analysisView === "answer" && <div role="tabpanel" id="analysis-answer-panel" aria-labelledby="analysis-answer-tab">
              <button type="button" className="ml-6 mt-4 text-xs font-semibold text-blue-700" onClick={() => setAnalysisView("cases")}>{analysisLabels.backCases}</button>
              {answerSpatial && <section className="m-6 space-y-2 rounded-xl border border-blue-100 bg-blue-50/40 p-4 text-sm">
                <h4 className="font-semibold">{t("workspace.spatialEvidence")}</h4>
                <SpatialSummary result={answerSpatial} />
              </section>}
              <EvidencePanel evidence={analysisEvidence} enabled={analysisEvidence?.selectedSources ?? DEFAULT_SOURCES} loading={isSending} highlighted={highlightedEvidence}
                caseFindings={inspectedEvidence ? inspectedCaseFindings : latestAnalysis?.answer.caseFindings ?? []}
                researchFindings={inspectedEvidence ? inspectedResearchFindings : latestAnalysis?.answer.researchFindings ?? []}
                availableCaseIds={(activeProject?.workspaceContent.data.cases ?? []).map((item) => item.id)}
                onViewCase={(caseId) => { setActiveTab(caseId); setAnalysisView("cases"); recordCaseView(caseId); }}
                onViewPaper={(paper) => recordAnalysisActivity({ type: "research", referenceId: paper.openAlexId, title: paper.title })}
                onViewProject={() => recordAnalysisActivity({ type: "project", referenceId: "project-material", title: analysisLabels.project })} />
            </div>}
            <div role="tabpanel" id="analysis-cases-panel" aria-labelledby="analysis-cases-tab" hidden={analysisView !== "cases"}>
            <div className="border-b border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {(editingStageId === "data" ? dataDraft.cases : activeProject?.workspaceContent.data.cases ?? []).map((tab) => (
                  <div key={tab.id} className="flex min-w-0 items-center gap-1">
                    <button type="button" disabled={isSavingContent || imageUploading} className={`max-w-full rounded-full px-4 py-2 text-xs font-semibold ${activeTab === tab.id ? "bg-[var(--primary)] text-white" : "border bg-white text-slate-600"}`}
                      onClick={() => {
                        if (editingStageId !== "data") recordCaseView(tab.id);
                        if (activeTab === tab.id) return;
                        if (editingStageId === "data") {
                          const text = caseEditor.current?.getValue();
                          if (editingCaseId && text !== undefined) saveDataCaseDraft(editingCaseId, { text });
                          setEditingCaseId(tab.id);
                        }
                        setActiveTab(tab.id);
                      }}>{tab.label || tab.title}</button>
                    {canEditContent && editingStageId === "data" && <button type="button" aria-label={t("cases.deleteNamed", { name: tab.label || tab.title })} title={t("cases.deleteTitle")} disabled={isSavingContent || imageUploading}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => { setPendingDeleteCaseId(tab.id); caseDeleteDialog.current?.showModal(); }}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>
                    </button>}
                  </div>
                ))}
                {canEditContent && editingStageId === "data" && <button type="button" aria-label={t("cases.add")} className="min-h-11 rounded-full border border-blue-200 px-4 text-sm font-semibold text-blue-700" disabled={isSavingContent || imageUploading} onClick={addCase}>{t("cases.addButton")}</button>}
                {canEditContent && <div className="ml-auto flex items-center gap-2">
                  <button type="button" className={`rounded-full border px-3 py-1 text-xs font-semibold ${editingStageId === "data" ? "border-[var(--primary)] text-[var(--primary)]" : "border-slate-200"}`} disabled={imageUploading || isSavingContent} onClick={() => editingStageId === "data" ? cancelEditStage() : beginEditStage("data")}>{t(editingStageId === "data" ? "workspace.editing" : "workspace.edit")}</button>
                  {editingStageId === "data" && <>
                    <button type="button" className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold" disabled={imageUploading || isSavingContent} onClick={cancelEditStage}>{t("workspace.cancel")}</button>
                    <button type="button" className="rounded-full bg-[var(--primary)] px-3 py-1 text-xs font-semibold text-white" disabled={imageUploading || isSavingContent} onClick={() => { void saveEditStage(); }}>{t(isSavingContent ? "common.saving" : "workspace.save")}</button>
                  </>}
                </div>}
              </div>
              {activeProject?.workspaceContent.data.text && <ContentText value={localizeDefaultContent(locale, activeProject.workspaceContent.data.text)} />}
            </div>
            <div className="p-4">
              {contentSaveError && <p role="alert" className="mb-3 text-sm text-rose-600">{localize(contentSaveError, "common.requestFailed")}</p>}
              {contentSaveNotice && <p role="status" className="mb-3 text-sm text-emerald-700">{localize(contentSaveNotice)}</p>}
                  <div className="space-y-2 text-sm text-slate-600">
                  {(() => {
                    const cases = editingStageId === "data" ? dataDraft.cases : activeProject?.workspaceContent.data.cases;
                    const activeCase = cases?.find((item) => item.id === activeTab) ?? cases?.[0];
                    if (!activeCase) {
                      return <p className="text-sm text-slate-500">{t("workspace.noCaseStudyContent")}</p>;
                    }
                    return (
                      <>
                        {canEditContent && editingStageId === "data" && editingCaseId === activeCase.id
                          ? <input aria-label={t("cases.title")} className="w-full rounded-lg border p-2 text-base font-semibold" disabled={isSavingContent} value={activeCase.title} onChange={(event) => saveDataCaseDraft(activeCase.id, { title: event.target.value, label: event.target.value })} />
                          : <h4 className="whitespace-pre-wrap text-base font-semibold text-slate-800">{localizeDefaultContent(locale, activeCase.title)}</h4>}
                        <ProjectImageGallery key={`${projectId}:case-gallery:${activeCase.id}`} purpose="case" projectId={projectId} value={activeCase.imageUrl}
                          captions={activeCase.imageCaptions??[]} onCaptionsChange={imageCaptions=>saveDataCaseDraft(activeCase.id,{imageCaptions})}
                          editable={canEditContent && editingStageId === "data" && editingCaseId === activeCase.id && !isSavingContent} onBusyChange={setImageUploading}
                          onChange={(imageUrl) => saveDataCaseDraft(activeCase.id, { imageUrl })} />
                        {canEditContent && editingStageId === "data" && editingCaseId === activeCase.id
                          ? <ContentEditor key={`${projectId}:case-editor:${activeCase.id}`} ref={caseEditor} disabled={isSavingContent} label={t("cases.body")} value={activeCase.text} onChange={(text) => saveDataCaseDraft(activeCase.id, { text })} />
                          : <ContentText value={localizeDefaultContent(locale, activeCase.text)} />}
                        {canEditContent && editingStageId === 'data' && editingCaseId === activeCase.id && <>
                          <label className="mt-4 grid gap-1 text-sm">{t('caseSource.aliases')}<input key={activeCase.id} className="min-h-11 rounded-lg border p-2" defaultValue={(activeCase.aliases??[]).join(', ')} disabled={isSavingContent} onBlur={event=>saveDataCaseDraft(activeCase.id,{aliases:event.target.value.split(',').map(value=>value.trim()).filter(Boolean).slice(0,20)})}/></label>
                          <CaseSourceManager key={activeCase.id} projectId={projectId} caseId={activeCase.id} persisted={!!activeProject?.workspaceContent.data.cases.some(item=>item.id===activeCase.id)}/>
                        </>}
                      </>
                    );
                  })()}
                  </div>
            </div>
            </div>
          </div>
          {renderChatPanel()}
        </WorkspacePanels>
      )}

      {activeStep.id === "alternatives" && (
        <WorkspacePanels navigation={stageNavigation} stageTitle={t(activeStep.titleKey)} completionControl={renderStageCompletion("header")} ratio={panelRatio} onRatioChange={setPanelRatio} view={panelView} onViewChange={setPanelView}>
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="workspace-stage-heading text-lg font-semibold">{t("workspace.imageGallery")}</h3>
            <p className="workspace-stage-heading mt-2 text-sm text-slate-500">
              {t("workspace.imageGalleryDesc")}
            </p>
            <div className="mt-5 max-h-[70vh] overflow-y-auto pr-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                {t("workspace.imageGalleryHelp")}
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {groupedAlternativeImages.map((group) =>
                  group.images.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded-2xl border p-4 ${
                        selectedAlternative === item.id
                          ? "border-[var(--primary)] bg-blue-50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <button
                        className="h-44 w-full overflow-hidden rounded-xl bg-gradient-to-br from-blue-100 via-white to-slate-100"
                        type="button"
                        onClick={() => {
                          setSelectedImage(item.id);
                          setSelectedAlternative(item.id);
                        }}
                      >
                        {item.imageUrl && (
                          <img
                            src={item.imageUrl}
                            alt={localize(item.label)}
                            className="h-full w-full object-contain"
                          />
                        )}
                      </button>
                    </div>
                  ))
                )}
              </div>

              {isLoadingAlternatives && (
                <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50/30 p-4">
                  <div className="flex h-44 w-full animate-pulse flex-col items-center justify-center rounded-xl border-2 border-dashed border-blue-300 bg-white/50 text-blue-600">
                    <div className="mb-3 h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
                    <span className="text-sm font-bold">
                      {groupedAlternativeImages.length === 0
                        ? `${t("workspace.send")}...`
                        : `${t("workspace.updating")}...`}
                    </span>
                    <span className="mt-1 text-xs opacity-70">{t("workspace.sending")}</span>
                  </div>
                </div>
              )}

              {groupedAlternativeImages.length === 0 &&
                !isLoadingAlternatives && (
                  <div className="flex flex-col items-center justify-center gap-3 py-6">
                    <span className="text-center text-sm text-slate-500">
                      {t("workspace.generatedImagesHint")}
                    </span>
                  </div>
                )}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                className="rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
                type="button"
                onClick={handleSubmitAlternative}
                disabled={!selectedAlternative}
              >
                {t("workspace.submitDesign")}
              </button>
              <p className="text-xs text-slate-500">
                {t("workspace.submitDesignHint")}
              </p>
            </div>
          </div>
          {renderChatPanel()}
        </WorkspacePanels>
      )}

      {activeStep.id === "evaluation" && (
        <WorkspacePanels navigation={stageNavigation} stageTitle={t(activeStep.titleKey)} completionControl={renderStageCompletion("header")} ratio={panelRatio} onRatioChange={setPanelRatio} view={panelView} onViewChange={setPanelView}>
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="workspace-stage-heading text-lg font-semibold">{t("step.evaluation")}</h3>
            <p className="workspace-stage-heading mt-2 text-sm text-slate-500">
              {activeProject?.workspaceContent.evaluation.text || t("workspace.evaluationIntro")}
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {isLoadingEvaluationImages && (
                <div className="col-span-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  {t("workspace.loadingSubmitted")}
                </div>
              )}
              {!isLoadingEvaluationImages && evaluationImages.length === 0 && (
                <div className="col-span-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  {t("workspace.noSubmitted")}
                </div>
              )}
              {evaluationImages.map((image) => (
                <div
                  key={image.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                >
                  <button
                    className="h-28 w-full overflow-hidden rounded-xl bg-gradient-to-br from-blue-100 via-white to-slate-100"
                    type="button"
                    onClick={() => setSelectedImage(image.id)}
                  >
                    {image.imageUrl && (
                      <img
                        src={image.imageUrl}
                        alt={localize(image.label)}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </button>
                  <div className="mt-3 space-y-2 text-xs text-slate-500">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700">
                        {localize(image.label)}
                      </span>
                      <div className="flex items-center gap-2">
                        <span>{t("workspace.rank")}</span>
                        <select
                          className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs"
                          value={String(rankings[image.id] ?? 1)}
                          onChange={(event) =>
                            handleRankingChange(image.id, event.target.value)
                          }
                        >
                          {rankingOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {image.submittedBy && (
                      <p className="text-[11px] text-slate-400">
                        {localize(image.submittedBy)}
                      </p>
                    )}
                    {image.note && (
                      <p className="line-clamp-3 text-[11px] text-slate-500">
                        {image.note}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              className="mt-6 rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
              type="button"
              onClick={handleSubmitRankings}
              disabled={!evaluationImages.length || isSummarizing}
            >
              {t("workspace.submitRanking")}
            </button>
          </div>
          {renderChatPanel()}
        </WorkspacePanels>
      )}

      {activeStep.id === "report" && (
        <WorkspacePanels navigation={stageNavigation} stageTitle={t(activeStep.titleKey)} completionControl={renderStageCompletion("header")} ratio={panelRatio} onRatioChange={setPanelRatio} view={panelView} onViewChange={setPanelView}>
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="workspace-stage-heading text-lg font-semibold">{t("workspace.reportTitle")}</h3>
            <p className="workspace-stage-heading mt-2 text-sm text-slate-500">
              {activeProject?.workspaceContent.report.text || t("workspace.reportIntro")}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {roleTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveReportTab(tab.id)}
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                    activeReportTab === tab.id
                      ? "bg-[var(--primary)] text-white"
                      : "border border-slate-200 bg-white text-slate-500 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {roleIcons[tab.id === "all" ? "All" : tab.id]}
                    {tab.label}
                  </span>
                </button>
              ))}
            </div>
            {activeReportTab === "all" ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    {t("report.keywords")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(executiveSummary?.keywords ?? []).length > 0 ? (
                      executiveSummary?.keywords.map((keyword) => (
                        <span
                          key={keyword}
                          className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600"
                        >
                          {keyword}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400">
                        {t("report.keywords.empty")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    {t("report.tab.executive")}
                  </p>
                  <div className="mt-3 space-y-2">
                    {executiveSummary?.stageSummaries.decision
                      ? renderSummaryLines(
                          executiveSummary.stageSummaries.decision
                        )
                      : t("workspace.executiveDecisionHint")}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {activeRoleEntries.map((entry, index) => (
                    <button
                      key={entry.userId}
                      type="button"
                      onClick={() =>
                        setActiveUserTabs((prev) => ({
                          ...prev,
                          [activeReportTab]: index,
                        }))
                      }
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        (activeUserTabs[activeReportTab] ?? 0) === index
                          ? "bg-blue-100 text-blue-700"
                          : "border border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-600"
                      }`}
                    >
                      {t("workspace.user")} {index + 1}
                    </button>
                  ))}
                </div>
                {activeRoleEntries.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    {t("workspace.noRoleSummary")}
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase text-slate-400">
                        {t("workspace.overallSummary")}
                      </p>
                      <div className="mt-3 space-y-2">
                        {activeUserEntry?.summary.overallSummary
                          ? renderSummaryLines(
                              activeUserEntry.summary.overallSummary
                            )
                          : t("workspace.noOverallSummary")}
                      </div>
                    </div>
                    <div className="grid gap-4">
                      {steps.map((step) => (
                        <div
                          key={step.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                        >
                          <p className="text-sm font-semibold text-slate-700">
                            {t(step.titleKey)}
                          </p>
                          <div className="mt-2 space-y-2 text-sm text-slate-600">
                            {activeUserEntry?.summary.stageSummaries?.[
                              step.id
                            ]
                              ? renderSummaryLines(
                                  activeUserEntry.summary.stageSummaries[
                                    step.id
                                  ]
                                )
                              : t("workspace.finishToGenerate")}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {renderStageCompletion("report")}
          </div>
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold">{t("workspace.evidenceTitle")}</h3>
            <p className="mt-2 text-sm text-slate-500">
              {t("workspace.evidenceIntro")}
            </p>
            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase text-slate-400">
                  {t("workspace.topPreference")}
                </p>
                <div className="mt-3 h-56 overflow-hidden rounded-xl bg-gradient-to-br from-blue-100 via-white to-slate-100">
                  {topPreference?.imageUrl && (
                    <img
                      src={topPreference.imageUrl}
                      alt={localize(topPreference.label)}
                      className="h-full w-full object-contain"
                    />
                  )}
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-700">
                  {localize(topPreference?.label ?? t("workspace.topConcept"))}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {localize(topPreference?.label ?? t("workspace.design"))} ·{" "}
                  {getParticipantRoleLabel(topPreference)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {t("workspace.highestRated")}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase text-slate-400">
                  {t("workspace.topChoiceShare")}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <div
                    className="h-32 w-32 rounded-full border border-slate-200"
                    style={{ background: pieGradient }}
                  />
                  <div className="space-y-2 text-xs text-slate-600">
                  {topPreferenceRankTotals.map((item, index) => (
                    <div key={item.rank} className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor:
                            pieColors[index % pieColors.length],
                        }}
                      />
                        <span className="font-semibold text-slate-700">
                          {t("workspace.rank")} {item.rank}
                        </span>
                        <span className="ml-auto text-slate-500">
                          {item.value} {t("workspace.votes")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-xs font-semibold uppercase text-slate-400">
                  {t("workspace.rankingOverview")}
                </p>
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-3 text-[11px] font-semibold uppercase text-slate-400">
                    <span>{t("workspace.alternative")}</span>
                    <span>{t("workspace.participantRole")}</span>
                    <span>{t("workspace.averageRank")}</span>
                    <span>{t("workspace.votes")}</span>
                  </div>
                  {aggregatedResults.map((result) => (
                    <div key={result.id} className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <div className="relative group font-semibold text-slate-700">
                          <span className="cursor-default">
                            {localize(result.label)}{" "}
                            <span className="text-[11px] font-normal text-slate-400">
                              {getParticipantRoleLabel(
                                evaluationImages.find(
                                  (image) => image.id === result.id
                                )
                              )}
                            </span>
                          </span>
                          {evaluationImages.find(
                            (image) => image.id === result.id
                          )?.imageUrl && (
                            <div className="workspace-hover-preview pointer-events-none absolute left-0 top-full z-10 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg opacity-0 transition-opacity duration-200">
                              <img
                                src={
                                  evaluationImages.find(
                                    (image) => image.id === result.id
                                  )?.imageUrl
                                }
                                alt={t("home.preview", { project: localize(result.label) })}
                                className="h-40 w-full rounded-lg object-cover"
                              />
                            </div>
                          )}
                        </div>
                        <span>
                          {t("workspace.avgRank")}{" "}
                          {result.average > 0
                            ? result.average.toFixed(1)
                            : "N/A"}{" "}
                          {t("workspace.topChoice")}{result.topChoice}
                        </span>
                        <span>{result.voteCount}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-[var(--primary)]"
                          style={{
                            width: `${Math.max(
                              10,
                              100 -
                                (result.average /
                                  Math.max(1, evaluationImages.length)) *
                                  100
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="h-full min-w-0">{renderChatPanel()}</div>
        </WorkspacePanels>
      )}
      </div>
      <dialog ref={caseDeleteDialog} aria-labelledby="case-delete-title" aria-describedby="case-delete-description" onCancel={() => setPendingDeleteCaseId(null)} className="m-auto w-[calc(100%_-_32px)] max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-900/40">
        <h3 id="case-delete-title" className="text-lg font-semibold">{t("cases.deleteConfirm")}</h3>
        <p id="case-delete-description" className="mt-2 text-sm text-slate-600">{t("cases.deleteWarning")}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="min-h-11 rounded-full border px-4" onClick={() => { setPendingDeleteCaseId(null); caseDeleteDialog.current?.close(); }}>{t("workspace.cancel")}</button>
          <button type="button" className="min-h-11 rounded-full bg-rose-600 px-4 text-white" onClick={() => { if (pendingDeleteCaseId) deleteCase(pendingDeleteCaseId); }}>{t("common.delete")}</button>
        </div>
      </dialog>
      {portalReady && createPortal(
<dialog ref={completionDialog} aria-labelledby="completion-title" aria-describedby="completion-description"
        className="workspace-completion-dialog w-[calc(100%_-_32px)] max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-900/40"
        onCancel={(event) => { event.preventDefault(); closeCompletion(false); }}>
        <h3 id="completion-title" className="text-lg font-semibold">{t("workspace.completeTitle")}</h3>
        <p id="completion-description" className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{t("workspace.completeBody")}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="min-h-11 rounded-full border px-5 py-2 text-sm" onClick={() => closeCompletion(false)}>{t("workspace.cancel")}</button>
          <button type="button" className="min-h-11 rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-white" onClick={() => closeCompletion(true)}>{t("workspace.finishStage")}</button>
        </div>
      </dialog>, document.body)}
      <dialog ref={summaryDialog} aria-labelledby="summary-review-title" className="m-auto w-[calc(100%_-_32px)] max-w-xl rounded-3xl border border-slate-200 bg-white p-5 shadow-xl backdrop:bg-slate-900/40" onCancel={event=>{event.preventDefault();closeSummaryReview(false);}}>
        <h3 id="summary-review-title" className="text-lg font-semibold">{t("facilitation.reviewTitle")}</h3>
        <p className="mt-2 text-sm text-slate-600">{t("facilitation.reviewHint")}</p>
        <textarea aria-label={t("facilitation.summary")} value={summaryDraft} onChange={event=>setSummaryDraft(event.target.value)} maxLength={12000} className="mt-3 h-[min(45dvh,360px)] min-h-36 w-full rounded-xl border p-3 text-sm"/>
        <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" className="min-h-11 rounded-full border px-4" onClick={()=>closeSummaryReview(false)}>{t("workspace.cancel")}</button><button type="button" className="min-h-11 rounded-full bg-[var(--primary)] px-4 text-white disabled:opacity-50" disabled={!summaryDraft.trim()} onClick={()=>closeSummaryReview(true)}>{t("facilitation.confirmSummary")}</button></div>
      </dialog>
      {selectedImage && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/70 px-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-white px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-400">
                  {t("workspace.designPreview")}</p>
                <h3 className="mt-2 text-xl font-semibold">
                  {localize(selectedImageItem?.label ?? t("workspace.designConcept"))}
                </h3>
              </div>
              <button
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 hover:border-slate-300"
                type="button"
                onClick={() => setSelectedImage(null)}
              >
                {t("common.close")}</button>
            </div>
      
            <div className="max-h-[calc(90vh-96px)] overflow-y-auto px-6 py-6">
              {selectedImageItem?.imageUrl ? (
                <img
                  src={selectedImageItem.imageUrl}
                  alt={t("workspace.selectedConcept")}
                  className="max-h-[60vh] w-full rounded-2xl bg-slate-50 object-contain"
                />
              ) : (
                <div className="h-80 rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-100 via-white to-slate-100" />
              )}
      
              {selectedImageItem?.note && (
                <p className="mt-4 whitespace-pre-wrap text-sm text-slate-500">
                  {selectedImageItem.note}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {showSiteImageWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">
              {t("workspace.siteMissing")}</h3>
            <p className="mt-3 text-sm text-slate-500">
              {t("workspace.siteDisabled")}</p>
            <button
              className="mt-6 w-full rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
              type="button"
              onClick={() => setShowSiteImageWarning(false)}
            >
              {t("common.close")}</button>
          </div>
        </div>
      )}
     
    </AppShell>
  );
}
