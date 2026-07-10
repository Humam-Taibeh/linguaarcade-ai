/**
 * Guided-lesson quiz engine — the Duolingo-style progression core, as a pure,
 * UI-free state machine.
 *
 * Architecture: the engine is a reducer over an immutable LessonState. The
 * view layer (next sprint) renders `queue[0]`, dispatches CHECK / CONTINUE /
 * SKIP, and animates off `phase` + `verdict`. Keeping the engine pure means:
 *   - it is unit-testable without a DOM,
 *   - sound (lib/audio/chimes) and XP dispatch (RECORD_SESSION) stay in the
 *     view as effects of state transitions, never inside the engine,
 *   - the progress bar can never desync from the actual queue.
 *
 * The Duolingo signatures reproduced here:
 *   - a missed challenge is NOT failed — it re-queues at the back and must
 *     eventually be answered correctly, so every finished lesson ends in
 *     mastery. The progress bar advances only on correct answers and its
 *     denominator never grows, so retries feel like "finishing the same
 *     journey", not being punished with extra distance.
 *   - hearts: every mistake costs one; at zero the run ends in "failed" and
 *     the view offers a restart. Stakes are what make the Check button tense.
 */
import type { LessonSentence } from "../types";

// ---------------------------------------------------------------------------
// Challenge model
// ---------------------------------------------------------------------------

/**
 * Challenge kinds the engine grades today — all three resolve through
 * `normalizeAnswer` equality, so the reducer needs no per-kind branches.
 * Future kinds slot in by extending grading, not the state machine:
 * "speak" delegates to lib/speech/scorer, "match" grades pair sets.
 */
export type ChallengeKind = "arrange" | "type-what-you-hear" | "translation";

export interface Challenge {
  id: string;
  kind: ChallengeKind;
  /** The instruction line, e.g. "Type what you hear". */
  prompt: string;
  /** Canonical solution — shown in the feedback banner after a miss. */
  answer: string;
  /** Word bank for "arrange" challenges, pre-shuffled once at build time. */
  wordBank?: string[];
}

export type Verdict = "correct" | "incorrect";
/** "failed" = hearts exhausted; terminal like "complete" but pays no XP. */
export type LessonPhase = "answering" | "checked" | "complete" | "failed";

/** One missed attempt, captured for the end-of-lesson summary. */
export interface MissRecord {
  challengeId: string;
  prompt: string;
  /** The canonical solution the learner eventually had to master. */
  answer: string;
  /** What the learner submitted; null when the challenge was skipped. */
  attempted: string | null;
}

export interface LessonState {
  /** Remaining work; `queue[0]` is the live challenge. Misses re-queue at the back. */
  queue: Challenge[];
  phase: LessonPhase;
  /** Set while phase === "checked"; drives the green/red feedback banner. */
  verdict: Verdict | null;
  /** Correct answers so far — the progress-bar numerator. */
  solved: number;
  /** Fixed at the plan's length — retries never grow the journey. */
  total: number;
  mistakes: number;
  /** Remaining hearts. Every mistake (or skip) costs one; zero ends the run. */
  hearts: number;
  xpEarned: number;
  /** Every miss in submission order — the "what went wrong" summary data.
   * A re-queued challenge missed again appears once per miss. */
  misses: MissRecord[];
}

/** Per-challenge award, matched to the app's existing XP economy (~80 XP/day). */
export const XP_PER_CHALLENGE = 10;
/** Flawless-run bonus, granted once at completion. */
export const XP_PERFECT_BONUS = 20;
/** Duolingo-standard heart count: forgiving enough to finish, tense enough to care. */
export const MAX_HEARTS = 5;

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Forgiving textual equality: case, punctuation, and whitespace are learner
 * noise, not language errors. Word ORDER and word CHOICE are what we grade.
 */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"‘’“”-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type LessonAction =
  | { type: "CHECK"; answer: string }
  | { type: "CONTINUE" }
  | { type: "SKIP" };

export function createLesson(challenges: Challenge[]): LessonState {
  return {
    queue: challenges,
    phase: challenges.length > 0 ? "answering" : "complete",
    verdict: null,
    solved: 0,
    total: challenges.length,
    mistakes: 0,
    hearts: MAX_HEARTS,
    xpEarned: 0,
    misses: [],
  };
}

