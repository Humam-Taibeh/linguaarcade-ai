/**
 * Chat transcript persistence (localStorage).
 *
 * Why a separate store from the main AppState document: transcripts are
 * bulkier and churn on every message, while AppState is small and structural.
 * Keeping them under their own keys means a chat can never corrupt (or bloat)
 * the profile/settings document — and the conversation survives reloads,
 * navigation, and even the local AI server dying mid-session.
 */
import type { Correction } from "./gemini/client";

/** The on-screen message shape shared by Conversation and Scenario Studio. */
export interface StoredChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  corrections?: Correction[];
  followUpQuestion?: string;
}

export const CONVERSATION_STORAGE_KEY = "linguaarcade.chat.v1";
export const SCENARIO_STORAGE_KEY = "linguaarcade.scenario.v1";

/** A persisted Scenario Studio session: the scene plus its transcript. */
export interface StoredScenarioSession {
  scenario: string;
  messages: StoredChatMessage[];
}

function isStoredMessage(value: unknown): value is StoredChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.text === "string" &&
    (m.role === "user" || m.role === "model")
  );
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    // Corrupt JSON or blocked storage must never take the app down.
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded / storage disabled — the in-memory session still works */
  }
}

export function loadConversation(): StoredChatMessage[] | null {
  const parsed = readJson(CONVERSATION_STORAGE_KEY);
  if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isStoredMessage)) {
    return parsed;
  }
  return null;
}

export function saveConversation(messages: StoredChatMessage[]): void {
  writeJson(CONVERSATION_STORAGE_KEY, messages);
}

export function clearConversation(): void {
  try {
    window.localStorage.removeItem(CONVERSATION_STORAGE_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

export function loadScenarioSession(): StoredScenarioSession | null {
  const parsed = readJson(SCENARIO_STORAGE_KEY);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as Record<string, unknown>).scenario === "string" &&
    Array.isArray((parsed as Record<string, unknown>).messages) &&
    ((parsed as Record<string, unknown>).messages as unknown[]).every(isStoredMessage)
  ) {
    return parsed as StoredScenarioSession;
  }
  return null;
}

export function saveScenarioSession(session: StoredScenarioSession): void {
  writeJson(SCENARIO_STORAGE_KEY, session);
}

export function clearScenarioSession(): void {
  try {
    window.localStorage.removeItem(SCENARIO_STORAGE_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
