/**
 * Contract A of the modular challenge framework (docs/ARCHITECTURE.md §4).
 *
 * Every challenge kind joins the ChallengeSpec union and registers a module
 * in challenges/registry.ts. The progression engine (engines/lessonEngine)
 * never sees these types — it consumes resolved grade results — so adding a
 * kind requires zero engine edits. That separation IS the framework.
 */

/** Tap the shuffled word bank into the correct order — syntax drilling. */
export interface ArrangeSpec {
  kind: "arrange";
  /** Pre-shuffled once at build time so a re-render can never reshuffle
   * tiles under the learner's cursor. */
  wordBank: string[];
}

/** Listen (TTS plays the answer) and type what was heard — ear drilling. */
export interface DictationSpec {
  kind: "dictation";
}

/** Produce the English for a given source line. */
export interface TranslationSpec {
  kind: "translation";
  source: string;
}

/**
 * The open union. Roadmap kinds slot in here as new members: "choice"
 * (what did he say?), "speak" (pronunciation-scored), "match", "story-choice".
 */
export type ChallengeSpec = ArrangeSpec | DictationSpec | TranslationSpec;

export type ChallengeKind = ChallengeSpec["kind"];

/** One playable challenge: the display envelope plus the kind payload. */
export interface Challenge {
  id: string;
  /** Instruction line, e.g. "Type what you hear". */
  prompt: string;
  /** Canonical display solution — feedback banners and miss records. */
  answer: string;
  spec: ChallengeSpec;
}

/**
 * What the learner produced. Today's kinds all submit assembled or typed
 * text; speech kinds add a transcript and choice kinds an index in later
 * phases — as optional fields here, so graders keep a single signature.
 */
export interface Submission {
  text: string;
}

/**
 * A grading outcome. Structurally a superset of the engine's CheckResult, so
 * it dispatches straight into the lesson reducer without conversion.
 */
export interface GradeResult {
  correct: boolean;
  /** Verbatim learner output, for miss records ("you wrote X → answer Y"). */
  attempted: string;
  /** 0–100 where the kind grades on a scale (speech); equality kinds omit it. */
  accuracy?: number;
}

/**
 * A challenge kind's pluggable behavior. This interface grows with the
 * roadmap: Phase 2 adds `drillFrom` (how a DrillItem re-drills as this kind),
 * Phase 4 adds `Render` (the interactive card component).
 */
export interface ChallengeModule {
  /** Async by contract: speech and AI-judge graders need it. */
  grade(challenge: Challenge, submission: Submission): Promise<GradeResult>;
}
