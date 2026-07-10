/**
 * Compiler tests: lesson sentences → the alternating dictation/arrange
 * sequence the guided-lesson flow runs on.
 */
import { describe, expect, it } from "vitest";
import { buildChallenges } from "./compile";

const sentences = [
  { id: "s0", text: "The cat sat down.", difficulty: "beginner" as const },
  { id: "s1", text: "Dogs bark loudly, friend!", difficulty: "beginner" as const },
];

describe("buildChallenges", () => {
  it("alternates dictation and arrange challenges", () => {
    const [listen, arrange] = buildChallenges(sentences);
    expect(listen.id).toBe("s0-listen");
    expect(listen.spec.kind).toBe("dictation");
    expect(listen.answer).toBe("The cat sat down.");
    expect(arrange.id).toBe("s1-arrange");
    expect(arrange.spec.kind).toBe("arrange");
    expect(arrange.answer).toBe("Dogs bark loudly, friend!");
  });

  it("builds the arrange word bank as a punctuation-free permutation", () => {
    const [, arrange] = buildChallenges(sentences);
    if (arrange.spec.kind !== "arrange") throw new Error("expected an arrange challenge");
    expect([...arrange.spec.wordBank].sort()).toEqual(
      ["Dogs", "bark", "loudly", "friend"].sort()
    );
  });
});
