/**
 * Content → challenge compilers. Moved out of the lesson engine in Phase 1:
 * what a lesson CONTAINS is a content concern; how a run PROGRESSES is the
 * engine's. Scenario drills (Phase 2) and story beats (Phase 5) get their own
 * compilers beside this one.
 */
import type { LessonSentence } from "../types";
import type { Challenge } from "./types";

/** Unbiased Fisher–Yates over a copy — never mutates the caller's array. */
function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Compile lesson sentences into an alternating challenge sequence: dictation
 * (exercises the ear) then arrange (the word bank exercises syntax). The word
 * bank is shuffled once here so a re-render can never reshuffle tiles under
 * the learner's cursor.
 */
export function buildChallenges(sentences: LessonSentence[]): Challenge[] {
  return sentences.map((sentence, index): Challenge => {
    if (index % 2 === 0) {
      return {
        id: `${sentence.id}-listen`,
        prompt: "Type what you hear",
        answer: sentence.text,
        spec: { kind: "dictation" },
      };
    }
    const words = sentence.text.replace(/[.,!?;:]/g, "").split(/\s+/);
    return {
      id: `${sentence.id}-arrange`,
      prompt: "Arrange the words into a sentence",
      answer: sentence.text,
      spec: { kind: "arrange", wordBank: shuffled(words) },
    };
  });
}
