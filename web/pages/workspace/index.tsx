import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import {
  loadChatLogsFromFirestore,
  loadCurrentSiteImage,
  loadStageLocks,
  loadWorkspaceSummary,
  saveGeneratedImageFromBase64,
  saveChatLogsToFirestore,
  saveUserDesignSubmission,
  saveWorkspaceSummary,
  sendEvaluationResult,
  loadEvaluationResults,
  loadEvaluationImages,
  saveStageLocks,
  loadLatestExecutiveSummariesByStage,
  loadAllWorkspaceSummaries,
} from "../../lib/firebase";
import { useAuth } from "../../lib/auth";
import { useRouter } from "next/router";
import { loadGeneratedImages } from "../../lib/firebase";
import type { SiteImage } from "../../lib/firebase";

const getChatModelByProvider = (provider: string) => {
  if (provider.toLowerCase() === "gemini") {
    return "gemini-1.5-flash";
  }
  if (provider.toLowerCase() === "deepseek") {
    return "deepseek-chat";
  }
  return "gpt-5-mini"; // openai default
};


const steps = [
  {
    id: "problem",
    title: "Problem Definition",
    icon: "1",
  },
  {
    id: "data",
    title: "Data Analysis",
    icon: "2",
  },
  {
    id: "alternatives",
    title: "Design/Plan Alternatives",
    icon: "3",
  },
  {
    id: "evaluation",
    title: "Design/Plan Evaluation",
    icon: "4",
  },
  {
    id: "report",
    title: "Design/Plan Decision",
    icon: "5",
  },
];

const stepSummaries: Record<string, string> = {
  problem:
    "Defined scope, machining constraints, and primary safety risks before planning.",
  data: "Reviewed historical quality metrics, cycle data, and resource inputs.",
  alternatives:
    "Compared alternative process plans with tooling and fixturing adjustments.",
  evaluation:
    "Validated evidence images and confirmed risk mitigation actions.",
  report:
    "Prepared final decision report and supporting evidence for approval.",
};

const providerStorageKey = "ppss-active-provider";
const adminEmail = "test@snu.ac.kr";
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

