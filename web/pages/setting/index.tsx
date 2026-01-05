import AppShell from "../../components/AppShell";

const accessKeys = [
  {
    label: "Primary API key",
    value: "ppss-live-••••-9124",
    status: "Active",
  },
  {
    label: "Sandbox key",
    value: "ppss-test-••••-8842",
    status: "Paused",
  },
];

export default function Setting() {
  return (
    <AppShell>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
          Setting
        </p>
        <h2 className="text-3xl font-semibold">Personal code management</h2>
        <p className="max-w-3xl text-sm text-slate-500">
          Maintain secure access codes and authentication metadata for your
          PPSS workspace.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Access keys</h3>
          <p className="mt-2 text-sm text-slate-500">
            Review active keys and pause them when projects are archived.
          </p>
          <div className="mt-6 space-y-4">
            {accessKeys.map((key) => (
              <div
                key={key.label}
                className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-4"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    {key.label}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{key.value}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    key.status === "Active"
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {key.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Security preferences</h3>
          <p className="mt-2 text-sm text-slate-500">
            Adjust verification rules and update personal access codes.
          </p>
          <div className="mt-6 space-y-4 text-sm text-slate-600">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              Two-factor verification: Enabled
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              Key rotation interval: 90 days
            </div>
            <button className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:border-blue-500 hover:text-blue-600">
              Update access codes
            </button>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
