import { useRouter } from "next/router";
import { useState } from "react";
import AppShell from "../components/AppShell";

const roles = [
  {
    title: "The Public",
    description: "Review shared PPSS updates and community impact summaries.",
  },
  {
    title: "Business Owners",
    description:
      "Coordinate manufacturing objectives and monitor process plan progress.",
  },
  {
    title: "Planners",
    description:
      "Develop prompt-driven plans, assess safety checks, and validate outputs.",
  },
  {
    title: "Government",
    description:
      "Audit compliance, review reports, and manage policy-driven oversight.",
  },
];

export default function Home() {
  const router = useRouter();
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setShowLogin(false);
    router.push("/workspace");
  };

  return (
    <AppShell>
      <section className="flex flex-col gap-3">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-300">
          Home
        </p>
        <h2 className="text-3xl font-semibold text-slate-900">
          ChatGPT-assisted PPSS portal
        </h2>
        <p className="max-w-3xl text-sm text-slate-500">
          Select your role to sign in and access the PPSS platform, matching the
          stakeholder flow presented in the study.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-4">
        {roles.map((role) => (
          <div
            key={role.title}
            className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm"
          >
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-8 border-slate-100 text-3xl font-semibold text-[var(--primary)]">
              {role.title.slice(0, 1)}
            </div>
            <h3 className="mt-6 text-lg font-semibold text-slate-900">
              {role.title}
            </h3>
            <p className="mt-2 text-sm text-slate-500">{role.description}</p>
            <button
              className="mt-6 rounded-full bg-[var(--primary)] px-6 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
              type="button"
              onClick={() => setShowLogin(true)}
            >
              Sign in
            </button>
          </div>
        ))}
      </section>

      {showLogin && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-400">
                  Secure access
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-900">
                  Sign in to Workspace
                </h3>
              </div>
              <button
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 hover:border-slate-300"
                type="button"
                onClick={() => setShowLogin(false)}
              >
                Close
              </button>
            </div>
            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">
                  Email
                </label>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-[var(--primary)] focus:outline-none"
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
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-[var(--primary)] focus:outline-none"
                  placeholder="••••••••"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              <button
                className="w-full rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
                type="submit"
              >
                Continue to Workspace
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
