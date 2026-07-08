/**
 * Review Studio — the Spaced Repetition System's practice surface.
 *
 * Weak phrases (shadowing takes under REVIEW_CAPTURE_THRESHOLD) bubble up
 * here automatically. The contract is deliberately strict: an item only
 * leaves the queue when the user re-shadows it OUT LOUD at green level
 * (REVIEW_CLEAR_THRESHOLD, 85%+). No "mark as done" button exists on
 * purpose — self-assessment is exactly what fails on hard phrases.
 *
 * The view is isolated from the Shadowing Studio (own component, own state)
 * so its queue-clearing mechanics can't leak complexity into the free-
 * practice flow, but it reuses the same speech/scoring primitives.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scorePronunciation, type PronunciationReport } from "../lib/speech/scorer";
import { SpeechRecognizer, isRecognitionSupported } from "../lib/speech/recognition";
import { speak, stopSpeaking } from "../lib/speech/synthesis";
import {
  playPerfectChime,
  playSuccessChime,
  playTryAgainTone,
} from "../lib/audio/chimes";
import {
  useAppState,
  REVIEW_CLEAR_THRESHOLD,
} from "../state/AppStateContext";
import { ScoreRing } from "../components/ScoreRing";
import { WordDiff } from "../components/WordDiff";

type Phase = "idle" | "listening" | "recording" | "scored";

/** Same XP economics as the Shadowing Studio — review reps are real reps. */
function xpForAccuracy(accuracy: number): number {
  const base = Math.round(accuracy / 5);
  const bonus = accuracy >= 95 ? 10 : accuracy >= 85 ? 5 : 0;
  return base + bonus;
}

/**
 * The last take's outcome, kept locally so the result panel survives the
 * item vanishing from the queue the instant it is cleared.
 */
interface TakeResult {
  text: string;
  report: PronunciationReport;
  xpEarned: number;
  cleared: boolean;
}

