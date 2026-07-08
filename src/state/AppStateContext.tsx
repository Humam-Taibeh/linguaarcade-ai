/**
 * Central application state: profile (XP / streak), custom sentences, session
 * history, the SRS review queue, and settings.
 *
 * Why Context + useReducer instead of a state library: the state is one small
 * document with a handful of well-defined transitions. A reducer gives us
 * auditable, serializable transitions (perfect for LocalStorage persistence)
 * with zero dependencies — the right altitude for this app's complexity.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type {
  AppState,
  Profile,
  ReviewItem,
  SessionRecord,
  Sentence,
  Settings,
} from "../types";
import { loadPersistedState, savePersistedState } from "../lib/storage";

// ---------------------------------------------------------------------------
// SRS thresholds
// ---------------------------------------------------------------------------

/** A shadowing take below this accuracy is captured into the review queue. */
export const REVIEW_CAPTURE_THRESHOLD = 60;
/** A Review Studio attempt at or above this accuracy clears the item (green). */
export const REVIEW_CLEAR_THRESHOLD = 85;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PROFILE: Profile = {
  xp: 0,
  currentStreak: 0,
  bestStreak: 0,
  lastPracticeDay: null,
  totalSessions: 0,
};

const DEFAULT_SETTINGS: Settings = {
  // "ollama" preserves the behavior of existing installs, which currently
  // route every conversation through the local tunnel.
  aiEngine: "ollama",
  geminiApiKey: "",
  ollamaBaseUrl: "https://handwrite-oboe-cozy.ngrok-free.dev",
  ollamaModel: "llama3",
  voiceURI: "",
  speechRate: 0.9,
  strictness: "standard",
  soundEffects: true,
  theme: "dark",
};

export const INITIAL_STATE: AppState = {
  profile: DEFAULT_PROFILE,
  sentences: [],
  sessions: [],
  reviewQueue: [],
  settings: DEFAULT_SETTINGS,
};

/** Keep only the most recent session records to bound LocalStorage growth. */
const MAX_SESSION_HISTORY = 100;
/** Hard cap on the SRS queue: past this size, more captures would be noise. */
const MAX_REVIEW_QUEUE = 50;

// ---------------------------------------------------------------------------
// Leveling math
// ---------------------------------------------------------------------------

/**
 * Quadratic XP curve: level N requires 60·N² cumulative XP. Early levels come
 * fast (hooks the habit), later levels reward consistency — the standard
 * gamification shape, tuned so a good daily session (~80 XP) levels a new
 * user up on day one.
 */
export function xpRequiredForLevel(level: number): number {
  return 60 * level * level;
}

export function levelFromXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 60)) + 1;
}

