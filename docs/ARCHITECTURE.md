# LinguaArcade 2.0 — Architecture North Star

> **Status: living document.** This is the contract-level blueprint for the pivot from
> "utility app" to world-class gamified language platform. Every phase below links its
> exit criteria; the Status column is updated as phases land. If a code change and this
> document disagree, one of them is a bug — fix whichever is wrong, deliberately.

---

## 1. Vision

LinguaArcade is a **living, breathing language arcade**: scripted high-stakes roleplay,
an infinite variety of drill types, a mastery loop that never lets a mistake escape, and
a UI that celebrates every win through motion and a mascot with real personality.

Four product pillars drive every architectural decision:

1. **Scenario Studio 2.0** — pick a scene + difficulty → AI generates a full script
   (≥10 exchanges per speaker) → the learner *performs* their side, line by line, with
   per-line audio and live speech matching.
2. **Modular Challenge Framework** — listening, speaking, logic, and narrative challenge
   types that plug in without touching the progression engine.
3. **The Mastery Engine** — every miss from every surface flows into one spaced-repetition
   store and is drilled until mastered. Struggle → Fail → Drill → Master.
4. **The Living UI** — fluid motion, juice on every reward, and Lingua the mascot
   reacting to progress in real time.

## 2. Principles (non-negotiable)

These are inherited from the current codebase, which got them right:

- **Pure engines, thin views.** All progression rules (grading outcomes, hearts, mastery
  re-queue, XP, SRS scheduling) live in pure, unit-tested state machines with zero DOM
  or side effects. Views render state and fire effects (TTS, chimes, dispatch) — never
  rules. A view that contains an `if` about progression is a bug.
- **One persisted document, versioned.** App state is a single LocalStorage JSON document
  with auditable reducer transitions. Schema changes ship with an explicit, tested
  migration (see §8).
- **Strict validation at every AI boundary.** Model output is never trusted: every reply
  is schema-validated and structurally coerced (`toTutorReply` is the pattern). Generated
  content that fails validation gets one retry, then a bundled fallback — AI flakiness
  must never dead-end a feature.
- **Zero runtime dependencies unless earned.** The app requires Chromium anyway (Web
  Speech API), so modern platform features — `linear()` spring easings, the View
  Transitions API, WAAPI — replace what animation libraries polyfill. `vitest` is
  dev-only. The one pre-approved future exception: `motion`, *if and only if* layout/FLIP
  animation needs outgrow the platform.
- **Strangler pattern for rewrites.** New surfaces ship alongside old ones (e.g. Scripted
  mode next to Improv mode); nothing is deleted until its replacement has earned it.

## 3. Layer map

```
Layer 5  Views            thin composition only (views/)
Layer 4  Experience       challenge renderers, FeedbackOrchestrator, Mascot, motion (fx/, challenges/kinds/)
Layer 3  State            AppState reducer, storage migrations, juice-event derivation (state/)
Layer 2  Content          challenge compilers, script generator + schema, lesson data (content/, challenges/)
Layer 1  Engines          pure state machines: lesson, dialogue, story (engines/)
Layer 0  Platform         speech recognition/synthesis/scorer, audio chimes, multi-engine AI client (lib/)
```

Dependencies point strictly downward. Engines import nothing above Layer 1; the AI
client knows nothing about challenges; views contain no rules.

## 4. Contract A — `ChallengeSpec` + the challenge registry

**Problem it solves:** the engine used to grade every challenge through one string
equality, so each new challenge type meant editing the state machine. Infinite variety
requires the engine to be kind-agnostic.

```ts
// challenges/types.ts — the discriminated union every challenge kind joins
type ChallengeSpec =
  | { kind: "arrange"; wordBank: string[] }          // tap words into order
  | { kind: "dictation" }                            // type what you hear
  | { kind: "translation"; source: string }          // translate the source line
  | { kind: "choice"; options: string[]; correctIndex: number }  // "What did he say?"
  | { kind: "speak"; threshold: number }             // pronounce it, scorer-graded
  | { kind: "match"; pairs: Array<[string, string]> }
  | { kind: "story-choice"; branches: StoryBranch[] };   // narrative beats (Phase 5)

interface Challenge {
  id: string;
  prompt: string;   // instruction line shown to the learner
  answer: string;   // canonical display solution (feedback banner, miss records)
  spec: ChallengeSpec;
}
```

Each kind registers a module; the registry is the **single extension point**:

```ts
// challenges/registry.ts
interface ChallengeModule {
  /** Grade a submission. Async on purpose: speech and AI-judge graders need it. */
  grade(challenge: Challenge, submission: Submission): Promise<GradeResult>;
  // Phase 2 adds: drillFrom(item: DrillItem): Challenge   (how this kind re-drills)
  // Phase 4 adds: Render: React.FC<ChallengeProps>        (renderer extraction)
}
```

