/**
 * Guided Lessons — the Duolingo-style quiz flow rendered over the pure
 * lessonEngine state machine.
 *
 * Division of labor: the engine (lib/lessonEngine) owns ALL progression
 * rules — grading, hearts, mastery re-queue, XP math. This view only renders
 * `queue[0]`, dispatches CHECK / SKIP / CONTINUE, and fires the effects the
 * engine deliberately doesn't know about: TTS playback, chimes, and the
 * single RECORD_SESSION payout on completion. Failed runs never dispatch
 * RECORD_SESSION — the engine's "failed runs don't pay" rule is enforced by
 * this file having no code path that pays one.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { LESSON_CATEGORIES } from "../data/lessons";
import type { LessonCategory } from "../types";
import {
  MAX_HEARTS,
  buildChallenges,
  createLesson,
  lessonReducer,
  normalizeAnswer,
  progressFraction,
  type LessonState,
  type MissRecord,
} from "../lib/lessonEngine";
import { speak, stopSpeaking } from "../lib/speech/synthesis";
import {
  playLevelUpFanfare,
  playPerfectChime,
  playSuccessChime,
  playTryAgainTone,
} from "../lib/audio/chimes";
import { levelFromXp, useAppState } from "../state/AppStateContext";

/**
 * "What went wrong" — one row per struggled CHALLENGE (a re-queued miss
 * folds into its row with a ×N counter). Shows the learner's first real
 * attempt against the canonical answer; skips read as "skipped".
 */