/** Progress toward the next level, for the dashboard progress bar. */
export function levelProgress(xp: number): {
  level: number;
  intoLevel: number;
  neededForNext: number;
  fraction: number;
} {
  const level = levelFromXp(xp);
  const floor = xpRequiredForLevel(level - 1);
  const ceiling = xpRequiredForLevel(level);
  const intoLevel = xp - floor;
  const neededForNext = ceiling - floor;
  return {
    level,
    intoLevel,
    neededForNext,
    fraction: neededForNext > 0 ? Math.min(1, intoLevel / neededForNext) : 1,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export type Action =
  | {
      type: "RECORD_SESSION";
      kind: SessionRecord["kind"];
      accuracy: number | null;
      xpEarned: number;
      textPreview: string;
    }
  | { type: "ADD_SENTENCES"; texts: string[] }
  | { type: "DELETE_SENTENCE"; id: string }
  | { type: "UPDATE_SENTENCE_STATS"; id: string; score: number }
  | { type: "ADD_REVIEW_ITEM"; text: string; score: number }
  | { type: "REVIEW_ATTEMPT"; id: string; score: number }
  | { type: "UPDATE_SETTINGS"; settings: Partial<Settings> }
  | { type: "RESET_ALL" };

/** Local-timezone calendar day, e.g. "2026-07-08". Streaks are a local-day concept. */
export function todayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}

/** Streak transition: same day → unchanged; consecutive day → +1; gap → reset to 1. */
function advanceStreak(profile: Profile): Pick<Profile, "currentStreak" | "bestStreak" | "lastPracticeDay"> {
  const today = todayKey();
  if (profile.lastPracticeDay === today) {
    return {
      currentStreak: profile.currentStreak,
      bestStreak: profile.bestStreak,
      lastPracticeDay: today,
    };
  }
  const nextStreak = profile.lastPracticeDay === yesterdayKey() ? profile.currentStreak + 1 : 1;
  return {
    currentStreak: nextStreak,
    bestStreak: Math.max(profile.bestStreak, nextStreak),
    lastPracticeDay: today,
  };
}

function makeId(): string {
  // crypto.randomUUID is available in every browser this app targets.
  return crypto.randomUUID();
}

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "RECORD_SESSION": {
      const record: SessionRecord = {
        id: makeId(),
        kind: action.kind,
        accuracy: action.accuracy,
        xpEarned: action.xpEarned,
        textPreview: action.textPreview.slice(0, 80),
        completedAt: new Date().toISOString(),
      };
      return {
        ...state,
        profile: {
          ...state.profile,
          ...advanceStreak(state.profile),
          xp: state.profile.xp + action.xpEarned,
          totalSessions: state.profile.totalSessions + 1,
        },
        sessions: [record, ...state.sessions].slice(0, MAX_SESSION_HISTORY),
      };
    }

    case "ADD_SENTENCES": {
      const now = new Date().toISOString();
      const additions: Sentence[] = action.texts
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        // Skip exact duplicates so pasting the same script twice is harmless.
        .filter((t) => !state.sentences.some((s) => s.text === t))
        .map((text) => ({
          id: makeId(),
          text,
          createdAt: now,
          timesPracticed: 0,
          bestScore: 0,
        }));
      if (additions.length === 0) return state;
      return { ...state, sentences: [...additions, ...state.sentences] };
    }

    case "DELETE_SENTENCE":
      return {
        ...state,
        sentences: state.sentences.filter((s) => s.id !== action.id),
      };

    case "UPDATE_SENTENCE_STATS":
      return {
        ...state,
        sentences: state.sentences.map((s) =>
          s.id === action.id
            ? {
                ...s,
                timesPracticed: s.timesPracticed + 1,
                bestScore: Math.max(s.bestScore, action.score),
              }
            : s
        ),
      };

    case "ADD_REVIEW_ITEM": {
      const text = action.text.trim();
      if (!text) return state;
      // Deduplicate by exact text: failing the same phrase again just
      // refreshes its score instead of flooding the queue with copies.
      const existing = state.reviewQueue.find((item) => item.text === text);
      if (existing) {
        return {
          ...state,
          reviewQueue: state.reviewQueue.map((item) =>
            item.id === existing.id ? { ...item, lastScore: action.score } : item
          ),
        };
      }
      const item: ReviewItem = {
        id: makeId(),
        text,
        lastScore: action.score,
        attempts: 0,
        addedAt: new Date().toISOString(),
      };
      return {
        ...state,
        reviewQueue: [...state.reviewQueue, item].slice(0, MAX_REVIEW_QUEUE),
      };
    }

    case "REVIEW_ATTEMPT": {
      // Green take → the item graduates out of the queue. Anything less
      // records the attempt so the user sees their trajectory on the card.
      if (action.score >= REVIEW_CLEAR_THRESHOLD) {
        return {
          ...state,
          reviewQueue: state.reviewQueue.filter((item) => item.id !== action.id),
        };
      }
      return {
        ...state,
        reviewQueue: state.reviewQueue.map((item) =>
          item.id === action.id
            ? { ...item, attempts: item.attempts + 1, lastScore: action.score }
            : item
        ),
      };
    }

    case "UPDATE_SETTINGS":
      return {
        ...state,
        settings: { ...state.settings, ...action.settings },
      };

    case "RESET_ALL":
      // Deliberately preserves settings: wiping progress should not force the
      // user to re-enter their API key and re-tune their voice.
      return { ...INITIAL_STATE, settings: state.settings };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context plumbing
// ---------------------------------------------------------------------------

interface AppStateContextValue {
  state: AppState;
  dispatch: Dispatch<Action>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    appReducer,
    undefined,
    // Lazy initializer: read LocalStorage exactly once, merging over defaults
    // so newly added fields (theme, reviewQueue, ...) get sane values on
    // documents saved by older versions of the app.
    (): AppState => {
      const persisted = loadPersistedState();
      if (!persisted) return INITIAL_STATE;
      return {
        profile: { ...DEFAULT_PROFILE, ...persisted.profile },
        sentences: persisted.sentences ?? [],
        sessions: persisted.sessions ?? [],
        reviewQueue: persisted.reviewQueue ?? [],
        settings: { ...DEFAULT_SETTINGS, ...persisted.settings },
      };
    }
  );

  // Persist on every transition. The state document is tiny (a few KB), so
  // writing eagerly is simpler and safer than debouncing.
  useEffect(() => {
    savePersistedState(state);
  }, [state]);

  // Theme is applied as a root attribute so pure CSS handles every color
  // swap ([data-theme] token blocks in global.css) — no React re-styling.
  // index.html sets the same attribute pre-paint to avoid a theme flash.
  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state.settings.theme]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used inside <AppStateProvider>");
  }
  return context;
}
