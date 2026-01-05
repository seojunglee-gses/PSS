import { useState } from "react";
import AppShell from "../../components/AppShell";

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
    title: "Design/Plan Evaluation",
    icon: "⑤",
  },
];

const chatMessages = [
  {
    sender: "Planner",
    text: "We need a PPSS plan for the gearbox housing with safety constraints.",
  },
  {
    sender: "ChatGPT",
    text: "Confirmed. I will generate a phased plan with validation checkpoints.",
  },
  {
    sender: "Planner",
    text: "Highlight fixture stability and tool access risks.",
  },
];

export default function Workspace() {
  const [activeStep, setActiveStep] = useState(steps[0]);
  const [activeTab, setActiveTab] = useState("Process log");

  const renderChatPanel = () => (
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
        {chatMessages.map((message, index) => (
          <div
            key={`${message.sender}-${index}`}
            className={`rounded-2xl border px-4 py-3 ${
              message.sender === "ChatGPT"
                ? "border-blue-100 bg-blue-50 text-slate-700"
                : "border-slate-200 bg-white"
            }`}
          >
            <p className="text-xs font-semibold uppercase text-slate-400">
              {message.sender}
            </p>
            <p className="mt-2">{message.text}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <input
          className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-sm focus:border-[var(--primary)] focus:outline-none"
          placeholder="Send a prompt to the PPSS assistant..."
        />
        <button className="rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]">
          Send
        </button>
      </div>
    </div>
  );

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
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[1, 2, 3, 4].map((item) => (
                <div
                  key={item}
                  className="h-28 rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-100 via-white to-slate-100"
                />
              ))}
            </div>
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
          </div>
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Evidence &amp; statistics</h3>
            <p className="mt-2 text-sm text-slate-500">
              Visual evidence and key metrics supporting the evaluation.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="h-28 rounded-2xl bg-gradient-to-br from-blue-100 via-white to-slate-100" />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Compliance score: 92% · Risk alerts: 2 open items
              </div>
              <div className="h-28 rounded-2xl bg-gradient-to-br from-blue-100 via-white to-slate-100" />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Average review time: 3.8 days · Reviewer count: 5
              </div>
            </div>
          </div>
        </section>
      )}
    </AppShell>
  );
}
