import { uploadProjectFile } from "../../lib/storage-upload";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../lib/auth";
import {
  loadAllWorkspaceSummaries,
  loadBackgroundKnowledge,
  loadCurrentSiteImage,
  loadStageLocks,
  saveStageLocks,
} from "../../lib/firebase";
import { useI18n } from "../../lib/i18n";
import { useProject } from "../../lib/projects";
import { canManageProject } from "../../lib/rbac";
import SpatialDatasetManager from "../../components/spatial/SpatialDatasetManager";

const providers = ["ChatGPT", "Gemini", "DeepSeek"] as const;

type Provider = (typeof providers)[number];

const providerStorageKeyBase = "ppss-active-provider";


export default function Setting() {
  const router = useRouter();
  const { user } = useAuth();
  const { activeProjectId, setActiveProjectId, activeProject } = useProject();
  const queryProjectId = typeof router.query.projectId === "string" ? router.query.projectId : null;
  const projectId = queryProjectId ?? activeProjectId ?? "project-1";
  const { t, localize } = useI18n();
  const providerStorageKey = `${providerStorageKeyBase}-${projectId}`;
  useEffect(() => {
    if (queryProjectId && queryProjectId !== activeProjectId) setActiveProjectId(queryProjectId);
  }, [queryProjectId, activeProjectId, setActiveProjectId]);
  const [activeProvider, setActiveProvider] = useState<Provider>("ChatGPT");
  const [isAdmin, setIsAdmin] = useState(false);
  const [siteImageFiles, setSiteImageFiles] = useState<File[]>([]);
  const [siteImagePreview, setSiteImagePreview] = useState<string | null>(null);
  const [backgroundFiles, setBackgroundFiles] = useState<File[]>([]);
  const [backgroundText, setBackgroundText] = useState("");
  const [backgroundSaveMessage, setBackgroundSaveMessage] = useState<
    string | null
  >(null);
  const [isBackgroundSaving, setIsBackgroundSaving] = useState(false);
  const [backgroundSaveTone, setBackgroundSaveTone] = useState<
    "success" | "error" | null
  >(null);
  const [siteSaveMessage, setSiteSaveMessage] = useState<string | null>(null);
  const [backgroundLoadMessage, setBackgroundLoadMessage] = useState<
    string | null
  >(null);
  const [siteLoadMessage, setSiteLoadMessage] = useState<string | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [stageCompletionCounts, setStageCompletionCounts] = useState<
    Record<string, number>
  >({});
  const [lockedStages, setLockedStages] = useState<Record<string, boolean>>({});
  const [isGeneratingExecutiveSummary, setIsGeneratingExecutiveSummary] =
    useState<Record<string, boolean>>({});
  const [executiveSummaryMessage, setExecutiveSummaryMessage] = useState<
    Record<string, string>
  >({});
  const [isResettingProject, setIsResettingProject] = useState(false);
  const [resetProjectMessage, setResetProjectMessage] = useState<string | null>(
    null
  );
  const [resetProjectTone, setResetProjectTone] = useState<
    "success" | "error" | null
  >(null);

  const canAccessAdminSettings = canManageProject(user?.email, activeProject);

  useEffect(() => {
    setIsAdmin(canAccessAdminSettings);
  }, [canAccessAdminSettings]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedProvider = window.localStorage.getItem(providerStorageKey);
    if (storedProvider && providers.includes(storedProvider as Provider)) {
      setActiveProvider(storedProvider as Provider);
    }
  }, [projectId]);

  useEffect(() => {
    let isMounted = true;
    loadBackgroundKnowledge(projectId)
      .then((data) => {
        if (isMounted && data?.curatedText) {
          setBackgroundText(data.curatedText);
        }
      })
      .catch(() => {
        if (isMounted) {
          setBackgroundLoadMessage(
            "setting.backgroundLoadFailed"
          );
        }
      });
    loadCurrentSiteImage(projectId)
      .then((data) => {
        if (isMounted && data?.downloadUrl) {
          setSiteImagePreview(data.downloadUrl);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSiteLoadMessage("setting.siteLoadFailed");
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    let isMounted = true;
    const loadWorkspaceProgress = async () => {
      const summaries = await loadAllWorkspaceSummaries(projectId);
      if (!isMounted) {
        return;
      }
      const counts = summaries.reduce<Record<string, number>>((acc, entry) => {
        const completedStages = entry.summary.completedStages ?? [];
        completedStages.forEach((stage) => {
          acc[stage] = (acc[stage] ?? 0) + 1;
        });
        return acc;
      }, {});
      const totalParticipants = summaries.filter(
        (entry) => (entry.summary.completedStages ?? []).length > 0
      ).length;
      setParticipantCount(totalParticipants);
      setStageCompletionCounts(counts);
    };
    loadWorkspaceProgress();
    return () => {
      isMounted = false;
    };
  }, [isAdmin, projectId]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    let isMounted = true;
    const loadLocks = async () => {
      const state = await loadStageLocks(projectId);
      if (!isMounted) {
        return;
      }
      setLockedStages(state?.lockedStages ?? {});
    };
    loadLocks();
    return () => {
      isMounted = false;
    };
  }, [isAdmin, projectId]);

  const handleExecutiveSummaryGenerate = async (stageId: string) => {
    if (!user) {
      setExecutiveSummaryMessage((prev) => ({
        ...prev,
        [stageId]: t("common.authRequired"),
      }));
      return;
    }
    try {
      setIsGeneratingExecutiveSummary((prev) => ({
        ...prev,
        [stageId]: true,
      }));
      setExecutiveSummaryMessage((prev) => ({
        ...prev,
        [stageId]: "",
      }));
      const token = await user.getIdToken();
      const response = await fetch("/api/admin/executive-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ stageId, projectId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? t("setting.executiveFailed"));
      }
      setExecutiveSummaryMessage((prev) => ({
        ...prev,
        [stageId]: t("setting.executiveSaved"),
      }));
    } catch (error) {
      setExecutiveSummaryMessage((prev) => ({
        ...prev,
        [stageId]:
          error instanceof Error
            ? error.message
            : t("setting.executiveGenerateFailed"),
      }));
    } finally {
      setIsGeneratingExecutiveSummary((prev) => ({
        ...prev,
        [stageId]: false,
      }));
    }
  };

  const handleStageLockToggle = async (stageId: string, locked: boolean) => {
    if (!user) {
      return;
    }
    const nextLocks = { ...lockedStages, [stageId]: locked };
    setLockedStages(nextLocks);
    await saveStageLocks({
      lockedStages: nextLocks,
      updatedBy: user.email ?? user.uid,
    }, projectId);
  };

  const handleProjectReset = async () => {
    if (!user) {
      setResetProjectMessage(t("common.authRequired"));
      setResetProjectTone("error");
      return;
    }
    const confirmed = window.confirm(
      t("setting.resetConfirm")
    );
    if (!confirmed) {
      return;
    }
    setIsResettingProject(true);
    setResetProjectMessage(null);
    setResetProjectTone(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/admin/reset-project", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projectId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? t("setting.resetFailed"));
      }
      setResetProjectMessage(t("setting.resetSaved"));
      setResetProjectTone("success");
    } catch (error) {
      setResetProjectMessage(
        error instanceof Error ? error.message : t("setting.resetError")
      );
      setResetProjectTone("error");
    } finally {
      setIsResettingProject(false);
    }
  };

  useEffect(() => {
    return () => {
      if (siteImagePreview && siteImagePreview.startsWith("blob:")) {
        URL.revokeObjectURL(siteImagePreview);
      }
    };
  }, [siteImagePreview]);

  const handleProviderChange = (provider: Provider) => {
    setActiveProvider(provider);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(providerStorageKey, provider);
    }
  };

  const handleUseInWorkspace = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(providerStorageKey, activeProvider);
  };

  const handleSiteImagesChange = (files: FileList | null) => {
    const fileList = files ? Array.from(files) : [];
    if (siteImagePreview) {
      URL.revokeObjectURL(siteImagePreview);
    }
    const preview = fileList.length ? URL.createObjectURL(fileList[0]) : null;
    setSiteImageFiles(fileList);
    setSiteImagePreview(preview);
  };

  const handleBackgroundFilesChange = (files: FileList | null) => {
    setBackgroundFiles(files ? Array.from(files) : []);
  };

  const handleBackgroundSave = async () => {
    if (isBackgroundSaving) return;
    setIsBackgroundSaving(true);
    setBackgroundSaveMessage(null);
    setBackgroundSaveTone(null);

    try {
      if (!user) {
        throw new Error(t("common.authRequired"));
      }
      if (!backgroundFiles.length) {
        throw new Error(t("setting.backgroundRequired"));
      }

      const token = await user.getIdToken();

      const filesPayload = [];
      for (const file of backgroundFiles) filesPayload.push(await uploadProjectFile("/api/admin/background-knowledge", file, projectId, token));

      const res = await fetch("/api/admin/background-knowledge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projectId, files: filesPayload }),
      });

      const text = await res.text();

      if (!res.ok) {
        throw new Error(text || t("common.saveFailed"));
      }

      const payload = text ? JSON.parse(text) : {};
      if (payload.curatedText) {
        setBackgroundText(payload.curatedText);
      }

      setBackgroundFiles([]);
      setBackgroundSaveMessage(t("setting.backgroundSaved"));
      setBackgroundSaveTone("success");
    } catch (error) {
      setBackgroundSaveMessage(
        error instanceof Error ? error.message : t("common.saveFailed")
      );
      setBackgroundSaveTone("error");
    } finally {
      setIsBackgroundSaving(false);
    }
  };

  const handleSiteImageSave = async () => {
    if (!siteImageFiles.length) {
      setSiteSaveMessage(t("setting.siteRequired"));
      return;
    }
    try {
      if (!user) {
        throw new Error(t("common.authRequired"));
      }
      const token = await user.getIdToken();
      const file = siteImageFiles[0];
      const uploadedFile = await uploadProjectFile("/api/admin/site-image", file, projectId, token);
      const response = await fetch("/api/admin/site-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projectId, ...uploadedFile }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? t("common.saveFailed"));
      }
      const payload = (await response.json()) as { downloadUrl?: string };
      setSiteSaveMessage(t("setting.siteSaved"));
      if (payload.downloadUrl) {
        setSiteImagePreview(payload.downloadUrl);
      }
    } catch (error) {
      setSiteSaveMessage(error instanceof Error ? error.message : t("image.siteSaveFailed"));
    }
  };

  return (
    <AppShell>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
          {t("setting.badge")}
        </p>
        <h2 className="text-3xl font-semibold">{t("setting.title")}</h2>
        <p className="max-w-3xl text-sm text-slate-500">
          {t("setting.desc")}
        </p>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold">{t("setting.llm")}</h3>
        <p className="mt-2 text-sm text-slate-500">
          {t("setting.llm.desc")}
        </p>
        <p className="mt-4 text-xs text-slate-500">
          {t("setting.currentProvider")}: {" "}
          <span className="font-semibold text-slate-700">
            {activeProvider}
          </span>
        </p>
        <div className="mt-6 flex flex-wrap gap-3 rounded-full bg-slate-50 p-2">
          {providers.map((provider) => {
            const isActive = provider === activeProvider;
            return (
              <button
                key={provider}
                className={`rounded-full px-4 py-2 text-xs font-semibold ${
                  isActive
                    ? "bg-[var(--primary)] text-white"
                    : "text-slate-600 hover:text-[var(--primary)]"
                }`}
                type="button"
                onClick={() => handleProviderChange(provider)}
              >
                {provider}
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            <p className="text-xs font-semibold uppercase text-slate-500">
              {t("setting.activeProvider")}
            </p>
            <p className="mt-3 text-sm font-semibold text-slate-700">
              {activeProvider}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t("setting.activeProvider.desc")}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                type="button"
                onClick={handleUseInWorkspace}
              >
                {t("setting.useWorkspace")}
              </button>
            </div>
          </div>
        </div>
      </section>
      {activeProject?.projectId === projectId && <SpatialDatasetManager key={`${projectId}-${user?.uid}`} projectId={projectId} />}
      {isAdmin && (
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold">{t("setting.admin")}</h3>
          <p className="mt-2 text-sm text-slate-500">
            {t("setting.admin.desc")}
          </p>
          <div className="mt-6 grid gap-6">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-700">
                    {t("setting.progress")}</h4>
                  <p className="mt-2 text-xs text-slate-500">
                    {t("setting.progressHint")}</p>
                </div>
                <div className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {t("setting.participants")}{participantCount}
                </div>
              </div>
              <div className="mt-4 grid gap-3 text-xs">
                {[
                  { id: "problem", label: t("step.problem") },
                  { id: "data", label: t("step.data") },
                  { id: "alternatives", label: t("step.alternatives") },
                  { id: "evaluation", label: t("step.evaluation") },
                  { id: "report", label: t("step.report") },
                ].map((stage) => (
                  <div
                    key={stage.id}
                    className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 lg:grid-cols-[1.4fr_0.7fr_0.9fr]"
                  >
                    <div>
                      <p className="font-semibold text-slate-700">
                        {stage.label}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {t("setting.completed")}{stageCompletionCounts[stage.id] ?? 0}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500">
                        {t("setting.stageLock")}</span>
                      <button
                        className={`relative h-6 w-11 rounded-full transition ${
                          lockedStages[stage.id]
                            ? "bg-[var(--primary)]"
                            : "bg-slate-200"
                        }`}
                        type="button"
                        onClick={() =>
                          handleStageLockToggle(
                            stage.id,
                            !lockedStages[stage.id]
                          )
                        }
                        aria-pressed={lockedStages[stage.id]}
                      >
                        <span
                          className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition ${
                            lockedStages[stage.id] ? "translate-x-5" : ""
                          }`}
                        />
                      </button>
                      <span className="text-[11px] text-slate-500">
                        {lockedStages[stage.id] ? t("setting.locked") : t("setting.open")}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {executiveSummaryMessage[stage.id] && (
                        <span className="text-[11px] text-slate-500">
                          {localize(executiveSummaryMessage[stage.id], "common.requestFailed")}
                        </span>
                      )}
                      <button
                        className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                        type="button"
                        onClick={() =>
                          handleExecutiveSummaryGenerate(stage.id)
                        }
                        disabled={isGeneratingExecutiveSummary[stage.id]}
                      >
                        {isGeneratingExecutiveSummary[stage.id]
                          ? t("setting.generating")
                          : t("setting.generateExecutive")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-slate-200" />
            <div>
              <label className="text-xs font-semibold uppercase text-slate-500">
                {t("setting.background")}</label>
              <div className="mt-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                <input
                  className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-full file:border-0 file:bg-[var(--primary)] file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white file:hover:bg-[var(--primary-dark)]"
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  multiple
                  onChange={(event) =>
                    handleBackgroundFilesChange(event.target.files)
                  }
                />
                <p className="mt-3 text-xs text-slate-500">
                  {t("setting.backgroundUploadHint")}</p>
                {backgroundFiles.length > 0 && (
                  <ul className="mt-3 space-y-1 text-xs text-slate-600">
                    {backgroundFiles.map((file) => (
                      <li key={file.name}>{file.name}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-4">
                <label className="text-xs font-semibold uppercase text-slate-500">
                  {t("setting.backgroundSummary")}</label>
                <textarea
                  className="mt-2 h-40 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 focus:border-[var(--primary)] focus:outline-none"
                  placeholder={t("setting.backgroundPlaceholder")}
                  value={backgroundText}
                  readOnly
                />
                <p className="mt-2 text-xs text-slate-500">
                  {t("setting.backgroundSummaryHint")}</p>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  type="button"
                  onClick={handleBackgroundSave}
                  disabled={isBackgroundSaving}
                >
                  {isBackgroundSaving
                    ? t("common.saving")
                    : t("setting.generateSave")}
                </button>
                {backgroundLoadMessage && (
                  <span className="text-xs text-rose-500">
                    {localize(backgroundLoadMessage, "common.requestFailed")}
                  </span>
                )}
                {backgroundSaveMessage && (
                  <span
                    className={`text-xs ${
                      backgroundSaveTone === "error"
                        ? "text-rose-500"
                        : "text-emerald-600"
                    }`}
                  >
                    {localize(backgroundSaveMessage, "common.requestFailed")}
                  </span>
                )}
              </div>
            </div>
          
            <div className="border-t border-slate-200 pt-6">
              <h4 className="text-sm font-semibold">{t("setting.siteImage")}</h4>
              <p className="mt-2 text-sm text-slate-500">
                {t("setting.siteImageHint")}</p>
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-[220px] flex-1">
                    <input
                      className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-full file:border-0 file:bg-[var(--primary)] file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white file:hover:bg-[var(--primary-dark)]"
                      type="file"
                      accept=".png,.jpg,.jpeg"
                      onChange={(event) =>
                        handleSiteImagesChange(event.target.files)
                      }
                    />
                    <p className="mt-3 text-xs text-slate-500">
                      {t("setting.siteUploadHint")}</p>
                    {siteImageFiles.length > 0 && (
                      <p className="mt-3 text-xs text-slate-600">
                        {siteImageFiles[0].name}
                      </p>
                    )}
                  </div>
                  {siteImagePreview && (
                    <div className="flex items-center">
                      <img
                        src={siteImagePreview}
                        alt={t("setting.sitePreview")}
                        className="h-24 w-24 rounded-lg border border-slate-200 bg-white object-contain"
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  type="button"
                  onClick={handleSiteImageSave}
                >
                  {t("setting.saveSite")}</button>
                {siteLoadMessage && (
                  <span className="text-xs text-rose-500">
                    {localize(siteLoadMessage, "common.requestFailed")}
                  </span>
                )}
                {siteSaveMessage && (
                  <span className="text-xs text-emerald-600">
                    {localize(siteSaveMessage, "common.requestFailed")}
                  </span>
                )}
              </div>
            </div>
            
            <div className="border-t border-rose-200 bg-rose-50/40 pt-6 rounded-xl">
              <h4 className="text-sm font-semibold text-slate-700">
                {t("setting.reset")}</h4>
              <p className="mt-2 text-sm text-slate-500">
                {t("setting.resetHint")}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  className="rounded-full border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-600 hover:border-rose-300 hover:text-rose-700"
                  type="button"
                  onClick={handleProjectReset}
                  disabled={isResettingProject}
                >
                  {isResettingProject ? t("setting.resetting") : t("setting.resetAction")}
                </button>
                {resetProjectMessage && (
                  <span
                    className={`text-xs ${
                      resetProjectTone === "error"
                        ? "text-rose-500"
                        : "text-emerald-600"
                    }`}
                  >
                    {localize(resetProjectMessage, "common.requestFailed")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </AppShell>
  );
}
