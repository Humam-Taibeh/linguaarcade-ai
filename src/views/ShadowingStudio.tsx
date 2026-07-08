/**
 * Shadowing Studio — the core practice loop:
 *   1. LISTEN: native-quality TTS reads the target sentence.
 *   2. SHADOW: the user records themselves imitating it.
 *   3. FEEDBACK: word-level color diff + accuracy ring, instantly.
 *
 * The studio can draw sentences from the built-in curriculum, from the user's
 * "My Sentences" library, or from a direct hand-off (the `practiceRequest`
 * prop) when the user clicks "Practice" on a specific saved sentence.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LESSON_CATEGORIES } from "../data/lessons";
import { scorePronunciation, type PronunciationReport } from "../lib/speech/scorer";
import { SpeechRecognizer, isRecognitionSupported } from "../lib/speech/recognition";
import { speak, stopSpeaking, isSynthesisSupported } from "../lib/speech/synthesis";
import {
  playPerfectChime,
  playSuccessChime,
  playTryAgainTone,
  playLevelUpFanfare,
} from "../lib/audio/chimes";
import {
  useAppState,
  levelFromXp,
  REVIEW_CAPTURE_THRESHOLD,
} from "../state/AppStateContext";
import { ShuffleBag } from "../lib/shuffle";
import { ScoreRing } from "../components/ScoreRing";
import { WordDiff } from "../components/WordDiff";

type SourceMode = "lessons" | "mine";
type Phase = "idle" | "listening" | "recording" | "scored";

interface PracticeRequest {
  sentenceId: string;
  text: string;
  requestedAt: number;
}

interface ShadowingStudioProps {
  practiceRequest: PracticeRequest | null;
}

/**
 * XP formula: up to 20 XP proportional to accuracy, plus excellence bonuses.
 * The bonuses make the difference between "good enough" and "nailed it"
 * economically meaningful, which is what pushes users to re-record.
 */
function xpForAccuracy(accuracy: number): number {
  const base = Math.round(accuracy / 5);
  const bonus = accuracy >= 95 ? 10 : accuracy >= 85 ? 5 : 0;
  return base + bonus;
}

