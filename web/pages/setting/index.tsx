import { useEffect, useState } from "react";
import AppShell from "../../components/AppShell";

const providers = ["ChatGPT", "Gemini", "DeepSeek"] as const;

type Provider = (typeof providers)[number];

type ApiState = {
  files: Array<{ name: string }>;
};

const defaultState: Record<Provider, ApiState> = {
  ChatGPT: { files: [] },
  Gemini: { files: [] },
  DeepSeek: { files: [] },
};

const settingsStorageKey = "ppss-provider-settings";
const providerStorageKey = "ppss-active-provider";
const adminStorageKey = "ppss-admin-mode";
const siteImageStorageKey = "ppss-site-image";
const adminCode = "0000";

export default function Setting() {
  const [activeProvider, setActiveProvider] = useState<Provider>("ChatGPT");
  const [settings, setSettings] =
    useState<Record<Provider, ApiState>>(defaultState);
  const [adminInput, setAdminInput] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [siteImages, setSiteImages] = useState<Array<{ name: string }>>([]);
  const [siteImagePreviews, setSiteImagePreviews] = useState<string[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [backgroundSaveMessage, setBackgroundSaveMessage] = useState<
    string | null
  >(null);
  const [siteSaveMessage, setSiteSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedSettings = window.localStorage.getItem(settingsStorageKey);
    const storedProvider = window.localStorage.getItem(providerStorageKey);
    const storedAdmin = window.localStorage.getItem(adminStorageKey);
    const storedSiteImages = window.localStorage.getItem(siteImageStorageKey);
    if (storedSettings) {
      try {
        setSettings(JSON.parse(storedSettings));
      } catch {
        setSettings(defaultState);
      }
    }
    if (storedProvider && providers.includes(storedProvider as Provider)) {
      setActiveProvider(storedProvider as Provider);
    }
    if (storedAdmin === "true") {
      setIsAdmin(true);
    }
    if (storedSiteImages) {
      try {
        setSiteImages(JSON.parse(storedSiteImages));
      } catch {
        setSiteImages([]);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      siteImagePreviews.forEach((src) => URL.revokeObjectURL(src));
    };
  }, [siteImagePreviews]);

  const handleProviderChange = (provider: Provider) => {
    setActiveProvider(provider);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(providerStorageKey, provider);
    }
  };

  const handleFilesChange = (provider: Provider, files: FileList | null) => {
    const fileList = files
      ? Array.from(files).map((file) => ({ name: file.name }))
      : [];
    setSettings((prev) => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        files: fileList,
      },
    }));
  };

  const handleSave = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
    setSaveMessage("Settings saved successfully.");
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
    const fileList = files
      ? Array.from(files).map((file) => ({ name: file.name }))
      : [];
    const previews = files ? Array.from(files).map((file) => URL.createObjectURL(file)) : [];
    setSiteImages(fileList);
    setSiteImagePreviews(previews);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        siteImageStorageKey,
        JSON.stringify(fileList)
      );
    }
  };

  const handleBackgroundSave = () => {
    handleSave();
    setBackgroundSaveMessage("Background knowledge saved.");
  };

  const handleSiteImageSave = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(siteImageStorageKey, JSON.stringify(siteImages));
    setSiteSaveMessage("Current site images saved.");
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

      {!isAdmin ? (
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Administrator access</h3>
          <p className="mt-2 text-sm text-slate-500">
            Enter the administrator code to access platform settings.
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
        <h3 className="text-lg font-semibold">API Key Access</h3>
        <p className="mt-2 text-sm text-slate-500">
          Add API keys for each provider and upload background knowledge so the
          workspace can respond using your selected context.
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
                  handleFilesChange(activeProvider, event.target.files)
                }
              />
              <p className="mt-3 text-xs text-slate-500">
                Upload Word, PDF, or image files to seed the workspace context.
              </p>
              {settings[activeProvider].files.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-slate-600">
                  {settings[activeProvider].files.map((file) => (
                    <li key={file.name}>{file.name}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                type="button"
                onClick={handleBackgroundSave}
              >
                Save background knowledge
              </button>
              {backgroundSaveMessage && (
                <span className="text-xs text-emerald-600">
                  {backgroundSaveMessage}
                </span>
              )}
            </div>
          </div>
        </div>
        {saveMessage && (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {saveMessage}
          </div>
        )}
        <div className="mt-8 border-t border-slate-200 pt-6">
          <h4 className="text-sm font-semibold">Current site image</h4>
          <p className="mt-2 text-sm text-slate-500">
            Upload the base site imagery used to generate design alternatives
            in the workspace.
          </p>
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            <input
              className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-full file:border-0 file:bg-[var(--primary)] file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white file:hover:bg-[var(--primary-dark)]"
              type="file"
              accept=".png,.jpg,.jpeg"
              multiple
              onChange={(event) => handleSiteImagesChange(event.target.files)}
            />
            <p className="mt-3 text-xs text-slate-500">
              Upload one or more site images to enable workspace generation.
            </p>
            {siteImages.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                {siteImages.map((file) => (
                  <li key={file.name}>{file.name}</li>
                ))}
              </ul>
            )}
            {siteImagePreviews.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {siteImagePreviews.map((src) => (
                  <img
                    key={src}
                    src={src}
                    alt="Site preview"
                    className="h-20 w-full rounded-lg object-cover"
                  />
                ))}
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
              <span className="text-xs text-emerald-600">{siteSaveMessage}</span>
            )}
          </div>
        </div>
      </section>
      )}
    </AppShell>
  );
}