const roleDescriptions: Record<string, string> = {
  "The Public":
    "Focus on community impact and public-facing outcomes during each stage.",
  "Business Owners":
    "Track feasibility, operational impact, and process readiness metrics.",
  Planners: "Refine PPSS sequences, validate risks, and iterate promptly.",
  Government:
    "Review compliance, safety, and policy alignment across all steps.",
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
  "The Public": (
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
  "Business Owners": (
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
  Planners: (
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
  Government: (
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

const basePromptsByStep: Record<string, string> = {
  data: "Respond using the three case studies: 789 Art Zone, Gyeungui Line Forest Park, and Highline Park.",
  alternatives:
    "",
  evaluation:
    "Help reviewers understand the intent behind each submitted design and summarize key differences.",
  report:
    "From your perspective, what is the most important issue in this project?",
};

export default function Workspace() {
  const [currentSiteImage, setCurrentSiteImage] =
  useState<SiteImage | null>(null);
  const router = useRouter();
  const { user, loading } = useAuth();
  const userKey = user?.uid;
  const [activeStep, setActiveStep] = useState(steps[0]);
  const [activeTab, setActiveTab] = useState("patterns");
  const [inputValue, setInputValue] = useState("");
  const [role, setRole] = useState("Guest");
  const [activeProvider, setActiveProvider] = useState("ChatGPT");
  const [isSending, setIsSending] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedAlternative, setSelectedAlternative] = useState<string | null>(
    null
  );
  const [showSiteImageWarning, setShowSiteImageWarning] = useState(false);
  type FinishNotice = { status: "uploading" | "success" | "error"; message: string };
  const [finishNotice, setFinishNotice] = useState<FinishNotice | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isLoadingAlternatives, setIsLoadingAlternatives] = useState(false);
  const [hasInitializedAlternatives, setHasInitializedAlternatives] = useState(false);
  const [alternativesInitialized, setAlternativesInitialized] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [generatedImages, setGeneratedImages] = useState<DesignImage[]>([]);
  const [siteImageConfigured, setSiteImageConfigured] = useState(false);
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
  const [chatLogs, setChatLogs] = useState<ChatLog[]>([]);
  const [hasLoadedChatLogs, setHasLoadedChatLogs] = useState(false);
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
        map.set(result.userId, result.role);
      }
    });
    return map;
  }, [evaluationResults]);

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
    const loadSavedSummaries = async () => {
      const summary = await loadWorkspaceSummary(userKey);
      if (summary?.stageSummaries) {
        setSavedSummaries(summary.stageSummaries);
      }
      setCompletedStages(summary?.completedStages ?? []);
      setAlternativesInitialized(
        Boolean((summary as any)?.alternativesInitialized)
        );
    };
    loadSavedSummaries();
  }, [userKey]);

  useEffect(() => {
  if (completedStages.includes("alternatives")) {
      setHasInitializedAlternatives(true);
    }
  }, [completedStages]);

  useEffect(() => {
    if (!userKey) {
      return;
    }
    const loadEvaluations = async () => {
      const results = await loadEvaluationResults();
      if (results.length) {
        setEvaluationResults(results);
      }
    };
    loadEvaluations();
  }, [userKey]);

  useEffect(() => {
    if (!userKey) {
      return;
    }
    const loadExecutiveSummary = async () => {
      const summary = await loadLatestExecutiveSummariesByStage();
      if (summary) {
        setExecutiveSummary(summary);
      }
    };
    loadExecutiveSummary();
  }, [userKey]);

  useEffect(() => {
    if (!userKey) {
      return;
    }
    const loadSummaries = async () => {
      const summaries = await loadAllWorkspaceSummaries();
      setAllWorkspaceSummaries(summaries);
    };
    loadSummaries();
  }, [userKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedRole = window.localStorage.getItem("ppss-role");
    if (storedRole) {
      setRole(storedRole);
    }
    const storedProvider = window.localStorage.getItem(providerStorageKey);
    if (storedProvider) {
      setActiveProvider(storedProvider);
    }
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      return;
    }
    const loadLogs = async () => {
      setHasLoadedChatLogs(false);
      const storedLogs = await loadChatLogsFromFirestore<
        Array<Partial<ChatLog> & { sender?: "Planner" | "ChatGPT" | "user" | "assistant" }>
      >(user.uid);
      if (!storedLogs) {
        setHasLoadedChatLogs(true);
        return;
      }
      const normalized = storedLogs
        .map((log, index) => {
          const sender = normalizeSender(log.sender);

          if (!sender || !log.stepId || !log.provider) {
            return null;
          }
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
            stepId: log.stepId,
            provider: log.provider,
            sender,
            text,
            label,
            createdAt,
            imageUrl,
            imageId,
            imageLabel,
            imageNote,
          } as ChatLog;
        })
        .filter((log): log is ChatLog => Boolean(log))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setChatLogs(normalized);
      setHasLoadedChatLogs(true);
    };
    loadLogs();
  }, [user?.uid]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const loadLocks = async () => {
      const state = await loadStageLocks();
      if (!state) {
        setLockedStages({});
        setRevisedAfterLock({});
        return;
      }
      setLockedStages(state.lockedStages ?? {});
      setRevisedAfterLock(state.revisedAfterLock ?? {});
    };
    loadLocks();
  }, [user]);

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
      const submissions = await loadEvaluationImages();
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
  }, []);

  useEffect(() => {
    if (!userKey) {
      return;
    }
    refreshEvaluationImages();
  }, [refreshEvaluationImages, userKey]);
  
  useEffect(() => {
    const loadSiteImage = async () => {
      const current = await loadCurrentSiteImage();
      if (current?.imageId) {
        setSiteImageConfigured(true);
        setSiteImageId(current.imageId);
        setCurrentSiteImage(current);
      } else {
        setSiteImageConfigured(false);
        setSiteImageId(null);
      }
    };
    loadSiteImage();
  }, []);

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
        const roleLabel = entry.summary.role ?? "Unassigned";
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
      { id: "all", label: "All" },
      { id: "The Public", label: "The Public" },
      { id: "Business Owners", label: "Business" },
      { id: "Planners", label: "Planners" },
      { id: "Government", label: "Government" },
    ],
    []
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
        return "Participant";
      }
      if (image.userId && roleByUserId.has(image.userId)) {
        return roleByUserId.get(image.userId) ?? "Participant";
      }
      return image.submittedBy ?? "Participant";
    },
    [roleByUserId]
  );

  const buildWorkspaceInput = useCallback(() => {
    return steps.reduce<Record<string, string[]>>((acc, step) => {
      acc[step.id] = chatLogs
        .filter((log) => log.stepId === step.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((log) => log.text);
      return acc;
    }, {});
  }, [chatLogs]);

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
    return `
    === WORKSPACE DIALOGUE SUMMARIES ===
    ${summariesText}
    
    === DESIGN ALTERNATIVES EVOLUTION (USER FEEDBACK) ===
    ${alternativesDialogue || "No explicit user feedback recorded."}
    
    === GENERATED DESIGN ALTERNATIVES ===
    ${alternativesContext}
    `;
  },  [savedSummaries, chatLogs, alternativeImages]);
  

  const requestGeneratedImage = useCallback(
  async (feedback?: string, previousPrompt?: string) => {
    if (!userKey) {
      throw new Error("Authentication required.");
    }
    if (!siteImageConfigured || !siteImageId) {
      throw new Error("Site image is not configured.");
    }

    const response = await fetch("/api/generate-alternative", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: feedback ? "iteration" : "initial",
        workspaceSummary: savedSummaries,
        workspaceInput: buildImageGenerationInput(),
        feedback,
        previousPrompt,
        siteImageId,
        useSiteImage: true,
        provider:
          activeProvider.toLowerCase() === "gemini"
            ? "gemini"
            : "openai",
         userID: userKey,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error ?? "Image generation failed.");
    }

    const payload = (await response.json()) as {
      imageId: string;
      base64?: string;
      downloadUrl?: string;
      prompt?: string;
    };

    const label = `Alternative ${alternativeImages.length + 1}`;
    const note = payload.prompt ?? "";

    if (payload.downloadUrl && !payload.base64) {
      setLastGeneratedImageId(payload.imageId);
      return {
        id: payload.imageId,
        label,
        note,
        imageUrl: payload.downloadUrl,
        createdAt: new Date().toISOString(),
      };
    }

    if (!payload.base64) {
      throw new Error("No image data returned.");
    }

    const saved = await saveGeneratedImageFromBase64({
      imageId: payload.imageId,
      base64: payload.base64,
      label,
      note,
      userId: userKey,
    });

    if (!saved) {
      throw new Error("Unable to save generated image.");
    }

    setLastGeneratedImageId(saved.imageId);

    return {
      id: saved.imageId,
      label: saved.label,
      note: saved.note,
      imageUrl: saved.downloadUrl,
      createdAt: saved.createdAt,
    };
  },
  [
    activeProvider,
    alternativeImages.length,
    buildImageGenerationInput,
    savedSummaries,
    siteImageConfigured,
    siteImageId,
    userKey,
  ]
);

 const requestAutoGeneratedImage = useCallback(
  async () => {
    const imageRecord = await requestGeneratedImage();
    if (!imageRecord?.imageUrl) {
      setErrorMessage("Unable to generate the image.");
      return;
    }

    setChatLogs((prev) => {
      const next = [
        ...prev,
        {
          stepId: "alternatives",
          provider: activeProvider,
          sender: "assistant" as const,
          text: "Generated an initial concept image based on earlier discussions.",
          label: activeProvider,
          createdAt: new Date().toISOString(),
          imageUrl: imageRecord.imageUrl,
          imageId: imageRecord.id,
          imageLabel: imageRecord.label,
          imageNote: imageRecord.note,
        },
      ];

      if (userKey) {
        saveChatLogsToFirestore(
          userKey,
          next,
          user?.email ?? userKey
        );
      }

      return next;
    });
  },
  [
    requestGeneratedImage,
    activeProvider,
    userKey,
    user?.email,
  ]
);

  useEffect(() => {
    if (activeStep.id !== "alternatives") return;
    if (lockedStages["alternatives"]) return;
    if (!siteImageConfigured) return;
    if (isLoadingAlternatives) return; 
    if (isSending) return;             
    if (alternativesInitialized !== false) return;
    if (alternativeImages.length > 0) return;

    setIsLoadingAlternatives(true);
    requestAutoGeneratedImage()
    .then(async () =>{
      if (userKey) {
        await saveWorkspaceSummary(userKey, {
          alternativesInitialized: true,
        });
        setAlternativesInitialized(true);
      }
    })
    .catch((err) => {
      setErrorMessage(
        err instanceof Error ? err.message : "Auto generation failed."
      );
    })
    .finally(() => {
      setIsLoadingAlternatives(false);
    });
}, [
  activeStep.id,
  lockedStages,
  siteImageConfigured,
  isLoadingAlternatives,
  isSending,
  alternativesInitialized,
  requestAutoGeneratedImage,
]);
  