function MissSummary({ misses }: { misses: MissRecord[] }) {
  const byChallenge = new Map<string, MissRecord & { times: number }>();
  for (const miss of misses) {
    const existing = byChallenge.get(miss.challengeId);
    if (existing) {
      existing.times += 1;
      // A typed attempt is more instructive than "skipped" — keep the first one seen.
      if (existing.attempted === null && miss.attempted !== null) {
        existing.attempted = miss.attempted;
      }
    } else {
      byChallenge.set(miss.challengeId, { ...miss, times: 1 });
    }
  }
  const rows = [...byChallenge.values()];
  if (rows.length === 0) return null;

  return (
    <div className="lesson-misses">
      <h3 className="rail-card-label">What went wrong</h3>
      {rows.map((row) => (
        <div key={row.challengeId} className="miss-row">
          <span className="miss-prompt">
            {row.prompt}
            {row.times > 1 ? ` · missed ${row.times}×` : ""}
          </span>
          <span className="miss-answer">
            {row.attempted !== null ? (
              <span className="miss-from">{row.attempted}</span>
            ) : (
              <span className="miss-from skipped">skipped</span>
            )}
            <span className="miss-arrow" aria-hidden="true">
              {" → "}
            </span>
            <span className="miss-to">{row.answer}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function LessonFlow() {
  const { state, dispatch } = useAppState();
  const { settings, profile } = state;

  const [category, setCategory] = useState<LessonCategory | null>(null);
  const [lesson, setLesson] = useState<LessonState | null>(null);
  const [typed, setTyped] = useState("");
  /** Indices into the current word bank, in tap order — indices (not words)
   * so duplicate words in a sentence stay individually selectable. */
  const [picked, setPicked] = useState<number[]>([]);
  // Payout guard: survives StrictMode's double-effect in dev, so a completed
  // run can never award XP twice.
  const rewardedRef = useRef(false);

  const current = lesson && lesson.queue.length > 0 ? lesson.queue[0] : null;

  const startLesson = useCallback((cat: LessonCategory) => {
    setCategory(cat);
    setLesson(createLesson(buildChallenges(cat.sentences)));
    setTyped("");
    setPicked([]);
    rewardedRef.current = false;
  }, []);

  const exitLesson = useCallback(() => {
    stopSpeaking();
    setCategory(null);
    setLesson(null);
  }, []);

  // Navigating away mid-lesson must never leave TTS talking to nobody.
  useEffect(() => stopSpeaking, []);

  // Listen challenges auto-play the moment they become live — the classic
  // cadence. speak() cancels any prior utterance, so rapid Continue taps
  // can't stack audio; the iOS watchdog inside speak() means a lost `end`
  // event can't wedge anything here either.
  useEffect(() => {
    if (!lesson || !current || lesson.phase !== "answering") return;
    if (current.kind !== "type-what-you-hear") return;
    void speak(current.answer, {
      voiceURI: settings.voiceURI || undefined,
      rate: settings.speechRate,
      pitch: settings.speechPitch,
    });
  }, [lesson, current, settings.voiceURI, settings.speechRate, settings.speechPitch]);

  // The single payout: exactly one RECORD_SESSION per completed run.
  useEffect(() => {
    if (!lesson || !category || lesson.phase !== "complete" || rewardedRef.current) return;
    rewardedRef.current = true;
    const leveledUp = levelFromXp(profile.xp + lesson.xpEarned) > levelFromXp(profile.xp);
    dispatch({
      type: "RECORD_SESSION",
      kind: "lesson",
      accuracy: null,
      xpEarned: lesson.xpEarned,
      textPreview: `Lesson: ${category.title}`,
    });
    if (settings.soundEffects) {
      if (leveledUp) playLevelUpFanfare();
      else if (lesson.mistakes === 0) playPerfectChime();
    }
  }, [lesson, category, profile.xp, settings.soundEffects, dispatch]);

  const answer =
    current?.kind === "arrange"
      ? picked.map((i) => current.wordBank?.[i] ?? "").join(" ")
      : typed;

  const handleCheck = () => {
    if (!lesson || !current || lesson.phase !== "answering" || !answer.trim()) return;
    stopSpeaking();
    // Verdict is recomputed here only to pick the chime; the engine's CHECK
    // does the authoritative grading with the same normalizer.
    const correct = normalizeAnswer(answer) === normalizeAnswer(current.answer);
    if (settings.soundEffects) (correct ? playSuccessChime : playTryAgainTone)();
    setLesson(lessonReducer(lesson, { type: "CHECK", answer }));
  };

  const handleSkip = () => {
    if (!lesson || lesson.phase !== "answering") return;
    stopSpeaking();
    if (settings.soundEffects) playTryAgainTone();
    setLesson(lessonReducer(lesson, { type: "SKIP" }));
  };

  const handleContinue = () => {
    if (!lesson || lesson.phase !== "checked") return;
    setLesson(lessonReducer(lesson, { type: "CONTINUE" }));
    setTyped("");
    setPicked([]);
  };

  const hearItAgain = () => {
    if (!current) return;
    void speak(current.answer, {
      voiceURI: settings.voiceURI || undefined,
      rate: settings.speechRate,
      pitch: settings.speechPitch,
    });
  };

  // ------------------------------------------------------------------ views

  if (!lesson || !category) {
    return (
      <section className="fade-in">
        <h1 className="view-header">Guided Lessons</h1>
        <p className="view-subtitle">
          Pick a topic and clear the run — every challenge must be mastered to
          finish, mistakes cost a heart, and a flawless run pays a bonus.
        </p>
        <div className="lesson-catalog">
          {LESSON_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className="glass hoverable lesson-cat-card"
              onClick={() => startLesson(cat)}
            >
              <span className="lesson-cat-title">{cat.title}</span>
              <span className="lesson-cat-desc">{cat.description}</span>
              <span className="pill accent">{cat.sentences.length} challenges</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (lesson.phase === "complete") {
    return (
      <section className="fade-in">
        <div className="glass lesson-result">
          <span className="lesson-result-emoji" aria-hidden="true">
            🎉
          </span>
          <h2>Lesson complete!</h2>
          <span className="lesson-xp-award">+{lesson.xpEarned} XP</span>
          <p>
            {lesson.mistakes === 0
              ? "Flawless run — perfect bonus earned."
              : `${lesson.mistakes} miss${lesson.mistakes === 1 ? "" : "es"} — every challenge still mastered.`}
          </p>
          <MissSummary misses={lesson.misses} />
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => startLesson(category)}>
              Practice again
            </button>
            <button type="button" className="btn btn-ghost" onClick={exitLesson}>
              Choose another topic
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (lesson.phase === "failed") {
    return (
      <section className="fade-in">
        <div className="glass lesson-result">
          <span className="lesson-result-emoji" aria-hidden="true">
            💔
          </span>
          <h2>Out of hearts</h2>
          <p>No XP this run — but the next attempt starts with a full set.</p>
          <MissSummary misses={lesson.misses} />
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => startLesson(category)}>
              Try again
            </button>
            <button type="button" className="btn btn-ghost" onClick={exitLesson}>
              Back to topics
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="fade-in">
      <div className="lesson-topbar">
        <button
          type="button"
          className="btn btn-ghost lesson-exit"
          onClick={exitLesson}
          aria-label="End lesson"
        >
          ✕
        </button>
        <div
          className="lesson-progress"
          role="progressbar"
          aria-label="Lesson progress"
          aria-valuemin={0}
          aria-valuemax={lesson.total}
          aria-valuenow={lesson.solved}
        >
          <div
            className="lesson-progress-fill"
            style={{ "--fill": `${Math.round(progressFraction(lesson) * 100)}%` } as CSSProperties}
          />
        </div>
        <div className="lesson-hearts" aria-label={`${lesson.hearts} of ${MAX_HEARTS} hearts left`}>
          {Array.from({ length: MAX_HEARTS }, (_, i) => (
            <span key={i} className={`heart${i < lesson.hearts ? "" : " lost"}`} aria-hidden="true">
              ❤️
            </span>
          ))}
        </div>
      </div>

      {current && (
        <div className="glass lesson-stage">
          <h2 className="lesson-prompt">{current.prompt}</h2>

          {current.kind === "arrange" && current.wordBank ? (
            <>
              <div className="arrange-answer">
                {picked.length === 0 ? (
                  <span className="arrange-placeholder">Tap the words in order…</span>
                ) : (
                  picked.map((wordIndex) => (
                    <button
                      key={wordIndex}
                      type="button"
                      className="bank-chip picked"
                      onClick={() => setPicked((p) => p.filter((i) => i !== wordIndex))}
                      disabled={lesson.phase !== "answering"}
                    >
                      {current.wordBank?.[wordIndex]}
                    </button>
                  ))
                )}
              </div>
              <div className="arrange-bank">
                {current.wordBank.map((word, index) => {
                  const used = picked.includes(index);
                  return (
                    <button
                      key={index}
                      type="button"
                      className={`bank-chip${used ? " used" : ""}`}
                      onClick={() => setPicked((p) => [...p, index])}
                      disabled={used || lesson.phase !== "answering"}
                    >
                      {word}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              {current.kind === "type-what-you-hear" && (
                <div className="row">
                  <button type="button" className="btn" onClick={hearItAgain}>
                    🔊 Hear it again
                  </button>
                </div>
              )}
              <input
                className="input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCheck();
                }}
                placeholder="Type your answer…"
                disabled={lesson.phase !== "answering"}
                aria-label="Your answer"
              />
            </>
          )}

          {lesson.phase === "checked" && (
            <div className={`lesson-feedback ${lesson.verdict ?? ""}`} role="status">
              <strong>{lesson.verdict === "correct" ? "Nice — that's right!" : "Not quite."}</strong>
              {lesson.verdict === "incorrect" && (
                <span>
                  Correct answer: <span className="reveal">{current.answer}</span>
                </span>
              )}
            </div>
          )}

          <div className="lesson-actions">
            {lesson.phase === "answering" ? (
              <>
                <button type="button" className="btn btn-ghost" onClick={handleSkip}>
                  Skip
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCheck}
                  disabled={!answer.trim()}
                >
                  Check
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={handleContinue}>
                Continue
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
