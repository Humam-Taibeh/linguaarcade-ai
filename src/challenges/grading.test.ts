/**
 * Grading contract tests: the forgiveness rules and the registry dispatch.
 * Every kind registered today grades on text equality; these tests pin that
 * each one resolves through gradeChallenge with the same forgiving semantics
 * the engine invariants assume.
 */
import { describe, expect, it } from "vitest";
import { normalizeAnswer } from "./grading";
import { gradeChallenge } from "./registry";
import type { Challenge, ChallengeSpec } from "./types";

describe("normalizeAnswer", () => {
  it("forgives case, punctuation, and whitespace", () => {
    expect(normalizeAnswer("  I'm READY,   friend!! ")).toBe(normalizeAnswer("im ready friend"));
  });

  it("still distinguishes word order and word choice", () => {
    expect(normalizeAnswer("the cat sat")).not.toBe(normalizeAnswer("sat the cat"));
    expect(normalizeAnswer("a big dog")).not.toBe(normalizeAnswer("a large dog"));
  });
});

describe("gradeChallenge", () => {
  const specs: ChallengeSpec[] = [
    { kind: "arrange", wordBank: ["ready", "am", "I"] },
    { kind: "dictation" },
    { kind: "translation", source: "أنا جاهز" },
  ];

  for (const spec of specs) {
    it(`grades "${spec.kind}" with forgiving equality and a verbatim attempt`, async () => {
      const challenge: Challenge = { id: "c0", prompt: "p", answer: "I am ready.", spec };
      await expect(gradeChallenge(challenge, { text: "i am READY" })).resolves.toEqual({
        correct: true,
        attempted: "i am READY",
      });
      await expect(gradeChallenge(challenge, { text: "i am reddy" })).resolves.toEqual({
        correct: false,
        attempted: "i am reddy",
      });
    });
  }
});
