import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { sendEvaluationResult } from "../../lib/firebase";

const steps = [
  {
    id: "problem",
    title: "Problem Definition",
    icon: "①",
  },
  {
    id: "data",
    title: "Data Analysis",
    icon: "②",
  },
  {
    id: "alternatives",
    title: "Design/Plan Alternatives",
    icon: "③",
  },
  {
    id: "evaluation",
    title: "Design/Plan Evaluation",
    icon: "④",
  },
  {
    id: "report",
    title: "Design/Plan Decision",
    icon: "⑤",
  },
];

const initialMessages = [
  "We need a PPSS plan for the gearbox housing with safety constraints.",
  "Confirmed. I will generate a phased plan with validation checkpoints.",
  "Highlight fixture stability and tool access risks.",
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
const evaluationImages = Array.from({ length: 7 }, (_, index) => ({
  id: `concept-${index + 1}`,
  label: `Concept ${index + 1}`,
}));
const rankingOptions = ["1", "2", "3", "4", "5", "6", "7"];

export default function Workspace() {
  const [activeStep, setActiveStep] = useState(steps[0]);
  const [activeTab, setActiveTab] = useState("Process log");
  const [inputValue, setInputValue] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [rankings, setRankings] = useState<Record<string, number>>(() => {
    const initialState: Record<string, number> = {};
    evaluationImages.forEach((image, index) => {
      initialState[image.id] = index + 1;
    });
    return initialState;
  });
  const [evaluationResults, setEvaluationResults] = useState<
    Array<Record<string, number>>
  >([]);
  const [messages, setMessages] = useState<Record<string, string[]>>(() => {
    const initialState: Record<string, string[]> = {};
    steps.forEach((step) => {
      initialState[step.id] = [...initialMessages];
    });
    return initialState;
  });
  const [savedSummaries, setSavedSummaries] = useState<
    Record<string, string>
  >({});

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

  const progressValue = useMemo(() => {
    const index = steps.findIndex((step) => step.id === activeStep.id);
    if (index === -1) {
      return 0;
    }
    return Math.round((index / (steps.length - 1)) * 100);
  }, [activeStep.id]);

  const handleSend = () => {
    if (!inputValue.trim()) {
      return;
    }
    const stepId = activeStep.id;
    setMessages((prev) => ({
      ...prev,
      [stepId]: [...prev[stepId], inputValue.trim()],
    }));
    setInputValue("");
  };

  const handleCompleteStep = () => {
    setSavedSummaries((prev) => ({
      ...prev,
      [activeStep.id]: stepSummaries[activeStep.id],
    }));
  };

  const handleRankingChange = (imageId: string, value: string) => {
    setRankings((prev) => ({
      ...prev,
      [imageId]: Number(value),
    }));
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
  };

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
  }, [evaluationResults]);

  const renderChatPanel = () => {
    const stepMessages = messages[activeStep.id] ?? [];
    return (
    <div className="flex h-full flex-col rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-400">
            ChatGPT
          </p>
          <h3 className="mt-2 text-lg font-semibold">API conversation</h3>
        </div>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[var(--primary)]">
          Connected
        </span>
      </div>
      <div className="mt-4 flex-1 space-y-4 overflow-auto text-sm text-slate-600">
        {stepMessages.map((message, index) => {
          const isAssistant = index % 2 === 1;
          return (
            <div
              key={`${activeStep.id}-${index}`}
              className={`rounded-2xl border px-4 py-3 ${
                isAssistant
                  ? "border-blue-100 bg-blue-50 text-slate-700"
                  : "border-slate-200 bg-white"
              }`}
            >
              <p className="text-xs font-semibold uppercase text-slate-400">
                {isAssistant ? "ChatGPT" : "Planner"}
              </p>
              <p className="mt-2">{message}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <input
          className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-sm focus:border-[var(--primary)] focus:outline-none"
          placeholder="Send a prompt to the PPSS assistant..."
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          className="rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
          type="button"
          onClick={handleSend}
        >
          Send
        </button>
      </div>
      <button
        className="mt-4 rounded-full border border-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary)] hover:bg-blue-50"
        type="button"
        onClick={handleCompleteStep}
      >
        단계 종료
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
          Navigate through the five-step planning workflow and monitor progress
          with a live ChatGPT-powered conversation panel.
        </p>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white px-6 py-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {steps.map((step) => {
            const isActive = step.id === activeStep.id;
            return (
              <button
                key={step.id}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                  isActive
                    ? "bg-[var(--primary)] text-white shadow-md"
                    : "border border-slate-200 bg-slate-50 text-slate-600 hover:border-[var(--primary)]"
                }`}
                type="button"
                onClick={() => setActiveStep(step)}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-base ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "bg-white text-[var(--primary)]"
                  }`}
                >
                  {step.icon}
                </span>
                <span className="max-w-[140px]">{step.title}</span>
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
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Data Analysis</h3>
            <p className="mt-2 text-sm text-slate-500">
              Review historical metrics, inspection data, and resource inputs.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {["Process log", "Quality metrics", "Resource map"].map((tab) => {
                const isActive = tab === activeTab;
                return (
                  <button
                    key={tab}
                    className={`rounded-full px-4 py-2 text-xs font-semibold ${
                      isActive
                        ? "bg-[var(--primary)] text-white"
                        : "border border-slate-200 bg-slate-50 text-slate-500"
                    }`}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 grid gap-3">
              {[
                "Cycle time distribution and bottleneck markers.",
                "Inspection variance for critical dimensions.",
                "Resource utilization across machine cells.",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
          {renderChatPanel()}
        </section>
      )}

      {activeStep.id === "alternatives" && (
        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Design/Plan Alternatives</h3>
            <p className="mt-2 text-sm text-slate-500">
              Compare ChatGPT-generated alternatives and capture visual
              references for each plan.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {["Alternative A", "Alternative B"].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="h-32 rounded-xl bg-gradient-to-br from-blue-100 via-white to-slate-100" />
                  <p className="mt-3 text-sm font-semibold text-slate-700">
                    {item}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Generated PPSS path with updated tooling assumptions.
                  </p>
                </div>
              ))}
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
                    className="h-28 w-full rounded-xl bg-gradient-to-br from-blue-100 via-white to-slate-100"
                    type="button"
                    onClick={() => setSelectedImage(image.id)}
                  />
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
              단계 종료
            </button>
          </div>
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Evidence &amp; statistics</h3>
            <p className="mt-2 text-sm text-slate-500">
              Visual evidence and key metrics supporting the evaluation.
            </p>
            <div className="mt-6 space-y-4">
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
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600">
                <p className="text-xs font-semibold uppercase text-slate-400">
                  Preference table
                </p>
                <table className="mt-3 w-full text-left text-xs">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="pb-2">Design</th>
                      <th className="pb-2">Avg rank</th>
                      <th className="pb-2">Top votes</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-600">
                    {aggregatedResults.map((result) => (
                      <tr key={result.id} className="border-t border-slate-100">
                        <td className="py-2">{result.label}</td>
                        <td className="py-2">{result.average.toFixed(1)}</td>
                        <td className="py-2">{result.topChoice}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}
      {selectedImage && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/70 px-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-400">
                  Design preview
                </p>
                <h3 className="mt-2 text-xl font-semibold">
                  {evaluationImages.find((image) => image.id === selectedImage)
                    ?.label ?? "Design concept"}
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
            <div className="mt-6 h-80 rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-100 via-white to-slate-100" />
            <p className="mt-4 text-sm text-slate-500">
              Inspect the design concept in detail before assigning a ranking.
            </p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