export function ReviewStudio() {
  const { state, dispatch } = useAppState();
  const { reviewQueue, settings } = state;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [lastResult, setLastResult] = useState<TakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  if (recognizerRef.current === null) {
    recognizerRef.current = new SpeechRecognizer();
  }

  useEffect(() => {
    const recognizer = recognizerRef.current;
    return () => {
      recognizer?.abort();
      stopSpeaking();
    };
  }, []);

  // The active item: the user's explicit pick, else the head of the queue.
  // Falling back to queue[0] keeps the studio usable with zero clicks.
  const currentItem = useMemo(() => {
    if (selectedId) {
      const picked = reviewQueue.find((item) => item.id === selectedId);
      if (picked) return picked;
    }
    return reviewQueue[0] ?? null;
  }, [reviewQueue, selectedId]);

  const handleListen = useCallback(async () => {
    if (!currentItem) return;
    setError(null);
    setPhase("listening");
    await speak(currentItem.text, {
      voiceURI: settings.voiceURI || undefined,
      rate: settings.speechRate,
    });
    setPhase((p) => (p === "listening" ? "idle" : p));
  }, [currentItem, settings.voiceURI, settings.speechRate]);

  const finishRecording = useCallback(
    (finalTranscript: string) => {
      if (!currentItem) return;
      if (!finalTranscript.trim()) {
        setPhase("idle");
        setError("No speech detected. Get a little closer to the microphone and try again.");
        if (settings.soundEffects) playTryAgainTone();
        return;
      }

      const report = scorePronunciation(
        currentItem.text,
        finalTranscript,
        settings.strictness
      );
      const cleared = report.accuracy >= REVIEW_CLEAR_THRESHOLD;
      const xpEarned = xpForAccuracy(report.accuracy);

      setLastResult({ text: currentItem.text, report, xpEarned, cleared });
      setPhase("scored");

      // Review reps feed the same streak/XP economy as free practice…
      dispatch({
        type: "RECORD_SESSION",
        kind: "shadowing",
        accuracy: report.accuracy,
        xpEarned,
        textPreview: currentItem.text,
      });
      // …and this transition either graduates the item or logs the attempt.
      dispatch({ type: "REVIEW_ATTEMPT", id: currentItem.id, score: report.accuracy });

      if (cleared) {
        // The cleared item is gone from the queue; drop the manual selection
        // so the studio auto-advances to the next weak phrase.
        setSelectedId(null);
      }

      if (settings.soundEffects) {
        if (report.accuracy >= 95) playPerfectChime();
        else if (cleared) playSuccessChime();
        else playTryAgainTone();
      }
    },
    [currentItem, settings.strictness, settings.soundEffects, dispatch]
  );

  const handleRecord = useCallback(() => {
    if (!currentItem || !recognizerRef.current) return;
    stopSpeaking();
    setError(null);
    setLastResult(null);
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
  }, [currentItem, finishRecording]);

  const handleStopRecording = useCallback(() => {
    recognizerRef.current?.stop();
  }, []);

  const formatWhen = (iso: string): string =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const recognitionAvailable = isRecognitionSupported();

  return (
    <div className="fade-in">
      <h1 className="view-header">Review Studio</h1>
      <p className="view-subtitle">
        Your weak phrases, resurfaced. Each one clears only when you re-shadow it at{" "}
        {REVIEW_CLEAR_THRESHOLD}%+ accuracy — out loud, no shortcuts.
      </p>

      {!recognitionAvailable && (
        <div className="error-banner">
          This browser does not support the Web Speech API for recognition. Use Chrome or
          Edge to clear your review queue.
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}

      {lastResult?.cleared && (
        <div className="cleared-banner">
          ✅ Cleared! “{lastResult.text}” has left your review queue. +{lastResult.xpEarned} XP
        </div>
      )}

      {currentItem ? (
        <div className="glass" style={{ marginBottom: 16 }}>
          <div className="row" style={{ marginBottom: 14 }}>
            <span className="pill danger">
              last score {currentItem.lastScore}%
            </span>
            <span className="pill">
              {currentItem.attempts} review attempt{currentItem.attempts === 1 ? "" : "s"}
            </span>
            <span className="spacer" />
            <span className="pill warning">clear at {REVIEW_CLEAR_THRESHOLD}%+</span>
          </div>

          <p className="target-sentence">“{currentItem.text}”</p>

          <div className="transcript-live" aria-live="polite">
            {phase === "recording" && (liveTranscript || "Listening… start speaking.")}
          </div>

          <div className="controls-row">
            <button
              type="button"
              className="btn"
              onClick={() => void handleListen()}
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
          </div>
        </div>
      ) : (
        <div className="glass" style={{ marginBottom: 16 }}>
          <div className="empty-state">
            🏆 Your review queue is empty — every weak phrase has been conquered. New ones
            appear here automatically when a Shadowing Studio take scores low.
          </div>
        </div>
      )}

      {lastResult && phase === "scored" && (
        <div className="glass result-panel">
          <ScoreRing score={lastResult.report.accuracy} />
          <div>
            <h2 className="card-title">
              Word-by-word analysis{" "}
              <span className="pill accent" style={{ marginLeft: 8 }}>
                +{lastResult.xpEarned} XP
              </span>
            </h2>
            <WordDiff report={lastResult.report} />
            <p style={{ color: "var(--text-secondary)", fontSize: "0.86rem", marginTop: 16 }}>
              {lastResult.cleared
                ? "Green take — this phrase is officially yours now. 🎉"
                : `Not quite ${REVIEW_CLEAR_THRESHOLD}% yet — replay the audio, focus on the highlighted words, and take it again.`}
            </p>
          </div>
        </div>
      )}

      {reviewQueue.length > 0 && (
        <div className="glass" style={{ marginTop: 16 }}>
          <h2 className="card-title">
            Queue{" "}
            <span className="pill danger" style={{ marginLeft: 8 }}>
              {reviewQueue.length} phrase{reviewQueue.length === 1 ? "" : "s"}
            </span>
          </h2>
          {reviewQueue.map((item) => (
            <div key={item.id} className="sentence-item">
              <div className="sentence-body">
                <p className="sentence-text">“{item.text}”</p>
                <span className="sentence-meta">
                  added {formatWhen(item.addedAt)} · last score {item.lastScore}% ·{" "}
                  {item.attempts} attempt{item.attempts === 1 ? "" : "s"}
                </span>
              </div>
              <div className="sentence-actions">
                <button
                  type="button"
                  className={`btn ${currentItem?.id === item.id ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => {
                    setSelectedId(item.id);
                    setPhase("idle");
                    setLastResult(null);
                    setError(null);
                  }}
                >
                  {currentItem?.id === item.id ? "▶ Up next" : "Review"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
