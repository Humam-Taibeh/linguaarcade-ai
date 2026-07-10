/**
 * The challenge framework's single extension point: kind → module.
 *
 * Adding a challenge type = one ChallengeSpec union member + one module file
 * in kinds/ + one entry here. The Record<ChallengeKind, …> shape makes the
 * compiler enforce that every union member is registered — forgetting the
 * entry is a type error, not a runtime surprise.
 */
import type {
  Challenge,
  ChallengeKind,
  ChallengeModule,
  GradeResult,
  Submission,
} from "./types";
import { arrangeModule } from "./kinds/arrange";
import { dictationModule } from "./kinds/dictation";
import { translationModule } from "./kinds/translation";

const registry: Record<ChallengeKind, ChallengeModule> = {
  arrange: arrangeModule,
  dictation: dictationModule,
  translation: translationModule,
};

/** Grade a submission with the module registered for the challenge's kind. */
export function gradeChallenge(
  challenge: Challenge,
  submission: Submission
): Promise<GradeResult> {
  return registry[challenge.spec.kind].grade(challenge, submission);
}
