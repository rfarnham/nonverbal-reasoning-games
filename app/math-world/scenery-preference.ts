const KEY = "spatial-gym-math-world-scenery-paused";
const EVENT = "math-world-scenery-preference";
const QUERY = "(prefers-reduced-motion: reduce)";
let memoryPreference: boolean | undefined;

export function getSceneryPaused(): boolean {
  if (window.matchMedia(QUERY).matches) return true;
  if (memoryPreference !== undefined) return memoryPreference;
  try { return window.localStorage.getItem(KEY) === "true"; }
  catch { return false; }
}

export function setSceneryPaused(paused: boolean) {
  memoryPreference = paused;
  try { window.localStorage.setItem(KEY, String(paused)); } catch { /* Device-local preference still works for this visit. */ }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeSceneryPreference(notify: () => void) {
  const query = window.matchMedia(QUERY);
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) { memoryPreference = undefined; notify(); }
  };
  query.addEventListener("change", notify);
  window.addEventListener(EVENT, notify);
  window.addEventListener("storage", storage);
  return () => {
    query.removeEventListener("change", notify);
    window.removeEventListener(EVENT, notify);
    window.removeEventListener("storage", storage);
  };
}
