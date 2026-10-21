import { useI18n } from "../../lib/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/router";
import AppShell from "../AppShell";
import { useAuth } from "../../lib/auth";
import { useProject } from "../../lib/projects";
import {
  projectRequest,
  ProjectRequestError,
} from "../../lib/membership/client";
export default function ProjectAccessGate({
  children,
}: {
  children: ReactNode;
}) {
  const { t, localize } = useI18n();
  const router = useRouter();
  const { user, loading } = useAuth();
  const { activeProjectId, setActiveProjectId, refreshProjects } = useProject();
  const projectId =
    typeof router.query.projectId === "string"
      ? router.query.projectId
      : activeProjectId;
  const key = `${user?.uid}:${projectId}`;
  const currentRef = useRef(key);
  currentRef.current = key;
  const [allowed, setAllowed] = useState("");
  const [checking, setChecking] = useState(true);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!router.isReady || loading) return;
    if (!user || !projectId) {
      setAllowed("");
      setChecking(false);
      if (!user) void router.replace("/");
      return;
    }
    let alive = true;
    const check = async (background = false) => {
      if (!background) {
        setChecking(true);
        setAllowed("");
        setNeedsCode(false);
      }
      try {
        const entry = await projectRequest(user, "/api/projects/enter", {
          projectId,
        });
        if (entry?.project?.projectId !== projectId)
          throw new ProjectRequestError(
            503,
            "access.checkFailed",
          );
        if (!alive || currentRef.current !== key) return;
        await refreshProjects();
        if (!alive || currentRef.current !== key) return;
        setActiveProjectId(projectId);
        setAllowed(key);
        setError("");
      } catch (e) {
        if (!alive || currentRef.current !== key) return;
        setAllowed("");
        void refreshProjects().catch(() => {});
        try {
          localStorage.removeItem(`ppss-active-project-id-${user.uid}`);
        } catch {
          /* Optional cache. */
        }
        // A missing membership offers initial verification. Revoked records remain denied.
        if (
          e instanceof ProjectRequestError &&
          e.status === 403 &&
          e.reason === "code_required"
        )
          setNeedsCode(true);
        else
          setError(
            e instanceof Error ? e.message : "access.membershipFailed",
          );
      } finally {
        if (alive && currentRef.current === key) setChecking(false);
      }
    };
    setCode("");
    setSaving(false);
    setError("");
    void check();
    const focus = () => void check(true);
    window.addEventListener("focus", focus);
    return () => {
      alive = false;
      window.removeEventListener("focus", focus);
    };
  }, [
    key,
    user,
    loading,
    projectId,
    router,
    setActiveProjectId,
    refreshProjects,
  ]);
  const join = async () => {
    if (!user || !projectId || saving) return;
    setSaving(true);
    setError("");
    try {
      const entry = await projectRequest(user, "/api/projects/enter", {
        projectId,
        code,
      });
      if (entry?.project?.projectId !== projectId)
        throw new ProjectRequestError(
          503,
          t("access.checkFailed"),
        );
      if (currentRef.current !== key) return;
      await refreshProjects();
      if (currentRef.current !== key) return;
      setActiveProjectId(projectId);
      setAllowed(key);
      setCode("");
      setNeedsCode(false);
    } catch (e) {
      if (currentRef.current === key)
        setError(
          e instanceof Error ? e.message : t("access.saveFailed"),
        );
    } finally {
      if (currentRef.current === key) setSaving(false);
    }
  };
  if (user && allowed === key && !checking) return <>{children}</>;
  return (
    <AppShell>
      <section className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {checking || loading ? (
          <p role="status" className="text-sm text-slate-500">
            {t("access.checking")}</p>
        ) : needsCode ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
          >
            <h3 className="text-lg font-semibold">{t("access.codeTitle")}</h3>
            <p className="mt-2 text-sm text-slate-500">
              {t("access.codeHint")}</p>
            <label className="mt-4 block text-sm">
              {t("access.code")}<input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="mt-2 w-full rounded-xl border border-slate-200 p-3"
              />
            </label>
            <button
              type="submit"
              disabled={saving || code.length !== 4}
              className="mt-4 w-full rounded-xl bg-[var(--primary)] p-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? t("access.saving") : t("access.join")}
            </button>
          </form>
        ) : (
          <p className="text-sm text-slate-500">
            {t("access.choose")}</p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-600">
            {localize(error, "access.membershipFailed")}
          </p>
        )}
        <button
          type="button"
          className="mt-4 text-sm font-semibold text-blue-700"
          onClick={() => void router.push("/?projects=1")}
        >
          {t("access.projectList")}</button>
      </section>
    </AppShell>
  );
}
