import { useCallback, useEffect, useState } from "react";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../lib/auth";
import {
  loadChatLogsFromFirestore,
  loadLatestExecutiveSummariesByStage,
  loadWorkspaceSummary,
} from "../../lib/firebase";

const workflowSteps = [
  "Problem Definition",
  "Data Analysis",
  "Design/Plan Alternatives",
  "Design/Plan Evaluation",
  "Design/Plan Decision",
];

const stepIds = ["problem", "data", "alternatives", "evaluation", "report"];

type ChatLog = {
  stepId: string;
  provider: string;
  sender: "Planner" | "ChatGPT" | "user" | "assistant";
  text: string;
  label?: string;
  createdAt?: string;
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

type WorkspaceSummary = {
  stageSummaries: Record<string, string>;
  overallSummary: string;
};

const extractConclusion = (summary?: string) => {
  if (!summary) {
    return summary;
  }
  const lines = summary.split(/\n+/);
  const conclusionLine = lines.find((line) =>
    /^(conclusion|결론)\s*[:：]/i.test(line.trim())
  );
  if (conclusionLine) {
    return conclusionLine.replace(/^(conclusion|결론)\s*[:：]\s*/i, "");
  }
  return summary;
};

const renderFormattedSummary = (summary?: string) => {
  if (!summary) {
    return null;
  }
  return summary.split(/\n+/).map((line, lineIndex) => {
    const parts = line
      .split(/(\*\*[^*]+\*\*)/g)
      .filter(Boolean)
      .map((part, partIndex) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={`${lineIndex}-${partIndex}`}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={`${lineIndex}-${partIndex}`}>{part}</span>;
      });
    return (
      <p key={lineIndex} className="text-sm text-slate-600 leading-relaxed">
        {parts}
      </p>
    );
  });
};

export default function Report() {
  const { user } = useAuth();
  const userKey = user?.uid;
  const [activeStep] = useState(workflowSteps[0]);
  const [chatLogs, setChatLogs] = useState<ChatLog[]>([]);
  const [executiveSummary, setExecutiveSummary] =
    useState<ExecutiveSummary | null>(null);
  const [workspaceSummary, setWorkspaceSummary] =
    useState<WorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshSummaries = useCallback(async () => {
    if (!userKey) {
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      const summary = await loadWorkspaceSummary(userKey);
      if (summary) {
        setWorkspaceSummary(summary);
      } else {
        setWorkspaceSummary(null);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load saved summaries."
      );
    } finally {
      setLoading(false);
    }
  }, [userKey]);

  useEffect(() => {
    if (!userKey) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const loadData = async () => {
      const logs = await loadChatLogsFromFirestore<ChatLog[]>(userKey);
      if (logs) {
        setChatLogs(logs);
      }
      const summary = await loadWorkspaceSummary(userKey);
      if (summary) {
        setWorkspaceSummary(summary);
      }
      const executive = await loadLatestExecutiveSummariesByStage();
      if (executive) {
        setExecutiveSummary(executive);
      }
    };
    loadData();
  }, [userKey]);


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
                  (step === "Problem Definition" &&
                    executiveSummary?.stageSummaries.problemDefinition) ||
                  (step === "Data Analysis" &&
                    executiveSummary?.stageSummaries.dataAnalysis) ||
                  (step === "Design/Plan Alternatives" &&
                    executiveSummary?.stageSummaries.designAlternatives) ||
                  (step === "Design/Plan Evaluation" &&
                    executiveSummary?.stageSummaries.designEvaluation) ||
                  (step === "Design/Plan Decision" &&
                    executiveSummary?.stageSummaries.decision) ||
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
            <div className="mt-2 space-y-2">
              {executiveSummary?.stageSummaries.problemDefinition
                ? renderFormattedSummary(
                    extractConclusion(
                      executiveSummary.stageSummaries.problemDefinition
                    )
                  )
                : "Refresh to generate stakeholder comparisons."}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-sm font-semibold text-slate-700">
              Data Analysis
            </p>
            <div className="mt-2 space-y-2">
              {executiveSummary?.stageSummaries.dataAnalysis
                ? renderFormattedSummary(
                    extractConclusion(
                      executiveSummary.stageSummaries.dataAnalysis
                    )
                  )
                : "Refresh to generate lessons learned."}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-sm font-semibold text-slate-700">
              Design Alternatives
            </p>
            <div className="mt-2 space-y-2">
              {executiveSummary?.stageSummaries.designAlternatives
                ? renderFormattedSummary(
                    extractConclusion(
                      executiveSummary.stageSummaries.designAlternatives
                    )
                  )
                : "Refresh to generate design intent keywords."}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-sm font-semibold text-slate-700">
              Design Evaluation
            </p>
            <div className="mt-2 space-y-2">
              {executiveSummary?.stageSummaries.designEvaluation
                ? renderFormattedSummary(
                    extractConclusion(
                      executiveSummary.stageSummaries.designEvaluation
                    )
                  )
                : "Refresh to generate evaluation feedback."}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">
              Workspace Dialogue Summaries
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Personalized summaries saved when you finish each stage.
            </p>
          </div>
          <button
            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 hover:border-[var(--primary)] hover:text-[var(--primary)]"
            type="button"
            onClick={() => refreshSummaries()}
            aria-label="Reload saved summaries"
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
        <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm text-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase text-blue-400">
              Overall summary
            </p>
            <span className="text-xs text-slate-500">
              {loading ? "Loading..." : "Synced from Firestore"}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {workspaceSummary?.overallSummary
              ? renderFormattedSummary(
                  extractConclusion(workspaceSummary.overallSummary)
                )
              : "Finish a stage to generate your overall summary."}
          </div>
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
              <p className="text-sm font-semibold text-slate-700">{step}</p>
              <div className="mt-2 space-y-2">
                {workspaceSummary?.stageSummaries[stepIds[index]]
                  ? renderFormattedSummary(
                      extractConclusion(
                        workspaceSummary?.stageSummaries[stepIds[index]]
                      )
                    )
                  : "Finish the stage to generate your summary."}
              </div>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
