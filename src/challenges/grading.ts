/**
 * Shared grading primitives.
 *
 * normalizeAnswer lived inside the lesson engine before Phase 1. It moved
 * here because forgiveness rules are a grading concern, not a progression
 * concern — the engine no longer knows how any kind is judged.
 */
import type { Challenge, GradeResult, Submission } from "./types";

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

/** The grader shared by every kind judged on exact (forgiving) wording. */
export function gradeTextEquality(
  challenge: Challenge,
  submission: Submission
): Promise<GradeResult> {
  return Promise.resolve({
    correct: normalizeAnswer(submission.text) === normalizeAnswer(challenge.answer),
    attempted: submission.text,
  });
}