**The engine consumes results, not answers.** `CHECK` carries a resolved
`GradeResult { correct, attempted, accuracy? }`; the view grades via the registry, then
dispatches. Hearts, mastery re-queue, and XP logic never change when a kind is added.
Adding a challenge type = one union member + one module file + registry entry. **Zero
engine edits.**

## 5. Contract B — `DrillItem` + the SRS scheduler (the Mastery Engine)

**Problem it solves:** review only captured low shadowing scores. Mastery requires every
miss, from every surface, in one queue with real spaced repetition.

```ts
// mastery/srs.ts
interface DrillItem {
  id: string;
  skill: "speaking" | "listening" | "syntax" | "vocabulary";
  source: "lesson" | "scenario" | "shadowing" | "conversation";
  expected: string;         // canonical target
  attempted: string | null; // what the learner produced (null = skipped)
  context?: string;         // scene line / correction explanation, frames the drill
  strength: 0 | 1 | 2 | 3;  // Leitner box
  dueAt: string;            // ISO; success promotes + pushes out, lapse demotes
  lapses: number;
  addedAt: string;
}
```

**Capture (mastery/capture.ts):** every surface normalizes misses into `MissEvent`s →
`ADD_DRILL_ITEM`:

| Source | Raw material (already exists) | Becomes |
|---|---|---|
| Guided lessons | engine `MissRecord`s | syntax / listening drills |
| Scenario & Conversation | AI `Correction` cards | vocabulary drills (`attempted = original`, `expected = corrected`) |
| Shadowing | takes below capture threshold | speaking drills (migrates the old `reviewQueue`) |

**Scheduling (Leitner):** success promotes strength and pushes `dueAt` out
(next session → 1 day → 3 days); success at strength 3 **graduates** the item out of the
store. A lapse demotes one box and resets `dueAt` to now. Pure function of
`(item, GradeResult, clock)`.

**Review Studio 2.0 is not a bespoke surface.** `compileReviewLesson(dueItems)` maps
drills through the registry into `Challenge[]`, then runs the ordinary lesson engine —
heartless (`hearts: null`), because mastery is the only exit. Same UI, same juice, same
re-queue mechanics, no parallel review code to maintain.

## 6. Contract C — Juice events (the Living UI's nervous system)

**Problem it solves:** celebrations are transient effects, not state, and today each view
remembers (or forgets) to play its own chime. Consistent reward needs one channel.

- `fx/events.ts`: a tiny typed pub/sub (~30 lines, zero deps).
- The `AppStateProvider` wraps `dispatch` and **derives** events by diffing pre/post
  state: `XP_EARNED`, `LEVEL_UP`, `STREAK_EXTENDED`, `DRILL_GRADUATED`. Views cannot
  forget to celebrate, because the state layer emits for them. Views additionally emit
  view-local beats (`ANSWER_CORRECT`, `HEART_LOST`).
- One `FeedbackOrchestrator` mounts in `App` and subscribes: confetti canvas, XP
  fly-to-counter, chimes (migrating out of views), and the mascot's mood.

**Lingua the mascot** is a parametric SVG rig — eyes, brows, mouth curve,
squash-and-bounce driven by props — with a mood machine that is a *pure function* of
profile + recent events: `idle | happy | cheering | thinking | worried | sleeping`.
Parametric code (not baked animation assets) means every new event gets a reaction for
free; the upgrade path to a Rive asset never changes the component's interface.

**Motion system:** CSS motion tokens (durations + spring curves via `linear()` easing),
a small WAAPI helper for imperative sequences, and the View Transitions API for
navigation morphs. All GPU-composited, all zero-dep, all safe because Chromium is
already a hard requirement.

## 7. Scenario Studio 2.0 — script-first, not chat-first

**The core decision: generate the entire script upfront in one AI call, then perform it
locally.** After generation, every interaction — playback, scoring, retry, advancing —
is instant and offline-stable. That is what makes it feel high-stakes and real-time
rather than laggy chat.

```ts
// content/scenarios/schema.ts
interface ScenarioScript {
  id: string;
  scenario: string;                   // "Job interview for your dream role"
  difficulty: "easy" | "medium" | "hard";
  roles: { ai: string; learner: string };   // "Interviewer", "Candidate"
  lines: ScriptLine[];                // strictly alternating speakers
}
interface ScriptLine {
  speaker: "ai" | "learner";
  text: string;      // the canonical line
  intent?: string;   // "Decline politely, then ask about salary" (Hard mode shows only this)
  hint?: string;     // first-letter / word-bank scaffold (Medium mode)
}
```

