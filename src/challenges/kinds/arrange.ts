/**
 * "Arrange the words into a sentence" — syntax drilling. The learner taps a
 * shuffled word bank into order; the assembled sentence grades on forgiving
 * textual equality. Phase 2 adds drillFrom (syntax DrillItems re-drill as
 * arrange challenges); Phase 4 moves the renderer here from LessonFlow.
 */
import { gradeTextEquality } from "../grading";
import type { ChallengeModule } from "../types";

export const arrangeModule: ChallengeModule = {
  grade: gradeTextEquality,
};
