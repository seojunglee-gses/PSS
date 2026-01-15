import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";

type Step =
  | "PlanDecision"
  | "DataAnalysis"
  | "DesignAlternatives"
  | "DesignEvaluation";

type ChatLog = {
  id: string;
  role: "user" | "assistant"; // UI 정렬 기준
  label: string;             // 화면에 보이는 이름
  message: string;
  step: Step;
};

const STEP_LABELS: Record<Step, string> = {
  PlanDecision: "Plan Decision",
  DataAnalysis: "Data Analysis",
  DesignAlternatives: "Design / Plan Alternatives",
  DesignEvaluation: "Design / Plan Evaluation",
};

const DEFAULT_PROMPTS: Record<Step, string> = {
  PlanDecision:
    "From your perspective, what is the most important issue in this project?",
  DataAnalysis:
    "What stands out to you in this data?",
  DesignAlternatives:
    "Based on our talks, I generated images you might like. How do you think?",
  DesignEvaluation:
    "Which design seems interesting and why?",
};

export default function Workspace() {
  const [currentStep, setCurrentStep] = useState<Step>("PlanDecision");
  const [logs, setLogs] = useState<ChatLog[]>([]);
  const [input, setInput] = useState("");

  const userLabel =
    typeof window !== "undefined"
      ? localStorage.getItem("ppss-role") ?? "User"
      : "User";

  const llmLabel = "GPT-4.1-mini";

  /** 초기 진입 시 기본 질문 생성 */
  useEffect(() => {
    setLogs([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        label: llmLabel,
        message: DEFAULT_PROMPTS[currentStep],
        step: currentStep,
      },
    ]);
  }, [currentStep]);

  /** 사용자 메시지 추가 */
  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: ChatLog = {
      id: crypto.randomUUID(),
      role: "user",
      label: userLabel,
      message: input,
      step: currentStep,
    };

    setLogs((prev) => [...prev, userMessage]);
    setInput("");

    // 🔗 API 호출
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: input,
        stepId: currentStep,
        model: llmLabel,
      }),
    });

    const data = await res.json();

    const assistantMessage: ChatLog = {
      id: crypto.randomUUID(),
      role: "assistant",
      label: llmLabel,
      message: data.reply ?? "No response.",
      step: currentStep,
    };

    setLogs((prev) => [...prev, assistantMessage]);
  };

  return (
    <AppShell>
      {/* 헤더 */}
      <section className="mb-6">
        <h2 className="text-2xl font-semibold text-slate-900">
          Workspace
        </h2>
        <p className="text-sm text-slate-500">
          {STEP_LABELS[currentStep]}
        </p>
      </section>

      {/* 단계 선택 */}
      <div className="mb-4 flex gap-2">
        {(Object.keys(STEP_LABELS) as Step[]).map((step) => (
          <button
            key={step}
            onClick={() => setCurrentStep(step)}
            className={`rounded-full px-4 py-1 text-sm font-semibold ${
              currentStep === step
                ? "bg-[var(--primary)] text-white"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {STEP_LABELS[step]}
          </button>
        ))}
      </div>

      {/* 채팅 로그 */}
      <div className="flex h-[60vh] flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4">
        {logs.map((log) => (
          <div
            key={log.id}
            className={`flex ${
              log.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm shadow ${
                log.role === "user"
                  ? "bg-[var(--primary)] text-white"
                  : "bg-slate-100 text-slate-900"
              }`}
            >
              <div className="mb-1 text-xs font-semibold opacity-70">
                {log.label}
              </div>
              <div>{log.message}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 입력창 */}
      <div className="mt-4 flex gap-2">
        <input
          className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-[var(--primary)] focus:outline-none"
          placeholder="Type your response…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button
          onClick={sendMessage}
          className="rounded-xl bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
        >
          Send
        </button>
      </div>
    </AppShell>
  );
}
