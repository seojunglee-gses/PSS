const key = "ppss-sidebar-pinned";
const changed = "ppss-sidebar-preference";
let fallback: boolean | undefined;

export function sidebarPinnedSnapshot(): boolean {
  if (fallback !== undefined) return fallback;
  try { return localStorage.getItem(key) === "true"; } catch { return false; }
}
export function subscribeSidebarPreference(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) { fallback = undefined; listener(); }
  };
  window.addEventListener(changed, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("storage", storage);
  };
}
export function saveSidebarPinned(pinned: boolean) {
  try { localStorage.setItem(key, String(pinned)); fallback = undefined; }
  catch { fallback = pinned; }
  window.dispatchEvent(new Event(changed));
}
