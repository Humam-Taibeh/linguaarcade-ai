/**
 * Invariant suite for the lesson engine. These tests were written against the
 * pre-refactor engine and kept green through the Phase 1 grading extraction
 * (docs/ARCHITECTURE.md §11): mastery re-queue, hearts economy, XP math,
 * progress monotonicity, and guard actions. If a change breaks one of these,
 * it changed the product, not just the code.
 *
 * Note the engine is exercised through plain ChallengeBase objects — no kind,
 * no spec. That is itself an invariant: the engine must stay kind-agnostic.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_HEARTS,
  XP_PER_CHALLENGE,
  XP_PERFECT_BONUS,
  createLesson,
  lessonReducer,
  progressFraction,
  type ChallengeBase,
  type LessonState,
} from "./lessonEngine";
import { normalizeAnswer } from "../challenges/grading";

/**
 * The seam the Phase 1 refactor moved: grading now happens before dispatch.
 * This helper grades exactly the way the registry's text-equality kinds do,
 * then dispatches the result — mirroring the view's flow so the invariants
 * below read the same as they did against the self-grading engine.
 */
function check(state: LessonState, answer: string): LessonState {
  const current = state.queue[0];
  return lessonReducer(state, {
    type: "CHECK",
    result: {
      correct:
        current !== undefined && normalizeAnswer(answer) === normalizeAnswer(current.answer),
      attempted: answer,
    },
  });
}

function skip(state: LessonState): LessonState {
  return lessonReducer(state, { type: "SKIP" });
}

function cont(state: LessonState): LessonState {
  return lessonReducer(state, { type: "CONTINUE" });
}

function makeChallenge(id: string, answer: string): ChallengeBase {
  return { id, prompt: `Say: ${answer}`, answer };
}

function makeLesson(answers: string[]): LessonState {
  return createLesson(answers.map((answer, i) => makeChallenge(`c${i}`, answer)));
}

// ---------------------------------------------------------------------------

describe("createLesson", () => {
  it("starts in answering with full hearts and a fixed total", () => {
    const state = makeLesson(["one", "two", "three"]);
    expect(state.phase).toBe("answering");
    expect(state.hearts).toBe(MAX_HEARTS);
    expect(state.total).toBe(3);
    expect(state.queue).toHaveLength(3);
    expect(state.solved).toBe(0);
    expect(state.xpEarned).toBe(0);
    expect(state.misses).toEqual([]);
  });

  it("treats an empty plan as already complete", () => {
    const state = createLesson([]);
    expect(state.phase).toBe("complete");
    expect(progressFraction(state)).toBe(1);
  });
});

describe("CHECK", () => {
  it("accepts a forgiving match: verdict correct, XP paid, no heart lost", () => {
    const state = check(makeLesson(["I am ready."]), "i am READY");
    expect(state.phase).toBe("checked");
    expect(state.verdict).toBe("correct");
    expect(state.xpEarned).toBe(XP_PER_CHALLENGE);
    expect(state.hearts).toBe(MAX_HEARTS);
    expect(state.mistakes).toBe(0);
    expect(state.misses).toEqual([]);
  });

  it("charges a heart and records the miss on a wrong answer", () => {
    const state = check(makeLesson(["I am ready."]), "you are ready");
    expect(state.verdict).toBe("incorrect");
    expect(state.hearts).toBe(MAX_HEARTS - 1);
    expect(state.mistakes).toBe(1);
    expect(state.xpEarned).toBe(0);
    expect(state.misses).toEqual([
      {
        challengeId: "c0",
        prompt: "Say: I am ready.",
        answer: "I am ready.",
        attempted: "you are ready",
      },
    ]);
  });

  it("is a no-op outside the answering phase", () => {
    const checked = check(makeLesson(["one"]), "one");
    expect(check(checked, "one")).toBe(checked);
  });
});

