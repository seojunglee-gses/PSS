import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import { useAuth } from "../lib/auth";

const roles = [
  {
    title: "The Public",
    description: "Review shared PPSS updates and community impact summaries.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <circle
          cx="12"
          cy="8"
          r="3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M5 19c1.6-3 4.2-4.5 7-4.5s5.4 1.5 7 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: "Business Owners",
    description:
      "Coordinate manufacturing objectives and monitor process plan progress.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <rect
          x="5"
          y="4"
          width="14"
          height="16"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M9 9h6M9 13h6M9 17h4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: "Planners",
    description:
      "Develop prompt-driven plans, assess safety checks, and validate outputs.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <path
          d="M5 5h10l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M15 5v4h4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    ),
  },
  {
    title: "Government",
    description:
      "Audit compliance, review reports, and manage policy-driven oversight.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <path
          d="M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M12 4l7 4H5l7-4z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

export default function Home() {
  const router = useRouter();
  const { signIn, isConfigured, user } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (user) {
      router.push("/workspace");
    }
  }, [user, router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    if (!selectedRole) {
      setErrorMessage("Select a role before signing in.");
      return;
    }
    try {
      await signIn(email, password);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("ppss-role", selectedRole);
      }
      setShowLogin(false);
      router.push("/workspace");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to sign in. Please try again."
      );
    }
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

      <section className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
        {roles.map((role) => (
          <div
            key={role.title}
            className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm"
          >
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-8 border-slate-100 text-[var(--primary)]">
              {role.icon}
            </div>
            <h3 className="mt-6 text-lg font-semibold text-slate-900">
              {role.title}
            </h3>
            <p className="mt-2 text-sm text-slate-500">{role.description}</p>
            <button
              className="mt-6 rounded-full bg-[var(--primary)] px-6 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
              type="button"
              onClick={() => {
                setSelectedRole(role.title);
                setShowLogin(true);
              }}
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
                <p className="mt-2 text-sm text-slate-500">
                  Role: <span className="font-semibold">{selectedRole}</span>
                </p>
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
              {!isConfigured && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                  Firebase authentication is not configured. Provide
                  NEXT_PUBLIC_FIREBASE_* environment variables to enable login.
                </div>
              )}
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
              {errorMessage && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-600">
                  {errorMessage}
                </div>
              )}
              <button
                className="w-full rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
                type="submit"
                disabled={!isConfigured}
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
