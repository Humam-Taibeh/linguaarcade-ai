/**
 * "Type what you hear" — ear drilling. TTS speaks the answer (a view effect);
 * the transcription grades on forgiving textual equality. Phase 2 adds
 * drillFrom (listening DrillItems re-drill as dictation); Phase 4 moves the
 * renderer here from LessonFlow.
 */
import { gradeTextEquality } from "../grading";
import type { ChallengeModule } from "../types";

export const dictationModule: ChallengeModule = {
  grade: gradeTextEquality,
};
