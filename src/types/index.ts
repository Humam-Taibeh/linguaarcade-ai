/**
 * Shared domain types for LinguaArcade AI.
 *
 * Why a single types module: the app state is persisted to LocalStorage as one
 * JSON document, so every feature must agree on the exact same shapes. Keeping
 * them in one file makes the persisted schema auditable at a glance and makes
 * schema evolution (see STORAGE_KEY versioning in lib/storage.ts) deliberate.
 */

/** Top-level navigation targets rendered by <App/>. */
export type View =
  | "dashboard"
  | "shadowing"
  | "review"
  | "conversation"
  | "scenario"
  | "sentences"
  | "settings";

/** How harshly the pronunciation scorer judges near-misses. */
export type Strictness = "standard" | "strict";

/** UI color theme. Persisted so the choice survives reloads on every device. */
export type ThemeMode = "dark" | "light";

/**
 * Which AI backend powers the tutor. The selected engine is tried first;
 * on failure the client fails over to the other *configured* engines.
 * - "groq": Groq cloud (OpenAI-compatible, very fast open models).
 * - "gemini": Google Gemini cloud API, authenticated with the user's own key.
 * - "ollama": a local Ollama instance exposed through an ngrok tunnel.
 */
export type AiEngine = "groq" | "gemini" | "ollama";

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

/**
 * A phrase captured by the Spaced Repetition System. Any shadowing take that
 * scores below the capture threshold lands here, and the item survives until
 * the user re-shadows it at green level (see REVIEW_* constants in the state
 * module). Persisting the queue makes weak phrases impossible to "lose".
 */
export interface ReviewItem {
  id: string;
  text: string;
  /** The most recent (failing) accuracy — shows the user how close they are. */
  lastScore: number;
  /** Re-shadowing attempts made from the Review Studio. */
  attempts: number;
  addedAt: string; // ISO timestamp
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
  /** Preferred tutor backend; others act as automatic fallbacks. */
  aiEngine: AiEngine;
  geminiApiKey: string;
  groqApiKey: string;
  /** ngrok tunnel origin for the local Ollama server, without a trailing path. */
  ollamaBaseUrl: string;
  /** Model tag served by the local Ollama instance (e.g. "llama3"). */
  ollamaModel: string;
  /** Preferred TTS voice; empty string means "browser default English voice". */
  voiceURI: string;
  /** TTS speaking rate. 0.8 is a good shadowing default (slightly slow). */
  speechRate: number;
  /** TTS pitch. 1 = the voice's neutral tone; small lifts read warmer. */
  speechPitch: number;
  strictness: Strictness;
  soundEffects: boolean;
  theme: ThemeMode;
}

/** The entire persisted application state (LocalStorage document). */
export interface AppState {
  profile: Profile;
  sentences: Sentence[];
  sessions: SessionRecord[];
  reviewQueue: ReviewItem[];
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
