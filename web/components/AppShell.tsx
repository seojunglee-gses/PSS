import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactNode } from "react";

const navigation = [
  { label: "Home", href: "/" },
  { label: "Workspace", href: "/workspace" },
  { label: "Report", href: "/report" },
  { label: "Setting", href: "/setting" },
];

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="flex min-h-screen">
        <aside className="flex w-64 flex-col gap-6 border-r border-[var(--border)] bg-white px-6 py-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              PPSS Platform
            </p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight">
              ChatGPT-assisted
              <span className="block text-[var(--primary)]">PPSS</span>
            </h1>
          </div>
          <nav className="flex flex-col gap-2">
            {navigation.map((item) => {
              const isActive = router.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-xl px-4 py-3 text-sm font-medium transition ${
                    isActive
                      ? "bg-blue-50 text-[var(--primary)]"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto rounded-2xl border border-[var(--border)] bg-slate-50 p-4 text-xs text-slate-500">
            <p className="font-semibold text-slate-700">System Status</p>
            <p className="mt-2">Model: GPT-supported workflow</p>
            <p className="mt-1">Latency: 1.3s · Ready</p>
          </div>
        </aside>
        <main className="flex-1 px-8 py-10">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
