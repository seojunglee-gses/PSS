import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";

const workflowSteps = [
  "Problem Definition",
  "Data Analysis",
  "Design/Plan Alternatives",
  "Design/Plan Evaluation",
  "Design/Plan Decision",
];

const storageKey = "ppss-workspace-summaries";

export default function Report() {
  const [activeStep, setActiveStep] = useState(workflowSteps[0]);
  const [summaries, setSummaries] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      try {
        setSummaries(JSON.parse(stored));
      } catch {
        setSummaries({});
      }
    }
  }, []);

  const summaryEntries = useMemo(
    () =>
      workflowSteps.map((step, index) => ({
        step,
        summary:
          summaries[
            ["problem", "data", "alternatives", "evaluation", "report"][index]
          ] ?? "No summary recorded yet. Complete the step to save a summary.",
      })),
    [summaries]
  );

  const combinedSummary = summaryEntries
    .map((entry) => entry.summary)
    .join(" ");

  return (
    <AppShell>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-300">
          Report
        </p>
        <h2 className="text-3xl font-semibold">PPSS compliance report</h2>
        <p className="max-w-3xl text-sm text-slate-500">
          Review dialogue summaries, validate workflow outcomes, and export the
          PPSS report with full traceability.
        </p>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white px-6 py-6 shadow-sm">
        <h3 className="text-lg font-semibold">Workflow view</h3>
        <p className="mt-2 text-sm text-slate-500">
          Click any phase to preview the corresponding report content.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {workflowSteps.map((step) => {
            const isActive = step === activeStep;
            return (
              <button
                key={step}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  isActive
                    ? "bg-[var(--primary)] text-white"
                    : "border border-slate-200 bg-slate-50 text-slate-600 hover:border-[var(--primary)]"
                }`}
                type="button"
                onClick={() => setActiveStep(step)}
              >
                {step}
              </button>
            );
          })}
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-xs font-semibold uppercase text-slate-400">
              Selected phase
            </p>
            <p className="mt-3 text-lg font-semibold text-slate-800">
              {activeStep}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Review model-driven reasoning, stakeholder notes, and verification
              outcomes associated with this phase.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <p className="text-xs font-semibold uppercase text-slate-400">
              Report highlights
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>Consensus score updated for {activeStep.toLowerCase()}.</li>
              <li>Compliance checkpoints cleared by review team.</li>
              <li>Evidence package stored in audit trail.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold">Workspace Dialogue Summaries</h3>
        <p className="mt-2 text-sm text-slate-500">
          Consolidated narrative derived from the ChatGPT conversations across
          all workflow steps.
        </p>
        <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm text-slate-700">
          <p className="text-xs font-semibold uppercase text-blue-400">
            Overall summary
          </p>
          <p className="mt-3">
            {combinedSummary.trim()
              ? combinedSummary
              : "No dialogue summaries have been saved yet."}
          </p>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {summaryEntries.map((entry) => (
            <div
              key={entry.step}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4"
            >
              <p className="text-sm font-semibold text-slate-700">
                {entry.step}
              </p>
              <p className="mt-2 text-sm text-slate-600">{entry.summary}</p>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
