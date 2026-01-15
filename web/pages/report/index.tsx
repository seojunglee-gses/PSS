import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../lib/auth";

const workflowSteps = [
  "Problem Definition",
  "Data Analysis",
  "Design/Plan Alternatives",
  "Design/Plan Evaluation",
  "Design/Plan Decision",
];

const chatLogStorageKey = "ppss-chat-logs";
const stepIds = ["problem", "data", "alternatives", "evaluation", "report"];
const sharedSummariesKey = "ppss-shared-summaries";
const workspaceSummaryStorageKey = "ppss-workspace-summary";

type ChatLog = {
  stepId: string;
  provider: string;
  sender: "Planner" | "ChatGPT" | "user" | "assistant";
  text: string;
  label?: string;
};

type SharedSummary = {
  stepId: string;
  summary: string;
  userId: string;
  role: string;
  submittedAt: string;
};

type ExecutiveSummary = {
  keywords: string[];
  currentStage: string;
  stageSummaries: {
    problemDefinition: string;
    dataAnalysis: string;
    designAlternatives: string;
    designEvaluation: string;
    decision: string;
  };
};

type WorkspaceSummary = {
  stageSummaries: Record<string, string>;
  overallSummary: string;
};

export default function Report() {
  const { user } = useAuth();
  const userKey = user?.uid ?? "anonymous";
  const [activeStep, setActiveStep] = useState(workflowSteps[0]);
  const [chatLogs, setChatLogs] = useState<ChatLog[]>([]);
  const [sharedSummaries, setSharedSummaries] = useState<SharedSummary[]>([]);
  const [executiveSummary, setExecutiveSummary] =
    useState<ExecutiveSummary | null>(null);
  const [workspaceSummary, setWorkspaceSummary] =
    useState<WorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const groupedSharedSummaries = useMemo(() => {
    return sharedSummaries.reduce<Record<string, Record<string, string[]>>>(
      (acc, entry) => {
        acc[entry.stepId] = acc[entry.stepId] || {};
        acc[entry.stepId][entry.role] =
          acc[entry.stepId][entry.role] || [];
        acc[entry.stepId][entry.role].push(entry.summary);
        return acc;
      },
      {}
    );
  }, [sharedSummaries]);

  const groupedUserLogs = useMemo(() => {
    return stepIds.reduce<Record<string, string[]>>((acc, stepId) => {
      acc[stepId] = chatLogs
        .filter((log) => log.stepId === stepId)
        .map((log) => log.text);
      return acc;
    }, {});
  }, [chatLogs]);

  const refreshSummaries = useCallback(async (stage = activeStep) => {
    if (!user) {
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentStage: stage,
          executiveInput: groupedSharedSummaries,
          workspaceInput: groupedUserLogs,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Summary generation failed.");
      }
      const payload = (await response.json()) as {
        executiveSummary: ExecutiveSummary;
        workspaceSummary: WorkspaceSummary;
      };
      setExecutiveSummary(payload.executiveSummary);
      setWorkspaceSummary(payload.workspaceSummary);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          workspaceSummaryStorageKey,
          JSON.stringify(payload.workspaceSummary)
        );
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to refresh summaries. Check API connectivity."
      );
    } finally {
      setLoading(false);
    }
  }, [user, activeStep, groupedSharedSummaries, groupedUserLogs]);

  useEffect(() => {
    if (!user) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(
      `${chatLogStorageKey}-${userKey}`
    );
    if (stored) {
      try {
        setChatLogs(JSON.parse(stored));
      } catch {
        setChatLogs([]);
      }
    }
    const shared = window.localStorage.getItem(sharedSummariesKey);
    if (shared) {
      try {
        setSharedSummaries(JSON.parse(shared));
      } catch {
        setSharedSummaries([]);
      }
    }
    const storedWorkspaceSummary = window.localStorage.getItem(
      workspaceSummaryStorageKey
    );
    if (storedWorkspaceSummary) {
      try {
        setWorkspaceSummary(JSON.parse(storedWorkspaceSummary));
      } catch {
        setWorkspaceSummary(null);
      }
    }
  }, [user, userKey]);

  useEffect(() => {
    if (user) {
      refreshSummaries();
    }
  }, [refreshSummaries, user]);

  return (
    <AppShell>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-300">
          Report
        </p>
        <h2 className="text-3xl font-semibold">PPSS compliance report</h2>
        <p className="max-w-3xl text-sm text-slate-500">
          Executive summaries are generated from all users’ dialogues, while
          workspace summaries reflect the currently logged-in user.
        </p>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white px-6 py-6 shadow-sm">
        <h3 className="text-lg font-semibold">Executive Summary</h3>
        <p className="mt-2 text-sm text-slate-500">
          Global insight generated from all stakeholder dialogues.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-xs font-semibold uppercase text-slate-400">
              Project key keywords
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
                  Keywords will appear after refresh.
                </span>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <p className="text-xs font-semibold uppercase text-slate-400">
              Current workflow view
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {workflowSteps.map((step) => {
                const isActive =
                  executiveSummary?.currentStage === step ||
                  (!executiveSummary && step === activeStep);
                return (
                  <span
                    key={step}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      isActive
                        ? "bg-[var(--primary)] text-white"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {step}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-sm font-semibold text-slate-700">
              Problem Definition
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {executiveSummary?.stageSummaries.problemDefinition ??
                "Refresh to generate stakeholder comparisons."}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-sm font-semibold text-slate-700">
              Data Analysis
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {executiveSummary?.stageSummaries.dataAnalysis ??
                "Refresh to generate lessons learned."}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-sm font-semibold text-slate-700">
              Design Alternatives
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {executiveSummary?.stageSummaries.designAlternatives ??
                "Refresh to generate design intent keywords."}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-sm font-semibold text-slate-700">
              Design Evaluation
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {executiveSummary?.stageSummaries.designEvaluation ??
                "Refresh to generate evaluation feedback."}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
        <div>
          <h3 className="text-lg font-semibold">
            Workspace Dialogue Summaries
          </h3>
          <p className="mt-2 text-sm text-slate-500">
            Personalized summaries generated from your dialogue history.
          </p>
        </div>
        <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm text-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase text-blue-400">
              Overall summary
            </p>
            <button
              className="rounded-full bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--primary-dark)]"
              type="button"
              onClick={() => refreshSummaries()}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh summaries"}
            </button>
          </div>
          <p className="mt-3">
            {workspaceSummary?.overallSummary ??
              "Refresh to generate your overall summary."}
          </p>
          {errorMessage && (
            <p className="mt-3 text-xs text-rose-600">{errorMessage}</p>
          )}
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {workflowSteps.map((step, index) => (
            <div
              key={step}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-700">{step}</p>
                <button
                  className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  type="button"
                  onClick={() => {
                    setActiveStep(step);
                    refreshSummaries(step);
                  }}
                  aria-label={`Refresh ${step} summary`}
                  disabled={loading}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 12a8 8 0 1 1-2.3-5.7" />
                    <path d="M20 4v6h-6" />
                  </svg>
                </button>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {workspaceSummary?.stageSummaries[stepIds[index]] ??
                  "Refresh to generate your stage summary."}
              </p>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
