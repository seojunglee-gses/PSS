import { useEffect, useState } from "react";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../lib/auth";
import {
  loadAllWorkspaceSummaries,
  loadBackgroundKnowledge,
  loadCurrentSiteImage,
} from "../../lib/firebase";

const providers = ["ChatGPT", "Gemini", "DeepSeek"] as const;

type Provider = (typeof providers)[number];

const providerStorageKey = "ppss-active-provider";
const adminEmail = "test@snu.ac.kr";

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export default function Setting() {
  const { user } = useAuth();
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
  const [isGeneratingExecutiveSummary, setIsGeneratingExecutiveSummary] =
    useState(false);
  const [executiveSummaryMessage, setExecutiveSummaryMessage] = useState<
    string | null
  >(null);

  useEffect(() => {
    setIsAdmin(Boolean(user && user.email === adminEmail));
  }, [user]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedProvider = window.localStorage.getItem(providerStorageKey);
    if (storedProvider && providers.includes(storedProvider as Provider)) {
      setActiveProvider(storedProvider as Provider);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    loadBackgroundKnowledge()
      .then((data) => {
        if (isMounted && data?.curatedText) {
          setBackgroundText(data.curatedText);
        }
      })
      .catch(() => {
        if (isMounted) {
          setBackgroundLoadMessage(
            "Unable to load background knowledge from storage."
          );
        }
      });
    loadCurrentSiteImage()
      .then((data) => {
        if (isMounted && data?.downloadUrl) {
          setSiteImagePreview(data.downloadUrl);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSiteLoadMessage("Unable to load current site image from storage.");
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
      const summaries = await loadAllWorkspaceSummaries();
      if (!isMounted) {
        return;
      }
      const counts = summaries.reduce<Record<string, number>>((acc, entry) => {
        Object.entries(entry.summary.stageSummaries ?? {}).forEach(
          ([stage, summary]) => {
            if (summary && summary.trim()) {
              acc[stage] = (acc[stage] ?? 0) + 1;
            }
          }
        );
        return acc;
      }, {});
      setParticipantCount(summaries.length);
      setStageCompletionCounts(counts);
    };
    loadWorkspaceProgress();
    return () => {
      isMounted = false;
    };
  }, [isAdmin]);

  const handleExecutiveSummaryGenerate = async () => {
    if (!user) {
      setExecutiveSummaryMessage("Authentication required.");
      return;
    }
    try {
      setIsGeneratingExecutiveSummary(true);
      setExecutiveSummaryMessage(null);
      const token = await user.getIdToken();
      const response = await fetch("/api/admin/executive-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Executive summary failed.");
      }
      setExecutiveSummaryMessage("Executive summary generated.");
    } catch (error) {
      setExecutiveSummaryMessage(
        error instanceof Error
          ? error.message
          : "Unable to generate executive summary."
      );
    } finally {
      setIsGeneratingExecutiveSummary(false);
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
        throw new Error("Not logged in");
      }
      if (!backgroundFiles.length) {
        throw new Error("Please upload background knowledge files.");
      }

      const token = await user.getIdToken();

      const filesPayload = await Promise.all(
        backgroundFiles.map(async (file) => {
          const buffer = await file.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
          return {
            name: file.name,
            type: file.type,
            size: file.size,
            lastModified: file.lastModified,
            data: base64,
          };
        })
      );

      const res = await fetch("/api/admin/background-knowledge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ files: filesPayload }),
      });

      const text = await res.text();

      if (!res.ok) {
        throw new Error(text || "Save failed");
      }

      const payload = text ? JSON.parse(text) : {};
      if (payload.curatedText) {
        setBackgroundText(payload.curatedText);
      }

      setBackgroundFiles([]);
      setBackgroundSaveMessage("Background knowledge saved.");
      setBackgroundSaveTone("success");
    } catch (error) {
      setBackgroundSaveMessage(
        error instanceof Error ? error.message : "Save failed"
      );
      setBackgroundSaveTone("error");
    } finally {
      setIsBackgroundSaving(false);
    }
  };

  const handleSiteImageSave = async () => {
    if (!siteImageFiles.length) {
      setSiteSaveMessage("Please select a site image to upload.");
      return;
    }
    try {
      if (!user) {
        throw new Error("Authentication required.");
      }
      const token = await user.getIdToken();
      const file = siteImageFiles[0];
      const response = await fetch("/api/admin/site-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
          data: await fileToBase64(file),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Save failed.");
      }
      const payload = (await response.json()) as { downloadUrl?: string };
      setSiteSaveMessage("Current site image saved to Firebase Storage.");
      if (payload.downloadUrl) {
        setSiteImagePreview(payload.downloadUrl);
      }
    } catch {
      setSiteSaveMessage(
        "Unable to save site image. Check your Firebase connection."
      );
    }
  };

  return (
    <AppShell>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
          Setting
        </p>
        <h2 className="text-3xl font-semibold">Platform settings</h2>
        <p className="max-w-3xl text-sm text-slate-500">
          Configure access levels, connect background knowledge, and choose the
          AI provider that powers each workspace conversation.
        </p>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold">LLM provider</h3>
        <p className="mt-2 text-sm text-slate-500">
          Choose the LLM provider for the workspace without entering admin
          mode.
        </p>
        <p className="mt-4 text-xs text-slate-500">
          Current workspace provider:{" "}
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
              Active provider
            </p>
            <p className="mt-3 text-sm font-semibold text-slate-700">
              {activeProvider}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              The server will use the stored API credentials for this provider.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                type="button"
                onClick={handleUseInWorkspace}
              >
                Use in workspace
              </button>
            </div>
          </div>
        </div>
      </section>
      {isAdmin && (
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Administrator settings</h3>
          <p className="mt-2 text-sm text-slate-500">
            Manage background knowledge and upload the current site image for
            workspace generation.
          </p>
          <div className="mt-6 grid gap-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              <h4 className="text-sm font-semibold text-slate-700">
                Workspace progress
              </h4>
              <p className="mt-2 text-xs text-slate-500">
                Participants who completed each stage (based on saved workspace
                summaries).
              </p>
              <div className="mt-4 grid gap-2 text-xs text-slate-600">
                <div className="flex items-center justify-between">
                  <span>Total participants</span>
                  <span className="font-semibold text-slate-700">
                    {participantCount}
                  </span>
                </div>
                {[
                  { id: "problem", label: "Problem Definition" },
                  { id: "data", label: "Data Analysis" },
                  { id: "alternatives", label: "Design/Plan Alternatives" },
                  { id: "evaluation", label: "Design/Plan Evaluation" },
                  { id: "report", label: "Design/Plan Decision" },
                ].map((stage) => (
                  <div
                    key={stage.id}
                    className="flex items-center justify-between"
                  >
                    <span>{stage.label}</span>
                    <span className="font-semibold text-slate-700">
                      {stageCompletionCounts[stage.id] ?? 0}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-slate-500">
                Background knowledge
              </label>
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
                  Upload Word, PDF, or image files to archive the original
                  background knowledge for admins.
                </p>
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
                  Curated background knowledge (auto-generated)
                </label>
                <textarea
                  className="mt-2 h-40 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 focus:border-[var(--primary)] focus:outline-none"
                  placeholder="Auto-generated from uploaded files."
                  value={backgroundText}
                  readOnly
                />
                <p className="mt-2 text-xs text-slate-500">
                  The API generates this curated text from uploaded materials,
                  then stores it in Firestore for stable LLM context across
                  planning and summary workflows for every workspace user.
                </p>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  type="button"
                  onClick={handleBackgroundSave}
                  disabled={isBackgroundSaving}
                >
                  {isBackgroundSaving
                    ? "Saving..."
                    : "Generate and save summary"}
                </button>
                {backgroundLoadMessage && (
                  <span className="text-xs text-rose-500">
                    {backgroundLoadMessage}
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
                    {backgroundSaveMessage}
                  </span>
                )}
              </div>
            </div>
            <div className="border-t border-slate-200 pt-6">
              <h4 className="text-sm font-semibold">Current site image</h4>
              <p className="mt-2 text-sm text-slate-500">
                Upload the base site imagery used to generate design
                alternatives in the workspace.
              </p>
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                <input
                  className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-full file:border-0 file:bg-[var(--primary)] file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white file:hover:bg-[var(--primary-dark)]"
                  type="file"
                  accept=".png,.jpg,.jpeg"
                  onChange={(event) => handleSiteImagesChange(event.target.files)}
                />
                <p className="mt-3 text-xs text-slate-500">
                  Upload a site image to enable workspace generation.
                </p>
                {siteImageFiles.length > 0 && (
                  <p className="mt-3 text-xs text-slate-600">
                    {siteImageFiles[0].name}
                  </p>
                )}
                {siteImagePreview && (
                  <div className="mt-4">
                    <img
                      src={siteImagePreview}
                      alt="Site preview"
                      className="h-40 w-full rounded-lg object-cover"
                    />
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  type="button"
                  onClick={handleSiteImageSave}
                >
                  Save site images
                </button>
                {siteLoadMessage && (
                  <span className="text-xs text-rose-500">
                    {siteLoadMessage}
                  </span>
                )}
                {siteSaveMessage && (
                  <span className="text-xs text-emerald-600">
                    {siteSaveMessage}
                  </span>
                )}
              </div>
            </div>
            <div className="border-t border-slate-200 pt-6">
              <h4 className="text-sm font-semibold">Executive Summary</h4>
              <p className="mt-2 text-sm text-slate-500">
                Generate an executive summary from all participants' workspace
                dialogue summaries when stages are finished.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  type="button"
                  onClick={handleExecutiveSummaryGenerate}
                  disabled={isGeneratingExecutiveSummary}
                >
                  {isGeneratingExecutiveSummary
                    ? "Generating..."
                    : "Generate executive summary"}
                </button>
                {executiveSummaryMessage && (
                  <span className="text-xs text-slate-500">
                    {executiveSummaryMessage}
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
