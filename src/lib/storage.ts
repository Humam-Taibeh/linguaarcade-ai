/**
 * LocalStorage persistence layer.
 *
 * Why LocalStorage and not a backend: this app is intentionally serverless.
 * All personal data (progress, custom sentences, the user's own Gemini API
 * key) stays on the user's machine, which is both the simplest and the most
 * private architecture for a two-person learning tool.
 *
 * The key is versioned ("...v1") so a future breaking schema change can read
 * the old key, migrate, and write the new one instead of corrupting state.
 */
import type { AppState } from "../types";

const STORAGE_KEY = "linguaarcade.state.v1";

export function loadPersistedState(): AppState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // Minimal structural validation: if the document is not an object with the
    // top-level keys we expect, treat it as absent rather than crash the app.
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "profile" in parsed &&
      "sentences" in parsed &&
      "sessions" in parsed &&
      "settings" in parsed
    ) {
      return parsed as AppState;
    }
    return null;
  } catch {
    // Corrupt JSON or a blocked storage API (private mode) must never take
    // down the app — we fall back to a fresh state instead.
    return null;
  }
}

export function savePersistedState(state: AppState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded / storage disabled: silently skip. The session still
    // works in memory; persistence simply resumes when storage is available.
  }
}

export function clearPersistedState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
