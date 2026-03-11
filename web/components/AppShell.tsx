import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useI18n, type Locale } from "../lib/i18n";

const navigation = [
  {
    labelKey: "nav.home",
    href: "/",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path
          d="M4 11.5L12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    labelKey: "nav.workspace",
    href: "/workspace",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <rect
          x="4"
          y="5"
          width="16"
          height="14"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M4 9h16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    ),
  },
  {
    labelKey: "nav.report",
    href: "/report",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path
          d="M7 4h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M14 4v4h4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    ),
  },
  {
    labelKey: "nav.setting",
    href: "/setting",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r="3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M4 12h2.2m11.6 0H20m-8-8v2.2m0 11.6V20m-5.7-2.8l1.6-1.6m8.2-8.2l1.6-1.6m-9.8 9.8l-1.6 1.6m8.2-8.2l-1.6 1.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const { user, signOutUser } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const [role, setRole] = useState<string>("Guest");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedRole = window.localStorage.getItem("ppss-role");
    if (storedRole) {
      setRole(storedRole);
    }
  }, []);

  const handleLogout = async () => {
    await signOutUser();
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("ppss-role");
    }
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 flex h-screen w-72 flex-col gap-6 bg-[var(--primary)] px-6 py-8 text-white shadow-lg">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-100">
              {t("shell.platform")}
            </p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight">
              {t("shell.title")}
              <span className="block text-blue-200">PPSS</span>
            </h1>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.3em] text-blue-100">
              {t("shell.role")} · {role}
            </p>
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-blue-100">
              {t("language.label")}
            </label>
            <select
              className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none"
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
            >
              <option className="text-slate-900" value="en">{t("language.en")}</option>
              <option className="text-slate-900" value="ko">{t("language.ko")}</option>
              <option className="text-slate-900" value="zh">{t("language.zh")}</option>
            </select>
          </div>
          <nav className="flex flex-col gap-2">
            {navigation.map((item) => {
              const isActive = router.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "text-blue-100 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span className="rounded-full bg-white/15 p-2 text-white">
                    {item.icon}
                  </span>
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto rounded-2xl border border-white/20 bg-white/10 p-4 text-xs text-blue-100">
            <p className="font-semibold text-white">{t("shell.systemStatus")}</p>
            <p className="mt-2">{t("shell.model")}</p>
            <p className="mt-1">{t("shell.latency")}</p>
          </div>
        </aside>
        <main className="flex-1 px-10 py-10">
          <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-white px-6 py-4 shadow-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-400">
                  {t("shell.signedInAs")}
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-800">
                  {role}
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <span>{user?.email ?? t("shell.notAuthenticated")}</span>
                {user && (
                  <button
                    className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                    type="button"
                    onClick={handleLogout}
                  >
                    {t("shell.logout")}
                  </button>
                )}
              </div>
            </div>
            <div className="flex w-full flex-col gap-8">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