export function ShadowingStudio({ practiceRequest }: ShadowingStudioProps) {
  const { state, dispatch } = useAppState();
  const { settings, sentences, profile } = state;

  const [sourceMode, setSourceMode] = useState<SourceMode>("lessons");
  const [categoryId, setCategoryId] = useState(LESSON_CATEGORIES[0].id);
  const [lessonIndex, setLessonIndex] = useState(0);
  const [mineIndex, setMineIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [report, setReport] = useState<PronunciationReport | null>(null);
  const [awardedXp, setAwardedXp] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // One recognizer instance for the component's lifetime; recreating it per
  // recording would leak the browser's underlying audio session on abort.
  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  if (recognizerRef.current === null) {
    recognizerRef.current = new SpeechRecognizer();
  }

  // Anti-repetition engine: one shuffle bag per practice source guarantees
  // full-cycle coverage and never serves the same sentence twice in a row
  // (see lib/shuffle.ts for why plain Math.random() fails at this).
  const lessonBagRef = useRef<ShuffleBag | null>(null);
  if (lessonBagRef.current === null) {
    lessonBagRef.current = new ShuffleBag();
  }
  const mineBagRef = useRef<ShuffleBag | null>(null);
  if (mineBagRef.current === null) {
    mineBagRef.current = new ShuffleBag();
  }

  // Hand-off from "My Sentences": jump straight to that sentence.
  useEffect(() => {
    if (!practiceRequest) return;
    const index = sentences.findIndex((s) => s.id === practiceRequest.sentenceId);
    if (index >= 0) {
      setSourceMode("mine");
      setMineIndex(index);
      setPhase("idle");
      setReport(null);
      setLiveTranscript("");
    }
    // `sentences` is intentionally not a dependency: we only want to jump when
    // a *new* request arrives, not when the library changes for other reasons.
  }, [practiceRequest?.requestedAt]);

  // Stop any microphone/speaker activity when leaving the studio.
  useEffect(() => {
    const recognizer = recognizerRef.current;
    return () => {
      recognizer?.abort();
      stopSpeaking();
    };
  }, []);

  const category = useMemo(
    () => LESSON_CATEGORIES.find((c) => c.id === categoryId) ?? LESSON_CATEGORIES[0],
    [categoryId]
  );

  const currentSentence = useMemo(() => {
    if (sourceMode === "mine") {
      const sentence = sentences[Math.min(mineIndex, sentences.length - 1)];
      return sentence
        ? { id: sentence.id, text: sentence.text, difficulty: null, isCustom: true }
        : null;
    }
    const lesson = category.sentences[Math.min(lessonIndex, category.sentences.length - 1)];
    return lesson
      ? { id: lesson.id, text: lesson.text, difficulty: lesson.difficulty, isCustom: false }
      : null;
  }, [sourceMode, sentences, mineIndex, category, lessonIndex]);

  const resetTake = useCallback(() => {
    setPhase("idle");
    setReport(null);
    setLiveTranscript("");
    setError(null);
    setAwardedXp(0);
  }, []);

  const handleListen = useCallback(async () => {
    if (!currentSentence) return;
    setError(null);
    setPhase("listening");
    await speak(currentSentence.text, {
      voiceURI: settings.voiceURI || undefined,
      rate: settings.speechRate,
    });
    // Only return to idle if the user didn't already start something else.
    setPhase((p) => (p === "listening" ? "idle" : p));
  }, [currentSentence, settings.voiceURI, settings.speechRate]);

  const finishRecording = useCallback(
    (finalTranscript: string) => {
      if (!currentSentence) return;
      if (!finalTranscript.trim()) {
        setPhase("idle");
        setError("No speech detected. Get a little closer to the microphone and try again.");
        if (settings.soundEffects) playTryAgainTone();
        return;
      }

      const result = scorePronunciation(
        currentSentence.text,
        finalTranscript,
        settings.strictness
      );
      const xpEarned = xpForAccuracy(result.accuracy);

      setReport(result);
      setAwardedXp(xpEarned);
      setPhase("scored");

      // Level check must compare against pre-dispatch XP, so compute it now.
      const leveledUp = levelFromXp(profile.xp + xpEarned) > levelFromXp(profile.xp);

      dispatch({
        type: "RECORD_SESSION",
        kind: "shadowing",
        accuracy: result.accuracy,
        xpEarned,
        textPreview: currentSentence.text,
      });
      if (currentSentence.isCustom) {
        dispatch({
          type: "UPDATE_SENTENCE_STATS",
          id: currentSentence.id,
          score: result.accuracy,
        });
      }
      // SRS capture: weak takes are routed into the persistent review queue
      // automatically — the user never has to remember what they struggled on.
      if (result.accuracy < REVIEW_CAPTURE_THRESHOLD) {
        dispatch({
          type: "ADD_REVIEW_ITEM",
          text: currentSentence.text,
          score: result.accuracy,
        });
      }

      if (settings.soundEffects) {
        if (leveledUp) playLevelUpFanfare();
        else if (result.accuracy >= 95) playPerfectChime();
        else if (result.accuracy >= 70) playSuccessChime();
        else playTryAgainTone();
      }
    },
    [currentSentence, settings.strictness, settings.soundEffects, profile.xp, dispatch]
  );

  const handleRecord = useCallback(() => {
    if (!currentSentence || !recognizerRef.current) return;
    stopSpeaking(); // never record over our own TTS output
    setError(null);
    setReport(null);
    setLiveTranscript("");
    setPhase("recording");

    recognizerRef.current.start({
      onInterim: setLiveTranscript,
      onFinal: finishRecording,
      onError: (code) => {
        setPhase("idle");
        setError(
          code === "not-allowed"
            ? "Microphone access was denied. Allow it in your browser's site settings."
            : `Speech recognition error: ${code}`
        );
      },
    });
  }, [currentSentence, finishRecording]);

  const handleStopRecording = useCallback(() => {
    recognizerRef.current?.stop();
  }, []);

  const goToNext = useCallback(() => {
    resetTake();
    // Draw OUTSIDE the setState updater: bag.draw() mutates the bag, and
    // React StrictMode double-invokes updater functions, which would silently
    // consume two cards per click if the draw lived inside the updater.
    if (sourceMode === "mine") {
      const next =
        sentences.length > 0
          ? (mineBagRef.current?.draw(sentences.length, mineIndex) ?? 0)
          : 0;
      setMineIndex(next);
    } else {
      const next =
        lessonBagRef.current?.draw(category.sentences.length, lessonIndex) ?? 0;
      setLessonIndex(next);
    }
  }, [resetTake, sourceMode, sentences.length, mineIndex, category.sentences.length, lessonIndex]);

  const recognitionAvailable = isRecognitionSupported();

  return (
    <div className="fade-in">
      <h1 className="view-header">Shadowing Studio</h1>
      <p className="view-subtitle">
        Listen to the native phrasing, shadow it out loud, and get word-by-word feedback.
      </p>

      {!recognitionAvailable && (
        <div className="error-banner">
          This browser does not support the Web Speech API for recognition. Use Chrome or
          Edge for the full recording experience.
        </div>
      )}
      {!isSynthesisSupported() && (
        <div className="error-banner">Text-to-speech is unavailable in this browser.</div>
      )}
      {error && <div className="error-banner">{error}</div>}

      <div className="glass" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 18 }}>
          <select
            className="select"
            style={{ maxWidth: 220 }}
            value={sourceMode}
            onChange={(e) => {
              setSourceMode(e.target.value as SourceMode);
              resetTake();
            }}
            aria-label="Practice source"
          >
            <option value="lessons">Built-in lessons</option>
            <option value="mine">My Sentences</option>
          </select>

          {sourceMode === "lessons" && (
            <select
              className="select"
              style={{ maxWidth: 260 }}
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setLessonIndex(0);
                // New category = new deck: same-length categories would
                // otherwise keep dealing the previous category's cycle.
                lessonBagRef.current?.reset();
                resetTake();
              }}
              aria-label="Lesson category"
            >
              {LESSON_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}

          <span className="spacer" />
          {currentSentence?.difficulty && (
            <span
              className={`pill ${
                currentSentence.difficulty === "beginner"
                  ? "success"
                  : currentSentence.difficulty === "intermediate"
                    ? "warning"
                    : "danger"
              }`}
            >
              {currentSentence.difficulty}
            </span>
          )}
          {currentSentence?.isCustom && <span className="pill accent">custom sentence</span>}
        </div>

        {currentSentence ? (
          <>
            <p className="target-sentence">“{currentSentence.text}”</p>

            <div className="transcript-live" aria-live="polite">
              {phase === "recording" && (liveTranscript || "Listening… start speaking.")}
            </div>

            <div className="controls-row">
              <button
                type="button"
                className="btn"
                onClick={handleListen}
                disabled={phase === "listening" || phase === "recording"}
              >
                🔊 {phase === "listening" ? "Playing…" : "Listen"}
              </button>

              {phase === "recording" ? (
                <button
                  type="button"
                  className="btn btn-recording"
                  onClick={handleStopRecording}
                >
                  ⏹ Stop &amp; Score
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleRecord}
                  disabled={!recognitionAvailable || phase === "listening"}
                >
                  🎙️ Shadow It
                </button>
              )}

              {phase === "scored" && (
                <button type="button" className="btn btn-ghost" onClick={resetTake}>
                  ↻ Retry
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={goToNext}>
                Next sentence →
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            Your sentence library is empty. Add material in <strong>My Sentences</strong>{" "}
            first, or switch back to the built-in lessons.
          </div>
        )}
      </div>

      {report && phase === "scored" && (
        <div className="glass result-panel">
          <ScoreRing score={report.accuracy} />
          <div>
            <h2 className="card-title">
              Word-by-word analysis{" "}
              <span className="pill accent" style={{ marginLeft: 8 }}>
                +{awardedXp} XP
              </span>
            </h2>
            <WordDiff report={report} />
            <p style={{ color: "var(--text-secondary)", fontSize: "0.86rem", marginTop: 16 }}>
              {report.correctCount} of {report.targetCount} words accurate.{" "}
              {report.accuracy >= 95
                ? "Outstanding — native-level take. 🏆"
                : report.accuracy >= 85
                  ? "Excellent shadowing. Push for a perfect take!"
                  : report.accuracy >= 60
                    ? "Solid attempt — replay the audio and focus on the highlighted words."
                    : "Listen once more at a slower rate, then break the sentence into chunks."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