describe("SKIP", () => {
  it("counts as an honest miss with a null attempt", () => {
    const state = skip(makeLesson(["one", "two"]));
    expect(state.phase).toBe("checked");
    expect(state.verdict).toBe("incorrect");
    expect(state.hearts).toBe(MAX_HEARTS - 1);
    expect(state.mistakes).toBe(1);
    expect(state.misses[0].attempted).toBeNull();
  });

  it("is a no-op outside the answering phase", () => {
    const checked = check(makeLesson(["one"]), "one");
    expect(skip(checked)).toBe(checked);
  });
});

describe("CONTINUE", () => {
  it("advances past a correct answer: solved increments, queue shrinks", () => {
    const state = cont(check(makeLesson(["one", "two"]), "one"));
    expect(state.phase).toBe("answering");
    expect(state.verdict).toBeNull();
    expect(state.solved).toBe(1);
    expect(state.queue.map((c) => c.id)).toEqual(["c1"]);
  });

  it("re-queues a missed challenge at the back — mastery is the only exit", () => {
    const state = cont(check(makeLesson(["one", "two"]), "wrong"));
    expect(state.solved).toBe(0);
    expect(state.queue.map((c) => c.id)).toEqual(["c1", "c0"]);
    expect(state.total).toBe(2); // retries never grow the journey
  });

  it("is a no-op outside the checked phase", () => {
    const answering = makeLesson(["one"]);
    expect(cont(answering)).toBe(answering);
  });
});

describe("hearts economy", () => {
  it("ends the run in failed (paying nothing) when the last heart is lost", () => {
    let state = makeLesson(["one", "two"]);
    // Burn every heart on the same re-queued challenge.
    for (let i = 0; i < MAX_HEARTS - 1; i++) {
      state = cont(check(state, "wrong"));
      expect(state.phase).toBe("answering");
    }
    state = check(state, "wrong");
    expect(state.hearts).toBe(0);
    state = cont(state);
    expect(state.phase).toBe("failed");
    expect(state.verdict).toBeNull();
    expect(state.xpEarned).toBe(0);
    expect(state.misses).toHaveLength(MAX_HEARTS);
  });
});

describe("completion and XP economy", () => {
  it("pays per-challenge XP plus the perfect bonus on a flawless run", () => {
    let state = makeLesson(["one", "two", "three"]);
    for (const answer of ["one", "two", "three"]) {
      state = cont(check(state, answer));
    }
    expect(state.phase).toBe("complete");
    expect(state.solved).toBe(3);
    expect(state.xpEarned).toBe(3 * XP_PER_CHALLENGE + XP_PERFECT_BONUS);
  });

  it("completes through mastery after a miss, without the bonus", () => {
    let state = makeLesson(["one", "two"]);
    state = cont(check(state, "wrong")); // c0 re-queued behind c1
    state = cont(check(state, "two"));
    state = cont(check(state, "one")); // c0 mastered on the retry
    expect(state.phase).toBe("complete");
    expect(state.solved).toBe(2);
    expect(state.xpEarned).toBe(2 * XP_PER_CHALLENGE);
    expect(state.mistakes).toBe(1);
  });

  it("forfeits the perfect bonus for a skip even when every answer was right", () => {
    let state = makeLesson(["one"]);
    state = cont(skip(state));
    state = cont(check(state, "one"));
    expect(state.phase).toBe("complete");
    expect(state.xpEarned).toBe(XP_PER_CHALLENGE);
  });

  it("records every miss of a re-queued challenge separately", () => {
    let state = makeLesson(["one"]);
    state = cont(check(state, "wrong once"));
    state = cont(check(state, "wrong twice"));
    expect(state.misses.map((m) => m.attempted)).toEqual(["wrong once", "wrong twice"]);
  });
});

describe("progressFraction", () => {
  it("moves only on correct answers and never rewinds", () => {
    let state = makeLesson(["one", "two"]);
    expect(progressFraction(state)).toBe(0);
    state = cont(check(state, "wrong"));
    expect(progressFraction(state)).toBe(0);
    state = cont(check(state, "two"));
    expect(progressFraction(state)).toBe(0.5);
    state = cont(check(state, "one"));
    expect(progressFraction(state)).toBe(1);
  });
});
