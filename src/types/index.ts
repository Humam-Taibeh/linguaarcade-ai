/**
 * Shared domain types for LinguaArcade AI.
 *
 * Why a single types module: the app state is persisted to LocalStorage as one
 * JSON document, so every feature must agree on the exact same shapes. Keeping
 * them in one file makes the persisted schema auditable at a glance and makes
 * schema evolution (see STORAGE_KEY versioning in lib/storage.ts) deliberate.
 */

/** Top-level navigation targets rendered by <App/>. */
export type View = "dashboard" | "shadowing" | "conversation" | "sentences" | "settings";

/** How harshly the pronunciation scorer judges near-misses. */
export type Strictness = "standard" | "strict";

/** A user-authored practice sentence from the "My Sentences" module. */
export interface Sentence {
  id: string;
  text: string;
  createdAt: string; // ISO timestamp
  timesPracticed: number;
  bestScore: number; // 0-100, best shadowing accuracy achieved on this sentence
}

/** One completed practice unit — a shadowing take or a conversation exchange. */
export interface SessionRecord {
  id: string;
  kind: "shadowing" | "conversation";
  /** Accuracy is only meaningful for shadowing; conversation turns omit it. */
  accuracy: number | null;
  xpEarned: number;
  /** Truncated preview of the practiced text, for the dashboard history list. */
  textPreview: string;
  completedAt: string; // ISO timestamp
}

/** Gamification profile: XP is the single source of truth, level is derived. */
export interface Profile {
  xp: number;
  currentStreak: number;
  bestStreak: number;
  /** Local calendar day ("YYYY-MM-DD") of the last practice, for streak math. */
  lastPracticeDay: string | null;
  totalSessions: number;
}

/** User preferences. The Gemini key lives here and is persisted to LocalStorage only. */
export interface Settings {
  geminiApiKey: string;
  /** Preferred TTS voice; empty string means "browser default English voice". */
  voiceURI: string;
  /** TTS speaking rate. 0.8 is a good shadowing default (slightly slow). */
  speechRate: number;
  strictness: Strictness;
  soundEffects: boolean;
}

/** The entire persisted application state (LocalStorage document). */
export interface AppState {
  profile: Profile;
  sentences: Sentence[];
  sessions: SessionRecord[];
  settings: Settings;
}

/** A built-in shadowing lesson sentence. */
export interface LessonSentence {
  id: string;
  text: string;
  difficulty: "beginner" | "intermediate" | "advanced";
}

/** A themed group of built-in lesson sentences. */
export interface LessonCategory {
  id: string;
  title: string;
  description: string;
  sentences: LessonSentence[];
}
