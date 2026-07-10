/**
 * "Translate the source line" — vocabulary and phrasing. Grades on forgiving
 * textual equality against the canonical answer for now; a paraphrase-aware
 * grader (keyword coverage / AI judge) is the planned upgrade when Scenario
 * Studio's Hard mode lands (docs/ARCHITECTURE.md §7).
 */
import { gradeTextEquality } from "../grading";
import type { ChallengeModule } from "../types";

export const translationModule: ChallengeModule = {
  grade: gradeTextEquality,
};
