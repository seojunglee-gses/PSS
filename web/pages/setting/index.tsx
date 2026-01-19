import { useEffect, useState } from "react";
import AppShell from "../../components/AppShell";
import { auth } from "@/lib/firebase";
import {
  archiveBackgroundKnowledgeFile,
  loadBackgroundKnowledge,
  loadCurrentSiteImage,
  saveCurrentSiteImage,
  saveBackgroundKnowledge,
} from "../../lib/firebase";

const providers = ["ChatGPT", "Gemini", "DeepSeek"] as const;

type Provider = (typeof providers)[number];

const providerStorageKey = "ppss-active-provider";
const adminStorageKey = "ppss-admin-mode";
const adminCode = "0000";

export default function Setting() {
  const [activeProvider, setActiveProvider] = useState<Provider>("ChatGPT");
  const [adminInput, setAdminInput] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [siteImageFiles, setSiteImageFiles] = useState<File[]>([]);
  const [siteImagePreview, setSiteImagePreview] = useState<string | null>(null);
  const [backgroundFiles, setBackgroundFiles] = useState<File[]>([]);
  const [backgroundText, setBackgroundText] = useState("");
  const [backgroundSaveMessage, setBackgroundSaveMessage] = useState<
    string | null
  >(null);
  const [backgroundSaveStatus, setBackgroundSaveStatus] = useState<
    "idle" | "saving"
  >("idle");
  const [backgroundSaveTone, setBackgroundSaveTone] = useState<
    "success" | "error" | null
  >(null);
  const [siteSaveMessage, setSiteSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedProvider = window.localStorage.getItem(providerStorageKey);
    const storedAdmin = window.localStorage.getItem(adminStorageKey);
    if (storedProvider && providers.includes(storedProvider as Provider)) {
      setActiveProvider(storedProvider as Provider);
    }
    if (storedAdmin === "true") {
      setIsAdmin(true);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    let isMounted = true;
    loadBackgroundKnowledge()
      .then((data) => {
        if (isMounted && data?.curatedText) {
          setBackgroundText(data.curatedText);
        }
      })
      .catch(() => {
        if (isMounted) {
          setBackgroundSaveMessage(
            "Unable to load background knowledge from storage."
          );
          setBackgroundSaveTone("error");
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
          setSiteSaveMessage(
            "Unable to load current site image from storage."
          );
        }
      });
    return () => {
      isMounted = false;
    };
  }, [isAdmin]);

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

  const handleAdminUnlock = () => {
    if (adminInput.trim() !== adminCode) {
      return;
    }
    setIsAdmin(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(adminStorageKey, "true");
    }
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
    if (backgroundSaveStatus === "saving") {
      return;
    }
    setBackgroundSaveStatus("saving");
    setBackgroundSaveMessage(null);
    setBackgroundSaveTone(null);
    try {
      const updatedBy =
        auth.currentUser?.email ??
        auth.currentUser?.uid ??
        "admin";
      await saveBackgroundKnowledge({
        curatedText: backgroundText.trim(),
        updatedBy,
      });
      if (backgroundFiles.length) {
        await Promise.all(
          backgroundFiles.map((file) =>
            archiveBackgroundKnowledgeFile(file, updatedBy)
          )
        );
        setBackgroundFiles([]);
      }
      setBackgroundSaveMessage("Background knowledge saved.");
      setBackgroundSaveTone("success");
    } catch {
      setBackgroundSaveMessage(
        "Unable to save background knowledge. Check your Firebase connection."
      );
      setBackgroundSaveTone("error");
    } finally {
      setBackgroundSaveStatus("idle");
    }
  };

  const handleSiteImageSave = async () => {
    if (!siteImageFiles.length) {
      setSiteSaveMessage("Please select a site image to upload.");
      return;
    }
    try {
      const updatedBy =
        auth.currentUser?.email ??
        auth.currentUser?.uid ??
        "admin";
      const saved = await saveCurrentSiteImage(siteImageFiles[0], updatedBy);
      if (saved) {
        setSiteSaveMessage("Current site image saved to Firebase Storage.");
        setSiteImagePreview(saved.downloadUrl);
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
      {!isAdmin ? (
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Administrator access</h3>
          <p className="mt-2 text-sm text-slate-500">
            Enter the administrator code to manage background knowledge and
            site images.
          </p>
          <div className="mt-6 grid gap-4 max-w-md">
            <label className="text-xs font-semibold uppercase text-slate-500">
              Admin code
            </label>
            <input
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-[var(--primary)] focus:outline-none"
              placeholder="0000"
              type="password"
              value={adminInput}
              onChange={(event) => setAdminInput(event.target.value)}
            />
            <button
              className="rounded-full bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--primary-dark)]"
              type="button"
              onClick={handleAdminUnlock}
            >
              Enter admin mode
            </button>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Administrator settings</h3>
          <p className="mt-2 text-sm text-slate-500">
            Manage background knowledge and upload the current site image for
            workspace generation.
          </p>
          <div className="mt-6 grid gap-6">
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
                  Curated background knowledge
                </label>
                <textarea
                  className="mt-2 h-40 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 focus:border-[var(--primary)] focus:outline-none"
                  placeholder="Summarize project context, physical conditions, social conditions, and common requests."
                  value={backgroundText}
                  onChange={(event) => setBackgroundText(event.target.value)}
                />
                <p className="mt-2 text-xs text-slate-500">
                  This curated text is stored in Firestore and used as stable
                  system context for the LLM across planning and summary
                  workflows.
                </p>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  type="button"
                  onClick={handleBackgroundSave}
                  disabled={backgroundSaveStatus === "saving"}
                >
                  {backgroundSaveStatus === "saving"
                    ? "Saving..."
                    : "Save background knowledge"}
                </button>
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
                {siteSaveMessage && (
                  <span className="text-xs text-emerald-600">
                    {siteSaveMessage}
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
