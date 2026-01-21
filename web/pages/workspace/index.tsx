import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  saveStageLocks,
} from "../../lib/firebase";
import { useAuth } from "../../lib/auth";
import { useRouter } from "next/router";

const getChatModelByProvider = (provider: string) => {
  if (provider.toLowerCase() === "gemini") {
    return "gemini-1.5-flash";
  }
  if (provider.toLowerCase() === "deepseek") {
    return "deepseek-chat";
  }
  return "gpt-5-mini"; // openai default
};

type Stage3Intent = "text_reasoning" | "image_generate" | "image_edit";

const getStage3Intent = (
  message: string,
  hasRecentImage: boolean
): Stage3Intent => {
  const normalized = message.toLowerCase();
  const editHints = [
    "edit",
    "modify",
    "change",
    "adjust",
    "tweak",
    "update",
    "refine",
    "background",
    "color",
    "palette",
    "lighting",
    "contrast",
    "layout",
    "composition",
    "tone",
    "style",
    "texture",
    "material",
    "add",
    "remove",
    "increase",
    "decrease",
  ];
  const generateHints = [
    "generate",
    "create",
    "design",
    "visualize",
    "render",
    "illustrate",
    "mockup",
    "concept",
    "alternative",
    "image",
    "picture",
  ];

  if (hasRecentImage && editHints.some((hint) => normalized.includes(hint))) {
    return "image_edit";
  }
  if (generateHints.some((hint) => normalized.includes(hint))) {
    return "image_generate";
  }
  return "text_reasoning";
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

const storageKey = "ppss-workspace-summaries";
const evaluationStorageKey = "ppss-evaluation-results";
const defaultEvaluationImages: DesignImage[] = Array.from(
  { length: 7 },
  (_, index) => ({
    id: `concept-${index + 1}`,
    label: `Concept ${index + 1}`,
    note: "",
  }));
const rankingOptions = ["1", "2", "3", "4", "5", "6", "7"];
const providerStorageKey = "ppss-active-provider";
const adminEmail = "test@snu.ac.kr";

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

const basePromptsByStep: Record<string, string> = {
  data: "What stands out to you in this data?",
  alternatives:
    "Based on our talks, I generated images you might like. How do you think?",
  evaluation: "Which design seems interesting and why?",
  report:
    "From your perspective, what is the most important issue in this project?",
};

export default function Workspace() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const userKey = user?.uid;
  const [activeStep, setActiveStep] = useState(steps[0]);
  const [activeTab, setActiveTab] = useState("Process log");
  const [inputValue, setInputValue] = useState("");
  const [role, setRole] = useState("Guest");
  const [activeProvider, setActiveProvider] = useState("ChatGPT");
  const [isSending, setIsSending] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedAlternative, setSelectedAlternative] = useState<string | null>(
    null
  );
  const [showSiteImageWarning, setShowSiteImageWarning] = useState(false);
  const [showSubmitNotice, setShowSubmitNotice] = useState<null | string>(null);
  const [finishNotice, setFinishNotice] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isLoadingAlternatives, setIsLoadingAlternatives] = useState(false);
  const [hasInitializedAlternatives, setHasInitializedAlternatives] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const hasAutoGeneratedAlternativePrompt = useRef(false);
  const [siteImageConfigured, setSiteImageConfigured] = useState(false);
  const [siteImageId, setSiteImageId] = useState<string | null>(null);
  const [evaluationImages, setEvaluationImages] = useState<DesignImage[]>(
    defaultEvaluationImages
  );
  const [lastGeneratedImageId, setLastGeneratedImageId] = useState<
    string | null
  >(null);
  const [rankings, setRankings] = useState<Record<string, number>>(() => {
    const initialState: Record<string, number> = {};
    defaultEvaluationImages.forEach((image, index) => {
      initialState[image.id] = index + 1;
    });
    return initialState;
  });
  const [evaluationResults, setEvaluationResults] = useState<
    Array<Record<string, number>>
  >([]);
  const [chatLogs, setChatLogs] = useState<ChatLog[]>([]);
  const [hasLoadedChatLogs, setHasLoadedChatLogs] = useState(false);
  const [savedSummaries, setSavedSummaries] = useState<
    Record<string, string>
  >({});

  const buildImageGenerationInput = useCallback(() => {
  const MAX_MESSAGES = 6;

  const relevantLogs = chatLogs
    .filter(
      (log) =>
        log.stepId === "problem" ||
        log.stepId === "data"
    )
    .slice(-MAX_MESSAGES)
    .map((log) => log.text);

  return {
    problemSummary: savedSummaries.problem ?? "",
    dataSummary: savedSummaries.data ?? "",
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
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      try {
        setSavedSummaries(JSON.parse(stored));
      } catch {
        setSavedSummaries({});
      }
    }
  }, []);

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
    };
    loadSavedSummaries();
  }, [userKey]);

  useEffect(() => {
  if (completedStages.includes("alternatives")) {
      setHasInitializedAlternatives(true);
    }
  }, [completedStages]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(savedSummaries));
  }, [savedSummaries]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(evaluationStorageKey);
    if (stored) {
      try {
        setEvaluationResults(JSON.parse(stored));
      } catch {
        setEvaluationResults([]);
      }
    }
  }, []);

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
        .map((log) => ({
          id: log.imageId ?? `image-${log.createdAt}`,
          label: log.imageLabel ?? "Generated alternative",
          note: log.imageNote ?? "",
          imageUrl: log.imageUrl,
          createdAt: log.createdAt,
        })),
    [chatLogs]
  );
  
  useEffect(() => {
    if (!userKey) {
      return;
    }
    if (!hasLoadedChatLogs) {
      return;
    }
    saveChatLogsToFirestore(user.uid, chatLogs, user.email ?? user.uid);
  }, [chatLogs, userKey, user?.email, hasLoadedChatLogs, user?.uid]);

  useEffect(() => {
    const loadSiteImage = async () => {
      const current = await loadCurrentSiteImage();
      if (current?.imageId) {
        setSiteImageConfigured(true);
        setSiteImageId(current.imageId);
      } else {
        setSiteImageConfigured(false);
        setSiteImageId(null);
      }
    };
    loadSiteImage();
  }, []);

  useEffect(() => {
    if (!finishNotice) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setFinishNotice(null);
    }, 3000);
    return () => window.clearTimeout(timeout);
  }, [finishNotice]);

  useEffect(() => {
    setRankings((prev) => {
      const next = { ...prev };
      evaluationImages.forEach((image, index) => {
        if (!next[image.id]) {
          next[image.id] = index + 1;
        }
      });
      return next;
    });
  }, [evaluationImages]);

  const progressValue = useMemo(() => {
    const index = steps.findIndex((step) => step.id === activeStep.id);
    if (index === -1) {
      return 0;
    }
    return Math.round((index / (steps.length - 1)) * 100);
  }, [activeStep.id]);

  const buildWorkspaceInput = useCallback(() => {
    return steps.reduce<Record<string, string[]>>((acc, step) => {
      acc[step.id] = chatLogs
        .filter((log) => log.stepId === step.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((log) => log.text);
      return acc;
    }, {});
  }, [chatLogs]);

  const requestAutoGeneratedImage = useCallback(async () => {
  const response = await fetch("/api/generate-alternative", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceSummary: savedSummaries,
      workspaceInput: buildImageGenerationInput(),
      provider:
        activeProvider.toLowerCase() === "gemini"
          ? "gemini"
          : "openai",
    }),
  });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error ?? "Auto generation failed.");
    }
    const payload = (await response.json()) as {
      imageId: string;
      label?: string;
      prompt?: string;
      base64?: string;
    };
    if (!payload.base64) {
      throw new Error("No image data returned.");
    }
    const saved = await saveGeneratedImageFromBase64({
      imageId: payload.imageId,
      base64: payload.base64,
      label: payload.label ?? `Alternative ${alternativeImages.length + 1}`,
      note: payload.prompt!,
      userId: userKey!,
    });
    if (!saved) {
      throw new Error("Unable to save generated image.");
    }
    const imageRecord = {
      id: saved.imageId,
      label: saved.label,
      note: saved.note,
      imageUrl: saved.downloadUrl,
      createdAt: saved.createdAt,
    };
    setLastGeneratedImageId(saved.imageId);
    setChatLogs((prev) => [
      ...prev,
      {
        stepId: "alternatives",
        provider: activeProvider,
        sender: "assistant",
        text: "Generated an initial concept image based on earlier discussions.",
        label: activeProvider,
        createdAt: new Date().toISOString(),
        imageUrl: imageRecord.imageUrl,
        imageId: imageRecord.id,
        imageLabel: imageRecord.label,
        imageNote: imageRecord.note,
      },
    ]);
  }, [
    activeProvider,
    alternativeImages.length,
    buildWorkspaceInput,
    savedSummaries,
  ]);

      useEffect(() => {
    if (activeStep.id !== "alternatives") return;
    if (!hasLoadedChatLogs) return;
    if (hasInitializedAlternatives) return;

    setIsLoadingAlternatives(true);
        
    requestAutoGeneratedImage()
      .then(() => {
        setHasInitializedAlternatives(true);
      })
      .catch((error) => {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to auto-generate an image."
        );
      })
      .finally(() => {
      setIsLoadingAlternatives(false); 
    });
  }, [
    activeStep.id,
    alternativeImages.length,
    hasLoadedChatLogs,
    requestAutoGeneratedImage,
  ]);


  const requestGeneratedImage = async (
    prompt: string,
    baseImageId?: string
  ) => {
    if (!userKey) {
      throw new Error("Authentication required.");
    }
    if (!baseImageId && (!siteImageConfigured || !siteImageId)) {
      throw new Error("Site image is not configured.");
    }
    const response = await fetch("/api/image/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: activeProvider,
        stepId: "alternatives",
        prompt,
        baseImageId,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error ?? "Image generation failed.");
    }
        
    const payload = (await response.json()) as {
      imageId: string;
      base64: string;
    };
    if (!payload.base64) {
      throw new Error("No image data returned.");
    }
    const saved = await saveGeneratedImageFromBase64({
      imageId: payload.imageId,
      base64: payload.base64,
      label: `Alternative ${alternativeImages.length + 1}`,
      note: prompt,
      userId: userKey,
    });
    if (!saved) {
      throw new Error("Unable to save generated image.");
    }
    const imageRecord = {
      id: saved.imageId,
      label: saved.label,
      note: saved.note,
      imageUrl: saved.downloadUrl,
      createdAt: saved.createdAt,
    };
    setLastGeneratedImageId(saved.imageId);
    return imageRecord;
  };
  
  const handleSend = async () => {
    if (!inputValue.trim()) {
      return;
    }
    if (lockedStages[activeStep.id]) {
      return;
    }
    setErrorMessage(null);
    const stepId = activeStep.id;
    const userMessage = inputValue.trim();
    setIsSending(true);
    setChatLogs((prev) => [
      ...prev,
      {
        stepId,
        provider: activeProvider,
        sender: "user",
        text: userMessage,
        label: role,
        createdAt: new Date().toISOString(),
      },
    ]);
    setInputValue("");

    try {
      if (stepId === "alternatives") {
        const intent = getStage3Intent(
          userMessage,
          Boolean(lastGeneratedImageId)
        );
        if (intent === "image_generate" || intent === "image_edit") {
         if (intent === "image_generate" && !siteImageConfigured) {
            setShowSiteImageWarning(true);
            throw new Error("Image generation requires a site image.");
          }
          if (
            intent === "image_edit" &&
            !(selectedAlternative || lastGeneratedImageId)
          ) {
            throw new Error("Select or generate an image before editing.");
          }

        
          setIsLoadingAlternatives(true);

          const baseId =
            intent === "image_edit"
              ? selectedAlternative ?? lastGeneratedImageId ?? undefined
              : undefined;
          
          const imageRecord = await requestGeneratedImage(
            userMessage,
            baseId
          );
        
          if (!imageRecord?.imageUrl) {
            throw new Error("Unable to generate the image.");
          }

          setChatLogs((prev) => [
            ...prev,
            {
              stepId,
              provider: activeProvider,
              sender: "assistant",
              text:
                intent === "image_edit"
                  ? selectedAlternative
                    ? "Updated the selected revision based on your request."
                    : "Updated the latest revision based on your request."
                  : "Generated a new concept image.",
              label: activeProvider,
              createdAt: new Date().toISOString(),
              imageUrl: imageRecord.imageUrl,
              imageId: imageRecord.id,
              imageLabel: imageRecord.label,
              imageNote: imageRecord.note,
            },
          ]);
        
          setIsLoadingAlternatives(false); 
          return;
        }
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
      setChatLogs((prev) => [
        ...prev,
        {
          stepId,
          provider: activeProvider,
          sender: "assistant",
          text: reply,
          label: activeProvider,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to connect to the LLM API."
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleCompleteStep = async () => {
    if (lockedStages[activeStep.id]) {
      setFinishNotice("This stage is locked. Contact the administrator.");
      return;
    }
    if (!userKey) {
      setFinishNotice("Authentication required.");
      return;
    }
    setSavedSummaries((prev) => ({
      ...prev,
      [activeStep.id]: stepSummaries[activeStep.id],
    }));
    setFinishNotice("Chat log sent to Report. Updating summaries...");
    setIsSummarizing(true);
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
        completedStages: nextCompletedStages,
      });
      if (stageSummary) {
        setSavedSummaries(mergedStageSummaries);
      }
      setCompletedStages(nextCompletedStages);
      setFinishNotice("Chat log sent to Report.");
    } catch (error) {
      setFinishNotice(
        error instanceof Error
          ? `Chat log sent, summary update failed: ${error.message}`
          : "Chat log sent, summary update failed."
      );
    } finally {
      setIsSummarizing(false);
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
      setShowSubmitNotice("Authentication required.");
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
    setHasInitializedAlternatives(true);
    setSelectedAlternative(null);
    setShowSubmitNotice("Your selected design has been submitted.");
    await handleCompleteStep();
  };

  const handleSubmitRankings = async () => {
    const payload = { submittedAt: new Date().toISOString(), rankings };
    setEvaluationResults((prev) => {
      const updated = [...prev, rankings];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          evaluationStorageKey,
          JSON.stringify(updated)
        );
      }
      return updated;
    });
    await sendEvaluationResult(payload);
    setShowSubmitNotice("Your rankings have been submitted.");
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
      }));
    }
    return evaluationImages.map((image) => {
      const scores = evaluationResults.map((result) => result[image.id] ?? 0);
      const average =
        scores.reduce((sum, value) => sum + value, 0) / scores.length;
      const topChoice = scores.filter((value) => value === 1).length;
      return {
        id: image.id,
        label: image.label,
        average,
        topChoice,
      };
    });
  }, [evaluationResults, evaluationImages]);

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

  const topPreference = useMemo(() => {
    const ranked = aggregatedResults.filter((result) => result.average > 0);
    if (!ranked.length) {
      return evaluationImages[0];
    }
    const best = [...ranked].sort((a, b) => a.average - b.average)[0];
    return evaluationImages.find((image) => image.id === best.id);
  }, [aggregatedResults, evaluationImages]);

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
        {activeStep.id === "alternatives" && stepLogs.length > 0 && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-slate-700">
            Based on our conversation, I generated design images for review.
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
          disabled={isSending || isStageLocked}
        >
          {isSending ? "Sending..." : "Send"}
        </button>
      </div>
      {errorMessage && (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-600">
          {errorMessage}
        </div>
      )}
      {finishNotice && (
        <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
          {finishNotice}
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
              Frame the PPSS objective, scope, and initial constraints before
              the model interaction.
            </p>
            <div className="mt-6 grid gap-4">
              <div className="h-48 rounded-2xl bg-gradient-to-br from-blue-100 via-white to-slate-100" />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                Component: Gearbox housing · Material: Al 7075-T6 · Key risk:
                fixture stability under high-speed milling.
              </div>
            </div>
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
                Review reference cases with clear, horizontal tab navigation.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { label: "Case Study A", value: "Case study" },
                  { label: "Case Study B", value: "Quality metrics" },
                  { label: "Case Study C", value: "Resource map" },
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
                <div className="h-48 rounded-2xl bg-gradient-to-br from-blue-100 via-white to-slate-100" />
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  {activeTab === "Case study" && (
                    <>
                      <p>
                        Site profile imagery and baseline narrative for the
                        reference case study.
                      </p>
                      <p>
                        Highlights of usage patterns and stakeholder feedback.
                      </p>
                    </>
                  )}
                  {activeTab === "Quality metrics" && (
                    <>
                      <p>
                        Control charts for critical dimensions and defect
                        rates.
                      </p>
                      <p>Variance snapshots for tooling accuracy.</p>
                    </>
                  )}
                  {activeTab === "Resource map" && (
                    <>
                      <p>
                        Resource allocation visuals for tooling and staffing.
                      </p>
                      <p>Material flow and staging layout notes.</p>
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
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Use the chat panel to request new alternatives or edit the latest
              concept image. Generated images will appear inline in the chat
              history and in the gallery below.
            </div>
            {isLoadingAlternatives && alternativeImages.length > 0 && (
            <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-[var(--primary)]" />
              Generating a new alternative…
            </div>
          )}
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {groupedAlternativeImages.length === 0 ? (
               <div className="flex flex-col items-center justify-center gap-3 py-6">
                {isLoadingAlternatives ? (
                  <>
                    <div className="relative h-10 w-10">
                      <div className="absolute inset-0 rounded-full border-4 border-slate-200" />
                      <div className="absolute inset-0 rounded-full border-4 border-[var(--primary)] border-t-transparent animate-spin" />
                    </div>
                    <span className="text-sm text-slate-500">
                      Generating design alternatives…
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-slate-500 text-center">
                    Generated images will appear here once you request them in the chat.
                  </span>
                )}
              </div>
            ) : (
                groupedAlternativeImages.map((group) => (
                  <div key={group.revisionLabel} className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      {group.revisionLabel}
                    </p>
                    {group.images.map((item) => (
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
                          aria-label={`Preview ${item.label}`}
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
                    ))}
                  </div>
                ))
              )}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                className="rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
                type="button"
                onClick={handleSubmitAlternative}
                disabled={!selectedAlternative}
              >
                submit your best design
              </button>
              <p className="text-xs text-slate-500">
                Submit a selected design to move it to the evaluation list.
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
              Review multiple evidence images and confirm risks with the model.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">
                      {image.label}
                    </span>
                    <div className="flex items-center gap-2">
                      <span>Rank</span>
                      <select
                        className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs"
                        value={String(rankings[image.id])}
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
                </div>
              ))}
            </div>
            <button
              className="mt-6 rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
              type="button"
              onClick={handleSubmitRankings}
            >
              Submit rankings
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
            <div className="mt-6 space-y-3">
              {[
                "Executive summary and scope overview.",
                "Risk assessment matrix and approval notes.",
                "Final recommended workflow and readiness score.",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
                >
                  {item}
                </div>
              ))}
            </div>
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
                <div className="mt-3 h-32 overflow-hidden rounded-xl bg-gradient-to-br from-blue-100 via-white to-slate-100">
                  {topPreference?.imageUrl && (
                    <img
                      src={topPreference.imageUrl}
                      alt={topPreference.label}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-700">
                  {topPreference?.label ?? "Top concept"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Highest-rated design based on submitted rankings.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-xs font-semibold uppercase text-slate-400">
                  Ranking overview
                </p>
                <div className="mt-3 space-y-3">
                  {aggregatedResults.map((result) => (
                    <div key={result.id} className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">
                          {result.label}
                        </span>
                        <span>
                          Avg rank {result.average.toFixed(1)} · Top choice{" "}
                          {result.topChoice}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-[var(--primary)]"
                          style={{
                            width: `${Math.max(
                              10,
                              100 - result.average * 10
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/70 px-4">
          <div className="w-full max-w-4xl rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between">
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
            <div className="mt-6">
              {selectedImageItem?.imageUrl ? (
                <img
                  src={selectedImageItem.imageUrl}
                  alt="Selected concept"
                  className="max-h-[80vh] w-full rounded-2xl bg-slate-50 object-contain"
                  loading="eager"
                />
              ) : (
                <div className="h-80 rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-100 via-white to-slate-100" />
              )}
            </div>
            {selectedImageItem?.note && (
              <p className="mt-4 text-sm text-slate-500">
                {selectedImageItem.note}
              </p>
            )}
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
      {showSubmitNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">
              Submission received
            </h3>
            <p className="mt-3 text-sm text-slate-500">{showSubmitNotice}</p>
            <button
              className="mt-6 w-full rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
              type="button"
              onClick={() => setShowSubmitNotice(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