const sendingRef = useRef(false);

const handleSend = async () => {
  if (!inputValue.trim()) return;
  if (lockedStages[activeStep.id]) return;

  if (sendingRef.current) return;
  sendingRef.current = true;

  if (activeStep.id === "alternatives" && isLoadingAlternatives) {
    setErrorMessage("Image generation already in progress.");
    return;
  }

  setErrorMessage(null);

  const stepId = activeStep.id;
  const userMessage = inputValue.trim();
  setIsSending(true);

  // 1) 유저 메시지 append + 저장
  setChatLogs((prev) => {
    const next: ChatLog[] = [
      ...prev,
      {
        stepId,
        provider: activeProvider,
        sender: "user" as const,
        text: userMessage,
        label: role,
        createdAt: new Date().toISOString(),
      },
    ];

    if (userKey) {
      saveChatLogsToFirestore(userKey, next, user?.email ?? userKey);
    }
    return next;
  });

  setInputValue("");

  try {
    if (stepId === "alternatives") {
      if (!siteImageConfigured) {
        setShowSiteImageWarning(true);
        setErrorMessage("Image generation requires a site image.");
        return;
      }

      setIsLoadingAlternatives(true);
      try {
        const latestPrompt =
          alternativeImages[alternativeImages.length - 1]?.note;

        const imageRecord = await requestGeneratedImage(userMessage, latestPrompt);

        if (!imageRecord?.imageUrl) {
          setErrorMessage("Unable to generate the image.");
          return;
        }

        setChatLogs((prev) => {
          const next: ChatLog[] = [
            ...prev,
            {
              stepId,
              provider: activeProvider,
              sender: "assistant" as const,
              text: "Generated a new concept image based on your feedback.",
              label: activeProvider,
              createdAt: new Date().toISOString(),
              imageUrl: imageRecord.imageUrl,
              imageId: imageRecord.id,
              imageLabel: imageRecord.label,
              imageNote: imageRecord.note,
            },
          ];

          if (userKey) {
            saveChatLogsToFirestore(userKey, next, user?.email ?? userKey);
          }
          return next;
        });

        return;
      } finally {
        setIsLoadingAlternatives(false);
      }
    }

    if (stepId === "evaluation") {
      const evaluationContext = buildEvaluationContext();
      const evaluationMessage = `${evaluationContext}\n\nUser question:\n${userMessage}`;

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: activeProvider,
          model: getChatModelByProvider(activeProvider),
          stepId: "evaluation",
          message: evaluationMessage,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Evaluation chat failed.");
      }

      const payload = await response.json();
      const reply = payload.reply;

      setChatLogs((prev) => {
        const next: ChatLog[] = [
          ...prev,
          {
            stepId,
            provider: activeProvider,
            sender: "assistant" as const,
            text: reply,
            label: activeProvider,
            createdAt: new Date().toISOString(),
          },
        ];

        if (userKey) {
          saveChatLogsToFirestore(userKey, next, user?.email ?? userKey);
        }
        return next;
      });

      return;
    }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: activeProvider,
          model: getChatModelByProvider(activeProvider),
          stepId,
          message: userMessage,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Chat request failed.");
      }
      const payload = (await response.json()) as { reply: string };
      const reply = payload.reply;
      setChatLogs((prev) => {
        const next: ChatLog{} = [
          ...prev,
        {
          stepId,
          provider: activeProvider,
          sender: "assistant" as const,
          text: reply,
          label: activeProvider,
          createdAt: new Date().toISOString(),
        },
      ];     
      if (userKey) {saveChatLogsToFirestore(userKey, next, user?.email ?? userKey); }            
       return next;
  });
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to connect to the LLM API."
      );
    } finally {
      setIsSending(false);
      sendingRef.current = false;
    }
  };

  const handleCompleteStep = async () => {
    if (lockedStages[activeStep.id]) {
      setFinishNotice({
        status: "error",
        message: "This stage is locked.",
      });
    return;
    }
    if (!userKey) {
      setFinishNotice({
        status: "error",
        message: "Authentication required.",
        });
      return;
    }
    setSavedSummaries((prev) => ({
      ...prev,
      [activeStep.id]: stepSummaries[activeStep.id],
    }));
    setIsSummarizing(true);
    setFinishNotice({ status: "uploading", message: "Uploading chat logs to Report..." });
    
    try {
      const response = await fetch("/api/workspace-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentStage: activeStep.title,
          workspaceInput: buildWorkspaceInput(),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Summary generation failed.");
      }
      const payload = (await response.json()) as {
        workspaceSummary: {
          stageSummaries: Record<string, string>;
          overallSummary: string;
        };
      };
      const stageSummary =
        payload.workspaceSummary.stageSummaries?.[activeStep.id]?.trim() ?? "";
      const mergedStageSummaries = {
        ...savedSummaries,
        ...(stageSummary ? { [activeStep.id]: stageSummary } : {}),
      };
      const nextCompletedStages = Array.from(
        new Set([...completedStages, activeStep.id])
      );
      await saveWorkspaceSummary(userKey, {
        stageSummaries: mergedStageSummaries,
        overallSummary: payload.workspaceSummary.overallSummary ?? "",
        role,
        completedStages: nextCompletedStages,
      });
      if (stageSummary) {
        setSavedSummaries(mergedStageSummaries);
      }
      setCompletedStages(nextCompletedStages);
      setFinishNotice({ status: "success", message: "Upload complete. Report updated." });
    } catch (error) {
      setFinishNotice({
        status: "error",
        message:
           error instanceof Error
            ? `Upload failed: ${error.message}`
            : "Upload failed.",
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
    await saveUserDesignSubmission(userKey, selected.id);
    await refreshEvaluationImages();
    setHasInitializedAlternatives(true);
    setSelectedAlternative(null);
    await handleCompleteStep();
  };

  const handleSubmitRankings = async () => {
    if (!userKey) {
      return;
    }
    if (!evaluationImages.length) {
      return;
    }
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
    await sendEvaluationResult(payload);

    await handleCompleteStep();
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatLogs, activeStep.id]);

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

  if (loading) {
    return (
      <AppShell>
        <div className="rounded-3xl border border-[var(--border)] bg-white p-6 text-sm text-slate-500">
          Loading workspace...
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <div className="rounded-3xl border border-[var(--border)] bg-white p-6 text-sm text-slate-500">
          Authentication required. Redirecting to Home...
        </div>
      </AppShell>
    );
  }

  const renderChatPanel = () => {
    const stepLogs = chatLogs.filter((log) => log.stepId === activeStep.id);
    const basePrompt = basePromptsByStep[activeStep.id];
    const displayedMessages = [
      ...(basePrompt
        ? [
            {
              text: basePrompt,
              sender: "assistant" as const,
              label: activeProvider,
              imageUrl: undefined,
            },
          ]
        : []),
      ...stepLogs,
    ];
    const formatMessage = (text: string) =>
      text.split(/(\*\*[^*]+\*\*)/g).map((segment, segmentIndex) => {
        if (segment.startsWith("**") && segment.endsWith("**")) {
          return (
            <strong key={`bold-${segmentIndex}`}>
              {segment.slice(2, -2)}
            </strong>
          );
        }
        return <span key={`text-${segmentIndex}`}>{segment}</span>;
      });
    const isStageLocked = Boolean(lockedStages[activeStep.id]);
    return (
    <div className="flex h-full flex-col rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-400">
            {activeProvider}
          </p>
          <h3 className="mt-2 text-lg font-semibold">API conversation</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user?.email === adminEmail && (
            <>
              <button
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                type="button"
                onClick={async () => {
                  const nextLocks = {
                    ...lockedStages,
                    [activeStep.id]: true,
                  };
                  setLockedStages(nextLocks);
                  await saveStageLocks({
                    lockedStages: nextLocks,
                    revisedAfterLock,
                    updatedBy: user.email ?? user.uid,
                  });
                }}
                disabled={isStageLocked}
              >
                🔒 Lock stage
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
                  });
                }}
                disabled={!isStageLocked}
              >
                🔓 Reopen stage
              </button>
            </>
          )}
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[var(--primary)]">
            {activeProvider}
          </span>
        </div>
      </div>
      {isStageLocked && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-700">Stage completed</p>
          <p className="mt-1">
            🔒 This stage is completed
            <br />
            Your responses have been summarized and locked for collaboration
            consistency.
          </p>
          {revisedAfterLock[activeStep.id] && (
            <p className="mt-2 text-[11px] text-slate-500">
              Revised after lock.
            </p>
          )}
        </div>
      )}
      <div className="mt-4 max-h-[420px] flex-1 space-y-4 overflow-auto text-sm text-slate-600">
        {displayedMessages.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400">
            Start a conversation here to discuss the project and planning
            needs.
          </div>
        )}
        {displayedMessages.map((message, index) => {
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
              <p className="text-xs font-semibold uppercase text-slate-400">
                {message.label}
              </p>
              {message.text && (
                <p className="mt-2 whitespace-pre-line">
                  {formatMessage(message.text)}
                </p>
              )}
              {message.imageUrl && (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <img
                    src={message.imageUrl}
                    alt="Generated concept"
                    className="h-48 w-full object-cover"
                  />
                </div>
              )}
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <input
          className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-sm focus:border-[var(--primary)] focus:outline-none disabled:bg-slate-100"
          placeholder="Send a prompt to the PPSS assistant..."
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSend();
            }
          }}
          disabled={isStageLocked}
        />
        <button
          className="rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
          type="button"
          onClick={handleSend}
          disabled={isSending || isStageLocked || isLoadingAlternatives}
        >
          {isLoadingAlternatives ? "Generating…" 
          :isSending ? "Sending..." : "Send"}
        </button>
      </div>
      {errorMessage && (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-600">
          {errorMessage}
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
        {finishNotice.message}  
      </div>
      )}
      <button
        className="mt-4 rounded-full border border-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary)] hover:bg-blue-50"
        type="button"
        onClick={handleCompleteStep}
        disabled={isSummarizing}
      >
        {isSummarizing ? "Updating..." : "Finish Stage"}
      </button>
    </div>
  );
  };

  const renderProblemDefinitionContext = () => {
    return (
      <div className="mt-6 max-h-[70vh] space-y-6 overflow-y-auto pr-2">
        <figure className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          <img
            src="https://cdn.m-joongang.com/news/photo/201506/20150618_2_306921.jpg"
            alt="Designers collaborating with post-it notes"
            className="h-56 w-full object-cover"
          />
          <figcaption className="px-4 py-3 text-xs text-slate-500">
            Picture of Seoul station overpass.
          </figcaption>
        </figure>
        <div className="panel-copy space-y-4 text-sm text-slate-600">
          <h2 className="text-lg font-semibold text-slate-900">
            Seoul Station Overpass
          </h2>
          <p>
            Before its transformation, the Seoul Station Overpass stood as a
            deteriorating yet symbolically important piece of infrastructure in
            the heart of the city. Built in 1970 to ease mounting traffic and
            support fast-paced urban growth, the elevated roadway once embodied
            Seoul’s modernization. Over time, however, structural aging, safety
            concerns, and limited pedestrian accessibility made it increasingly
            incompatible with the evolving needs of the city. Still, as
            conversations around urban regeneration grew, the overpass began to
            be seen not only as an obsolete structure but also as a potential
            anchor for revitalizing the fragmented districts surrounding Seoul
            Station.
          </p>
          <p>
            Structurally, the overpass was narrow, elevated up to 17 meters, and
            originally designed for vehicle-heavy use—conditions that made it
            unsafe for public recreation and difficult for pedestrians to reach.
            Its height and position over major arterial roads and rail tracks
            also contributed to its isolation from the street-level environment.
            Although the view from the overpass mainly looked onto adjacent
            buildings rather than open landscapes, the area below and around it
            was rich with cultural, historical, and industrial assets, creating
            opportunities for a more integrated urban strategy.
          </p>
          <p>
            The districts west of Seoul Station—such as Jungnim-dong,
            Seogye-dong, and Malli-dong—had long suffered from physical decline
            and social isolation due to the separation created by the railway.
            This isolation contributed to economic stagnation and political
            marginalization, even as these neighborhoods maintained unique
            cultural landscapes, including historic sites, traditional hillsides,
            and a concentrated sewing and garment industry. These
            characteristics positioned the western neighborhoods as strong
            candidates for community-based urban regeneration.
          </p>
          <p>
            On the eastern side, Namdaemun Market and Hoehyeon-dong faced
            different challenges. Namdaemun Market, one of Korea’s largest and
            most historic commercial zones, struggled with aging facilities,
            competing stakeholder interests, declined tourism, and complex
            governance issues. Hoehyeon-dong, caught between Namsan and the
            commercial core, had long been constrained by height limits and
            fragmented development patterns. Despite these challenges, both
            areas retained symbolic significance and benefited from their
            strategic location at Seoul’s urban gateway.
          </p>
          <p>
            Across all neighborhoods, local groups expressed shared concerns as
            the city considered closing the overpass. Many demanded alternative
            traffic routes, plans to alleviate anticipated congestion, and
            renewed attention to long-stalled development around the northern
            station area. Others emphasized the need to address local social
            issues—particularly homelessness, vulnerable housing, and support
            for the declining sewing industry. Specific districts also raised
            their own priorities, from calls to modernize Namdaemun Market to
            community-led planning efforts in Seogye-dong that sought a balanced
            approach to redevelopment.
          </p>
          <p>
            Overall, before its conversion into a public park, the Seoul Station
            Overpass existed at the intersection of aging infrastructure,
            fragmented urban fabric, and a dense concentration of cultural and
            economic activities. Although its original transportation role had
            diminished, the surrounding neighborhoods’ conditions suggested
            that reimagining the overpass could play a central role in
            stitching together divided districts and offering a new direction
            for urban regeneration in central Seoul.
          </p>
        </div>
      </div>
    );
  };

  return (
    <AppShell>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-300">
          Workspace
        </p>
        <h2 className="text-3xl font-semibold">PPSS workflow dashboard</h2>
        <p className="max-w-3xl text-sm text-slate-500">
          {roleDescriptions[role] ??
            "Navigate through the five-step planning workflow and monitor progress with a live ChatGPT-powered conversation panel."}
        </p>
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-300">
          Active AI provider: {activeProvider}
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white px-6 py-6 shadow-sm">
        <div className="grid grid-cols-5 gap-3">
          {steps.map((step) => {
            const isActive = step.id === activeStep.id;
            return (
              <button
                key={step.id}
                className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-left text-xs font-semibold transition ${
                  isActive
                    ? "bg-[var(--primary)] text-white shadow-md"
                    : "border border-slate-200 bg-slate-50 text-slate-600 hover:border-[var(--primary)]"
                }`}
                type="button"
                onClick={() => setActiveStep(step)}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "border border-slate-200 bg-white text-[var(--primary)]"
                  }`}
                >
                  {step.icon}
                </span>
                <span className="truncate">{step.title}</span>
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

      {activeStep.id === "problem" && (
        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Problem Definition</h3>
            <p className="mt-2 text-sm text-slate-500">
              Clarify your interest and objectives  
            </p>
            {renderProblemDefinitionContext()}
          </div>
          {renderChatPanel()}
        </section>
      )}

      {activeStep.id === "data" && (
        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
              <h3 className="text-lg font-semibold">Data Analysis</h3>
              <p className="mt-2 text-sm text-slate-500">
                Explore other projects with similar situations.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { label: "789 Art Zone", value: "patterns" },
                  { label: "Gyeungui Line Forest Park", value: "painpoints" },
                  { label: "Highline Park", value: "opportunities" },
                ].map((tab) => {
                  const isActive = tab.value === activeTab;
                  return (
                    <button
                      key={tab.value}
                      className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                        isActive
                          ? "bg-[var(--primary)] text-white"
                          : "border border-slate-200 bg-white text-slate-600 hover:border-[var(--primary)]"
                      }`}
                      type="button"
                      onClick={() => setActiveTab(tab.value)}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  {activeTab === "patterns" && (
                    <>
                      <img
                        src="https://museumofwander.com/wp-content/uploads/2023/03/DSC00795.jpg"
                        alt="789 Art Zone in Beijing, China"
                        className="h-72 w-full rounded-xl object-cover"
                      />
                      <p>
                        The 798 Art Zone (also known as Dashanzi Art District)
                        in Beijing is a globally recognized urban regeneration
                        project that transformed a 1950s military electronics
                        factory complex into China’s leading contemporary art
                        hub. Originally part of the 718 Joint Project, the
                        Bauhaus-style industrial complex was built in
                        collaboration with East Germany and served as a model
                        socialist factory—a self-contained community providing
                        housing, schools, and healthcare for its workers.
                      </p>
                      <p>
                        Following China’s economic reforms in the 1980s,
                        production declined, and the complex was abandoned. In
                        the mid-1990s, artists such as Sui Jianguo, Huang Rui,
                        and Liu Suola began occupying the vacant spaces,
                        attracted by low rent and spacious, light-filled
                        interiors. This spontaneous occupation marked the first
                        phase (“incubation period”) of the district’s rebirth as
                        a creative enclave.
                      </p>
                      <p>
                        In the early 2000s, the “Seven Star Group”, a state
                        enterprise owning the site, sought to demolish the
                        buildings for redevelopment. In response, artists
                        organized exhibitions such as Reconstruction 798 and the
                        Dashanzi International Art Festival (2004–2006), drawing
                        international attention and civic support. The city
                        government ultimately protected 798 as a cultural
                        heritage site, designating it a “Creative Cultural
                        Industries Cluster” in 2008.
                      </p>
                      <p>
                        Today, 798 Art Zone covers 138 hectares in Beijing’s
                        Chaoyang District, featuring art galleries, design
                        studios, cafés, and creative companies. It attracts both
                        domestic and international visitors and plays a key role
                        in Beijing’s city branding. However, rapid
                        commercialization and rising rents have pushed many
                        pioneering artists to relocate to cheaper districts
                        like Caochangdi and Songzhuang, raising concerns about
                        gentrification and the loss of 798’s avant-garde spirit.
                      </p>
                      <p>
                        Despite this, the zone remains a symbol of China’s
                        cultural transformation, representing the intersection
                        of industrial heritage reuse, creative economy, and
                        state-led urban marketing. It embodies the paradox of
                        contemporary Chinese urbanism—balancing artistic
                        freedom, economic pragmatism, and government control.
                      </p>
                      <p>
                        Key themes: ▷ Adaptive reuse of socialist industrial
                        heritage (Bauhaus architecture) ▷ Emergence from
                        grassroots artist occupation to state-recognized
                        cultural hub ▷ Integration into Beijing’s global city
                        marketing strategy ▷ Tensions between artistic
                        authenticity and commercialization ▷ Influence on
                        similar creative clusters across China (e.g., Shanghai’s
                        M50, Chengdu, Kunming)
                      </p>
                    </>
                  )}
                  {activeTab === "painpoints" && (
                    <>
                      <img
                        src="https://parks.seoul.go.kr/images/egovframework/com/template/gus3.jpg"
                        alt="Gyeungui Line Forest Park in Seoul, Korea"
                        className="h-72 w-full rounded-xl object-cover"
                      />
                      <p>
                        The Gyeongui Line Forest Park in Seoul is a major urban
                        regeneration project that transformed an abandoned
                        railway corridor into a linear green space stretching
                        approximately 6.3 km from Gajwa Station to Yongsan
                        Community Center. Initiated in 2009 as part of the
                        city’s regeneration plan, it reconnects neighborhoods
                        once divided by the railway and enhances the quality of
                        urban life by returning disused land to the public.
                      </p>
                      <p>
                        The project originated from a 2004 Seoul Institute study
                        on reusing idle rail land and was implemented in stages
                        —beginning with the Daeheung section (760 m) in 2012 and
                        expanding through Yeonnam-dong and Yeomni-dong. The
                        park’s design integrates green space with pedestrian
                        accessibility, linking surrounding neighborhoods and
                        commercial areas while absorbing local pedestrian
                        traffic into its flow.
                      </p>
                      <p>
                        A key characteristic of the Gyeongui Line Forest Park is
                        its strong emphasis on citizen participation. In 2014,
                        the city and Mapo District established “Gyeongui Line
                        Forest Keepers” (Gyeongui-seon Supgil-jigi)—a nonprofit
                        organization modeled after New York’s Friends of the
                        High Line. This group includes residents, designers,
                        students, and local officials who collaborate to manage
                        and activate the park through community-based programs
                        such as cultural events, gardening, environmental
                        cleanups, and public art projects (White Butterfly
                        Project).
                      </p>
                      <p>
                        The park has become a vibrant urban space where citizens
                        and visitors gather for leisure and cultural activities,
                        especially in the Yeonnam-dong area near Hongdae.
                        However, it also faces challenges like gentrification,
                        waste management, and pedestrian–cyclist safety
                        conflicts. Local forums and initiatives have been
                        organized to mitigate these issues and ensure
                        sustainable coexistence between long-term residents and
                        newcomers.
                      </p>
                      <p>
                        The Gyeongui Line Forest Park exemplifies adaptive reuse
                        of post-industrial infrastructure through participatory
                        governance, aligning with global trends such as New
                        York’s High Line and Paris’s Promenade Plantée. It
                        symbolizes Seoul’s shift from government-driven
                        redevelopment toward citizen-led urban regeneration,
                        where community stewardship shapes the identity and
                        sustainability of public spaces.
                      </p>
                      <p>
                        Key themes: ▷ Transformation of an abandoned railway
                        into a linear urban park ▷ Citizen-led management
                        through Gyeongui Line Forest Keepers ▷ Cultural and
                        ecological revitalization of neighborhoods ▷ Challenges
                        of gentrification and inclusive urban regeneration
                      </p>
                    </>
                  )}
                  {activeTab === "opportunities" && (
                    <>
                      <img
                        src="https://cdn.vox-cdn.com/thumbor/vfP32EdfHssHtEknAq-I1Tyv0Zw=/0x0:2000x1333/2070x828/filters:focal(840x507:1160x827):format(webp)/cdn.vox-cdn.com/uploads/chorus_image/image/63748975/Highline_Guide_Max_Touhey_20190416_0082.0.jpg"
                        alt="Highline Park in New York, USA"
                        className="h-72 w-full rounded-xl object-cover"
                      />
                      <p>
                        The High Line Park is an elevated linear park in
                        Manhattan, New York City, created from an abandoned
                        freight rail line that once ran through the Chelsea
                        district. Originally built in the 1930s to prevent
                        frequent traffic accidents between trains and vehicles
                        on 10th Avenue—once known as “Death Avenue”—the railway
                        operated until 1980 before being closed and neglected
                        for decades.
                      </p>
                      <p>
                        In the 1990s, the structure faced demolition, but local
                        residents organized a civic movement called Friends of
                        the High Line (FHL) to preserve and repurpose it as a
                        public park. Founded by Joshua David and Robert Hammond
                        in 1999, the group succeeded in convincing the city and
                        property owners to support redevelopment instead of
                        removal.
                      </p>
                      <p>
                        A public–private partnership between the City of New
                        York and FHL led to the park’s creation. The city
                        allowed developers to transfer development rights from
                        nearby lots, while FHL raised $3.5 million and the city
                        invested $15.75 million, later increased by Mayor
                        Michael Bloomberg to a total of $43.25 million. In 2003,
                        an international design competition attracted 720 teams
                        from 36 countries. The winning proposal came from Field
                        Operations (landscape architecture) and Diller Scofidio
                        + Renfro (architecture), whose design integrated nature
                        and urban infrastructure through the concept of
                        “Agri-tecture”—a hybrid of agriculture and
                        architecture.
                      </p>
                      <p>
                        Opened in stages from 2009, the High Line preserves the
                        industrial character of the area while introducing
                        sustainable greenery, wooden decks, and pedestrian paths
                        that blend with the city’s skyline. The park provides a
                        serene walking experience above the bustling streets,
                        offering views of the Hudson River and Manhattan’s
                        buildings.
                      </p>
                      <p>
                        Today, the High Line stands as a symbol of urban
                        regeneration, transforming a decaying industrial relic
                        into a vibrant public space that promotes ecological
                        design, cultural vitality, and social inclusivity. It
                        also reinforced New York’s identity as a city capable of
                        turning “urban scars” into celebrated landmarks.
                      </p>
                      <p>
                        Key themes: ▷ Adaptive reuse of obsolete infrastructure
                        ▷ Citizen-led activism and public–private collaboration
                        ▷ Integration of nature and urban life (Agri-tecture) ▷
                        Model for sustainable urban regeneration and placemaking
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
          {renderChatPanel()}
        </section>
      )}

      {activeStep.id === "alternatives" && (
        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Image Gallery</h3>
            <p className="mt-2 text-sm text-slate-500">
              Generate alternatives in the chat, then select the design you
              want to submit.
            </p>
            <div className="mt-5 max-h-[70vh] overflow-y-auto pr-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Use the chat panel to request new alternatives or edit the
                latest concept image. Generated images will appear inline in
                the chat history and in the gallery below.
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
                            alt={item.label}
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
                        ? "Generating Design..."
                        : "Updating Design..."}
                    </span>
                    <span className="mt-1 text-xs opacity-70">Generating</span>
                  </div>
                </div>
              )}

              {groupedAlternativeImages.length === 0 &&
                !isLoadingAlternatives && (
                  <div className="flex flex-col items-center justify-center gap-3 py-6">
                    <span className="text-center text-sm text-slate-500">
                      Generated images will appear here
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
                Submit Design
              </button>
              <p className="text-xs text-slate-500">
                Submit your best design to share.
              </p>
            </div>
          </div>
          {renderChatPanel()}
        </section>
      )}

      {activeStep.id === "evaluation" && (
        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Design/Plan Evaluation</h3>
            <p className="mt-2 text-sm text-slate-500">
              Review submitted alternatives, compare intent notes, and assign
              overall rankings.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {isLoadingEvaluationImages && (
                <div className="col-span-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  Loading submitted designs...
                </div>
              )}
              {!isLoadingEvaluationImages && evaluationImages.length === 0 && (
                <div className="col-span-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  Submitted designs will appear here once participants finish
                  the Design/Plan Alternatives stage.
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
                        alt={image.label}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </button>
                  <div className="mt-3 space-y-2 text-xs text-slate-500">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700">
                        {image.label}
                      </span>
                      <div className="flex items-center gap-2">
                        <span>Rank</span>
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
                        {image.submittedBy}
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
              Submit ranking &amp; finish stage
            </button>
          </div>
          {renderChatPanel()}
        </section>
      )}

      {activeStep.id === "report" && (
        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Evaluation Report</h3>
            <p className="mt-2 text-sm text-slate-500">
              Consolidate the final PPSS report for audit and stakeholder
              sign-off.
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
                    Project keywords
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
                        Keywords will appear after executive summary generation.
                      </span>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    Executive summary
                  </p>
                  <div className="mt-3 space-y-2">
                    {executiveSummary?.stageSummaries.decision
                      ? renderSummaryLines(
                          executiveSummary.stageSummaries.decision
                        )
                      : "Generate the decision summary to see the final executive overview."}
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
                      User {index + 1}
                    </button>
                  ))}
                </div>
                {activeRoleEntries.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No workspace summaries for this role yet.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase text-slate-400">
                        Overall summary
                      </p>
                      <div className="mt-3 space-y-2">
                        {activeUserEntry?.summary.overallSummary
                          ? renderSummaryLines(
                              activeUserEntry.summary.overallSummary
                            )
                          : "No overall summary available for this user."}
                      </div>
                    </div>
                    <div className="grid gap-4">
                      {steps.map((step) => (
                        <div
                          key={step.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                        >
                          <p className="text-sm font-semibold text-slate-700">
                            {step.title}
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
                              : "Finish the stage to generate this summary."}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <button
              className="mt-6 rounded-full border border-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary)] hover:bg-blue-50"
              type="button"
              onClick={handleCompleteStep}
            >
              Finish Stage
            </button>
          </div>
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Evidence &amp; statistics</h3>
            <p className="mt-2 text-sm text-slate-500">
              Visual evidence and key metrics supporting the evaluation.
            </p>
            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase text-slate-400">
                  Top preference
                </p>
                <div className="mt-3 h-56 overflow-hidden rounded-xl bg-gradient-to-br from-blue-100 via-white to-slate-100">
                  {topPreference?.imageUrl && (
                    <img
                      src={topPreference.imageUrl}
                      alt={topPreference.label}
                      className="h-full w-full object-contain"
                    />
                  )}
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-700">
                  {topPreference?.label ?? "Top concept"}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {topPreference?.label ?? "Design"} ·{" "}
                  {getParticipantRoleLabel(topPreference)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Highest-rated design based on submitted rankings.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase text-slate-400">
                  Top choice share (pie)
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
                          Rank {item.rank}
                        </span>
                        <span className="ml-auto text-slate-500">
                          {item.value} votes
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-xs font-semibold uppercase text-slate-400">
                  Ranking overview
                </p>
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-3 text-[11px] font-semibold uppercase text-slate-400">
                    <span>Alternative</span>
                    <span>Participant role</span>
                    <span>Average rank</span>
                    <span>Votes</span>
                  </div>
                  {aggregatedResults.map((result) => (
                    <div key={result.id} className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <div className="relative group font-semibold text-slate-700">
                          <span className="cursor-default">
                            {result.label}{" "}
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
                            <div className="pointer-events-none absolute left-0 top-full z-10 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                              <img
                                src={
                                  evaluationImages.find(
                                    (image) => image.id === result.id
                                  )?.imageUrl
                                }
                                alt={`${result.label} preview`}
                                className="h-40 w-full rounded-lg object-cover"
                              />
                            </div>
                          )}
                        </div>
                        <span>
                          Avg rank{" "}
                          {result.average > 0
                            ? result.average.toFixed(1)
                            : "N/A"}{" "}
                          · Top choice {result.topChoice}
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
        </section>
      )}
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
                  Design preview
                </p>
                <h3 className="mt-2 text-xl font-semibold">
                  {selectedImageItem?.label ?? "Design concept"}
                </h3>
              </div>
              <button
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 hover:border-slate-300"
                type="button"
                onClick={() => setSelectedImage(null)}
              >
                Close
              </button>
            </div>
      
            <div className="max-h-[calc(90vh-96px)] overflow-y-auto px-6 py-6">
              {selectedImageItem?.imageUrl ? (
                <img
                  src={selectedImageItem.imageUrl}
                  alt="Selected concept"
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
              Site image not uploaded yet
            </h3>
            <p className="mt-3 text-sm text-slate-500">
              Image-based generation is disabled.
            </p>
            <button
              className="mt-6 w-full rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
              type="button"
              onClick={() => setShowSiteImageWarning(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
     
    </AppShell>
  );
}
