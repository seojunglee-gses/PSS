import { useEffect, useState } from "react";
import AppShell from "../../components/AppShell";

const providers = ["ChatGPT", "Gemini", "DeepSeek"] as const;

type Provider = (typeof providers)[number];

type ApiState = {
  key: string;
  files: File[];
};

const defaultState: Record<Provider, ApiState> = {
  ChatGPT: { key: "", files: [] },
  Gemini: { key: "", files: [] },
  DeepSeek: { key: "", files: [] },
};

const settingsStorageKey = "ppss-provider-settings";
const providerStorageKey = "ppss-active-provider";

export default function Setting() {
  const [activeProvider, setActiveProvider] = useState<Provider>("ChatGPT");
  const [settings, setSettings] =
    useState<Record<Provider, ApiState>>(defaultState);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedSettings = window.localStorage.getItem(settingsStorageKey);
    const storedProvider = window.localStorage.getItem(providerStorageKey);
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
  }, []);

  const handleProviderChange = (provider: Provider) => {
    setActiveProvider(provider);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(providerStorageKey, provider);
    }
  };

  const handleKeyChange = (provider: Provider, value: string) => {
    setSettings((prev) => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        key: value,
      },
    }));
  };

  const handleFilesChange = (provider: Provider, files: FileList | null) => {
    const fileList = files ? Array.from(files) : [];
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
  };

  const handleUseInWorkspace = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(providerStorageKey, activeProvider);
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
          <div>
            <label className="text-xs font-semibold uppercase text-slate-500">
              {activeProvider} API Key
            </label>
            <input
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-[var(--primary)] focus:outline-none"
              placeholder="sk-..."
              type="password"
              value={settings[activeProvider].key}
              onChange={(event) =>
                handleKeyChange(activeProvider, event.target.value)
              }
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className="rounded-full bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--primary-dark)]"
                type="button"
                onClick={handleSave}
              >
                Save key
              </button>
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
          </div>
        </div>
      </section>
    </AppShell>
  );
}