- **Generation** (`content/scenarios/generator.ts`): dedicated prompt + call with its own
  token budget (~2048 — the chat client's 512 cap cannot hold a script). Validation
  enforces ≥10 learner lines and ≥10 AI lines, alternation, and non-empty text. One
  retry on failure, then a bundled fallback script for curated scenario cards. Generated
  scripts are cached in storage (capped) for replay.
- **Performance** (`engines/dialogueEngine.ts`): a pure reducer, sibling of the lesson
  engine. Phases: `ai-line` (TTS auto-plays, karaoke word highlight) → `learner-line`
  (perform by voice via the scorer, or type) → `feedback` (accuracy + word diff) →
  advance. Misses emit `MissEvent`s into Contract B automatically.
- **Difficulty changes the performance contract, not just vocabulary:**
  - *Easy* — learner's line fully visible; shadow it; pass ≈60% (existing scorer).
  - *Medium* — line masked to hints/word bank; pass ≈75%.
  - *Hard* — only `intent` shown; paraphrase accepted via keyword-coverage grading,
    optional AI judge when online.
- **Per-line audio:** every line gets a 🔊 button (`speak()` already exists). The voice
  quality ranker assigns **two distinct voices** — AI character vs. learner-line playback
  — so the dialogue has texture. Live word highlighting comes from the recognizer's
  existing `onInterim` stream.
- The current freeform chat survives as **Improv mode** beside **Scripted mode**.

## 8. Persistence & migrations

The persisted document gains a schema version. Migrations are pure
`(vN document) → (vN+1 document)` functions, run in sequence at load, each covered by a
fixture test of a real previous-version document.

- **v1 → v2 (Phase 2):** `reviewQueue: ReviewItem[]` → `drillItems: DrillItem[]`
  (existing items become `skill: "speaking"` drills at strength 0, due now), plus a
  capped `scriptCache`.

## 9. Testing strategy

`vitest` (dev-only, node environment — no DOM needed) is the stability guarantee that
lets us refactor the core under a moving product:

- **Engines** (`lessonEngine`, `dialogueEngine`, `storyEngine`): invariant suites locked
  *before* any refactor touches them — mastery re-queue, hearts, XP economy, progress
  monotonicity, guard actions.
- **Mastery**: Leitner promotion/demotion/graduation as a pure function of clock.
- **Challenges**: each registered kind's grader.
- **AI boundaries**: script/reply schema validators against malformed fixtures.
- **Migrations**: each version step against a fixture document.

Views stay thin enough that they don't need unit tests; `npm run build` (typecheck) and
manual flows cover them.

## 10. Target directory structure

```
src/
  engines/          lessonEngine.ts · dialogueEngine.ts · (Phase 5) storyEngine.ts
  challenges/       types.ts · registry.ts · compile.ts · kinds/{arrange,dictation,translation,choice,speak,match}.ts
  content/          lessons.ts · scenarios/{catalog,generator,schema,fallbacks}.ts
  mastery/          srs.ts · capture.ts
  fx/               events.ts · FeedbackOrchestrator.tsx · Mascot/ · motion.ts
  state/            AppStateContext.tsx · migrations.ts
  lib/              speech/ · audio/ · gemini/ · storage.ts   (Layer 0, stable)
  views/            thin composition only
```

## 11. Phase roadmap

Each phase is independently shippable; contracts come first because everything hangs off
them. Exit criteria are the definition of done.

| Phase | Scope | Exit criteria | Status |
|---|---|---|---|
| **1 — Foundation** | vitest + invariant tests locking current engine behavior; `ChallengeSpec` union + registry; grading extracted from engine (`CHECK` carries `GradeResult`); engine moved to `engines/` | App behavior identical; tests, typecheck, lint green | 🔨 in progress |
| **2 — Mastery Engine** | storage v2 migration; `DrillItem` + Leitner SRS; universal miss capture (lessons, scenario corrections, shadowing); Review Studio recast as compiled heartless lesson run; `hearts` option on `createLesson` | Old review queue migrates losslessly; misses from all surfaces land as drills; drills graduate through spaced boxes | ⬜ |
| **3 — Scenario Studio 2.0** | scene catalog + difficulty; script generator with validation/retry/fallbacks; `dialogueEngine`; performance UI with per-line audio, two voices, live word matching; Improv mode preserved | A generated script (≥10 exchanges/speaker) is performable end-to-end offline after generation; misses flow to drills | ⬜ |
| **4 — Living UI** | motion tokens + `linear()` springs; View Transitions; juice event bus + `FeedbackOrchestrator`; Lingua mascot rig + mood machine; chimes migrate out of views | Every XP/streak/level/graduation moment produces consistent feedback from one orchestrator; mascot reacts to all juice events | ⬜ |
| **5 — Variety expansion** | `choice` ("what did he say?"), `match`, `speak`-in-lesson, dictation variants; `storyEngine` for branching interactive narratives | Each new kind ships as a registry module with zero engine edits | ⬜ |

Motion tokens and View Transitions (Phase 4) may start in parallel with Phase 2 — they
touch no contracts.
