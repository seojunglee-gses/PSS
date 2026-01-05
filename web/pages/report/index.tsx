import AppShell from "../../components/AppShell";

const reportSections = [
  {
    title: "Process summary",
    detail:
      "Documented PPSS flow, parameter assumptions, and compliance checkpoints.",
  },
  {
    title: "ChatGPT annotations",
    detail:
      "Explanation of model-driven decisions and human reviewer notes.",
  },
  {
    title: "Verification outcomes",
    detail: "Risk ratings, inspection data, and approval signatures.",
  },
];

export default function Report() {
  return (
    <AppShell>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
          Report
        </p>
        <h2 className="text-3xl font-semibold">PPSS compliance report</h2>
        <p className="max-w-3xl text-sm text-slate-500">
          Export a structured report that documents the ChatGPT-assisted process
          planning workflow and supports audit-ready traceability.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Report composition</h3>
          <p className="mt-2 text-sm text-slate-500">
            Populate each section with approved content before exporting.
          </p>
          <div className="mt-6 space-y-4">
            {reportSections.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
              >
                <p className="text-sm font-semibold text-slate-700">
                  {item.title}
                </p>
                <p className="mt-2 text-sm text-slate-500">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Export options</h3>
          <p className="mt-2 text-sm text-slate-500">
            Select delivery format and metadata before generating the report.
          </p>
          <div className="mt-6 space-y-4 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                Report format
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  "PDF summary",
                  "Spreadsheet appendix",
                  "Audit trail log",
                ].map((option) => (
                  <span
                    key={option}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
                  >
                    {option}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                Review status
              </p>
              <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                All reviewers signed off on the PPSS checklist.
              </div>
            </div>
            <button className="w-full rounded-2xl bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700">
              Export report
            </button>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