export function lessonReducer(state: LessonState, action: LessonAction): LessonState {
  switch (action.type) {
    // Grade the live challenge. The verdict freezes the UI into feedback
    // mode; nothing advances until an explicit CONTINUE, mirroring the
    // check → feedback → continue cadence that makes quiz flows feel fair.
    case "CHECK": {
      if (state.phase !== "answering" || state.queue.length === 0) return state;
      const current = state.queue[0];
      const correct = normalizeAnswer(action.answer) === normalizeAnswer(current.answer);
      return {
        ...state,
        phase: "checked",
        verdict: correct ? "correct" : "incorrect",
        mistakes: state.mistakes + (correct ? 0 : 1),
        hearts: state.hearts - (correct ? 0 : 1),
        xpEarned: state.xpEarned + (correct ? XP_PER_CHALLENGE : 0),
        misses: correct
          ? state.misses
          : [
              ...state.misses,
              {
                challengeId: current.id,
                prompt: current.prompt,
                answer: current.answer,
                attempted: action.answer,
              },
            ],
      };
    }

    // Skipping is an honest miss: the learner sees the answer now and will
    // face the same challenge again before the lesson can end.
    case "SKIP": {
      if (state.phase !== "answering" || state.queue.length === 0) return state;
      const current = state.queue[0];
      return {
        ...state,
        phase: "checked",
        verdict: "incorrect",
        mistakes: state.mistakes + 1,
        hearts: state.hearts - 1,
        misses: [
          ...state.misses,
          {
            challengeId: current.id,
            prompt: current.prompt,
            answer: current.answer,
            attempted: null,
          },
        ],
      };
    }

    case "CONTINUE": {
      if (state.phase !== "checked") return state;
      // Out of hearts: the run ends here. The view offers a restart; XP is
      // forfeited by never dispatching RECORD_SESSION — failed runs don't pay.
      if (state.verdict === "incorrect" && state.hearts <= 0) {
        return { ...state, phase: "failed", verdict: null };
      }
      const [current, ...rest] = state.queue;
      const solved = state.solved + (state.verdict === "correct" ? 1 : 0);
      // Miss → the challenge rejoins the back of the queue: mastery is the
      // only exit condition a lesson has.
      const queue = state.verdict === "correct" ? rest : [...rest, current];
      if (queue.length === 0) {
        return {
          ...state,
          queue,
          solved,
          phase: "complete",
          verdict: null,
          // Flawless means flawless: `mistakes` counts wrong answers AND
          // skips (both paths increment it in CHECK/SKIP), so one skip
          // anywhere permanently forfeits the bonus.
          xpEarned: state.xpEarned + (state.mistakes === 0 ? XP_PERFECT_BONUS : 0),
        };
      }
      return { ...state, queue, solved, phase: "answering", verdict: null };
    }

    default:
      return state;
  }
}

/** Progress-bar fraction: only correct answers move it, and it never rewinds. */
export function progressFraction(state: LessonState): number {
  return state.total > 0 ? state.solved / state.total : 1;
}

// ---------------------------------------------------------------------------
// Challenge building
// ---------------------------------------------------------------------------

/**
 * Compile lesson sentences into an alternating challenge sequence: listen
 * (type-what-you-hear exercises the ear) then arrange (the word bank
 * exercises syntax). The word bank is shuffled once here so a re-render can
 * never reshuffle tiles under the learner's cursor.
 */
export function buildChallenges(sentences: LessonSentence[]): Challenge[] {
  return sentences.map((sentence, index) => {
    if (index % 2 === 0) {
      return {
        id: `${sentence.id}-listen`,
        kind: "type-what-you-hear" as const,
        prompt: "Type what you hear",
        answer: sentence.text,
      };
    }
    const words = sentence.text.replace(/[.,!?;:]/g, "").split(/\s+/);
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }
    return {
      id: `${sentence.id}-arrange`,
      kind: "arrange" as const,
      prompt: "Arrange the words into a sentence",
      answer: sentence.text,
      wordBank: words,
    };
  });
}
