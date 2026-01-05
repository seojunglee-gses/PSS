import AppShell from "../../components/AppShell";

const activity = [
  {
    title: "Prompt context",
    detail: "Gearbox housing machining, aluminum alloy, 8 steps",
  },
  {
    title: "ChatGPT recommendation",
    detail: "Sequence optimized for fixturing stability and cutter path safety.",
  },
  {
    title: "PPSS validation",
    detail: "8/8 checks completed · 2 advisories pending",
  },
];

export default function Workspace() {
  return (
    <AppShell>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
          Workspace
        </p>
        <h2 className="text-3xl font-semibold">Active planning session</h2>
        <p className="max-w-3xl text-sm text-slate-500">
          Collaboratively build the process plan, review the ChatGPT-generated
          plan, and finalize PPSS verification for reporting.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {activity.map((item) => (
          <div
            key={item.title}
            className="rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase text-slate-400">
              {item.title}
            </p>
            <p className="mt-3 text-sm font-medium text-slate-700">
              {item.detail}
            </p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-6">
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Prompt design panel</h3>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                Step 1
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Provide machining objectives, constraints, and key material
              details before generating the process plan.
            </p>
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                Material: Al 7075-T6 · Machine: 5-axis machining center
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                Surface tolerance: ±0.01 mm · Coolant: flood
              </div>
              <textarea
                className="h-32 w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="Summarize additional constraints and safety notes..."
              />
              <button className="w-full rounded-2xl bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700">
                Generate PPSS Draft
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Process monitoring</h3>
            <p className="mt-2 text-sm text-slate-500">
              Track ChatGPT revisions and share improvements with collaborators.
            </p>
            <div className="mt-5 space-y-3 text-sm text-slate-600">
              <div className="rounded-2xl border border-slate-200 px-4 py-3">
                Revision 1: Revised roughing order to reduce vibration.
              </div>
              <div className="rounded-2xl border border-slate-200 px-4 py-3">
                Revision 2: Added tool change verification before finish pass.
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold">ChatGPT response</h3>
            <p className="mt-2 text-sm text-slate-500">
              Generated PPSS sequence aligned with the study methodology.
            </p>
            <ol className="mt-5 space-y-3 text-sm text-slate-600">
              {[
                "Fixture alignment and zero-point calibration",
                "Rough milling on outer profile",
                "Pocketing and cavity roughing",
                "Finishing on functional surfaces",
                "Dimensional inspection and deburring",
              ].map((item, index) => (
                <li
                  key={item}
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                >
                  <span className="mr-2 font-semibold text-slate-700">
                    {index + 1}.
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Decision support</h3>
            <p className="mt-2 text-sm text-slate-500">
              Safety validation and readiness scoring for PPSS approval.
            </p>
            <div className="mt-5 space-y-3">
              {[
                "Fixture stability verified",
                "Tool access clear",
                "Coolant flow adequate",
                "Operator confirmation pending",
              ].map((item, index) => (
                <div
                  key={item}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                >
                  <span>{item}</span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      index < 3
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-amber-50 text-amber-600"
                    }`}
                  >
                    {index < 3 ? "Verified" : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
