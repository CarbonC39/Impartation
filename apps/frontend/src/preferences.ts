/** Per-browser display preferences. Storage can be unavailable (private mode), so every access is optional. */
export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ }
}
export function readJsonPreference(key: string): unknown {
  const raw = readPreference(key);
  if (raw === null) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}
