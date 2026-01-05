import { useRouter } from "next/router";
import { useState } from "react";
import AppShell from "../components/AppShell";

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push("/workspace");
  };

  return (
    <AppShell>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
          Home
        </p>
        <h2 className="text-3xl font-semibold">
          Welcome to the ChatGPT-assisted PPSS platform
        </h2>
        <p className="max-w-2xl text-sm text-slate-500">
          Use the platform to orchestrate prompt-driven process planning, safety
          validation, and report generation based on the workflow outlined in
          the referenced study.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Secure access</h3>
          <p className="mt-2 text-sm text-slate-500">
            Sign in to manage your workspace sessions and synchronize prompt
            histories across projects.
          </p>
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="text-xs font-semibold uppercase text-slate-500">
                Email
              </label>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="analyst@ppss-lab.com"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-slate-500">
                Password
              </label>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="••••••••"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <button
              className="w-full rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700"
              type="submit"
            >
              Log in to Workspace
            </button>
          </form>
        </div>

        <div className="rounded-3xl border border-[var(--border)] bg-gradient-to-br from-blue-50 via-white to-slate-50 p-6">
          <h3 className="text-lg font-semibold">Project overview</h3>
          <p className="mt-2 text-sm text-slate-500">
            Monitor the PPSS lifecycle from prompt design to assessment results
            and compliance reporting.
          </p>
          <div className="mt-6 grid gap-4">
            {[
              "Prompt design briefing",
              "ChatGPT synthesis",
              "Process plan refinement",
              "Safety checklist approval",
            ].map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <h3 className="text-xl font-semibold">Figure 5-inspired layout</h3>
          <p className="text-sm text-slate-500">
            The core workspace is arranged into prompt input, response
            monitoring, and decision-support panels to mirror the study
            prototype.
          </p>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.9fr_0.9fr]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase text-slate-400">
              Prompt design
            </p>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                Input parameters, process constraints, and material context.
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                Safety requirements and quality targets.
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-slate-400">
              ChatGPT response
            </p>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <p>
                Draft PPSS sequence with step-by-step machining decisions.
              </p>
              <p>
                Automatically generated process parameters and tooling notes.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-slate-400">
              Decision support
            </p>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <p>Risk scoring and verification checklist.</p>
              <p>Recommendation summary for final approval.</p>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
