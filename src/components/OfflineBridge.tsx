/**
 * Offline Bridge — the deterministic "No-API" mode.
 *
 * Rendered when the user has no Gemini key. Instead of a dead end, they get:
 *   1. A prompt generator: pick a scenario/level/focus, copy one rigorously
 *      structured prompt, and run it in ANY external AI (ChatGPT, Claude
 *      web, Gemini web...).
 *   2. An ingestion board: paste the AI's response back; it is parsed on the
 *      fly into a living dialogue scene (with per-line TTS playback) and a
 *      set of practice sentences importable straight into My Sentences.
 *
 * Everything here is deterministic and offline — the only "AI" involved is
 * whichever one the user pastes from.
 */
import { useMemo, useState } from "react";
import {
  SCENARIOS,
  buildExternalPrompt,
  parseExternalResponse,
  type FocusArea,
  type LearnerLevel,
  type LessonPayload,
} from "../lib/bridge/promptBridge";
import { speak, stopSpeaking } from "../lib/speech/synthesis";
import { useAppState } from "../state/AppStateContext";
import type { View } from "../types";

/**
 * Clipboard write with a legacy fallback: navigator.clipboard requires a
 * secure context and can be blocked by permissions; the hidden-textarea
 * trick still works everywhere and costs nothing to keep as a net.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const scratch = document.createElement("textarea");
      scratch.value = text;
      scratch.style.position = "fixed";
      scratch.style.opacity = "0";
      document.body.appendChild(scratch);
      scratch.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(scratch);
      return ok;
    } catch {
      return false;
    }
  }
}

interface OfflineBridgeProps {
  onNavigate: (view: View) => void;
}

export function OfflineBridge({ onNavigate }: OfflineBridgeProps) {
  const { state, dispatch } = useAppState();
  const { settings } = state;

  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [level, setLevel] = useState<LearnerLevel>("intermediate");
  const [focus, setFocus] = useState<FocusArea>("fluency");
  const [copied, setCopied] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [lesson, setLesson] = useState<LessonPayload | null>(null);
  const [imported, setImported] = useState(false);

  const scenario = useMemo(
    () => SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0],
    [scenarioId]
  );

  // Pure derivation: regenerates instantly as the user tunes the selectors.
  const generatedPrompt = useMemo(
    () => buildExternalPrompt(scenario, level, focus),
    [scenario, level, focus]
  );

  const handleCopy = async () => {
    const ok = await copyText(generatedPrompt);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2500);
  };

  const handleParse = () => {
    stopSpeaking();
    setImported(false);
    const result = parseExternalResponse(pasteDraft);
    if (result.ok) {
      setLesson(result.lesson);
      setParseError(null);
    } else {
      setLesson(null);
      setParseError(result.error);
    }
  };

  const handleImport = () => {
    if (!lesson) return;
    // Prefer the distilled practice sentences; fall back to dialogue lines so
    // a dialogue-only payload is still fully importable.
    const texts =
      lesson.practiceSentences.length > 0
        ? lesson.practiceSentences
        : lesson.dialogue.map((turn) => turn.text);
    dispatch({ type: "ADD_SENTENCES", texts });
    setImported(true);
  };

  const playTurn = (text: string) => {
    void speak(text, {
      voiceURI: settings.voiceURI || undefined,
      rate: settings.speechRate,
    });
  };

  return (
    <div className="stack">
      <div className="info-banner">
        No Gemini API key configured — you're in <strong>No-API mode</strong>. Generate a
        prompt below, run it in any AI (ChatGPT, Claude, Gemini web…), and paste the answer
        back to build a living practice scenario. Or add a key in{" "}
        <button
          type="button"
          className="btn btn-ghost"
          style={{ minHeight: 0, padding: "2px 10px", fontSize: "0.82rem" }}
          onClick={() => onNavigate("settings")}
        >
          Settings
        </button>{" "}
        for the live conversation partner.
      </div>

      <div className="glass">
        <h2 className="card-title">🧾 1 — Generate a scenario prompt</h2>
        <div className="row" style={{ marginBottom: 14 }}>
          <select
            className="select"
            style={{ maxWidth: 240 }}
            value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value)}
            aria-label="Scenario"
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <select
            className="select"
            style={{ maxWidth: 180 }}
            value={level}
            onChange={(e) => setLevel(e.target.value as LearnerLevel)}
            aria-label="Learner level"
          >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
          <select
            className="select"
            style={{ maxWidth: 180 }}
            value={focus}
            onChange={(e) => setFocus(e.target.value as FocusArea)}
            aria-label="Learning focus"
          >
            <option value="fluency">Fluency focus</option>
            <option value="grammar">Grammar focus</option>
            <option value="vocabulary">Vocabulary focus</option>
          </select>
        </div>

        <p style={{ color: "var(--text-secondary)", fontSize: "0.86rem", marginTop: 0 }}>
          {scenario.description}
        </p>

        <pre className="prompt-box">{generatedPrompt}</pre>

        <div className="controls-row">
          <button type="button" className="btn btn-primary" onClick={() => void handleCopy()}>
            {copied ? "Copied ✓" : "📋 Copy prompt"}
          </button>
        </div>
      </div>

      <div className="glass">
        <h2 className="card-title">📥 2 — Paste the AI's response</h2>
        <div className="field">
          <textarea
            className="input"
            rows={6}
            placeholder='Paste the JSON reply here (or even a plain list of sentences — both work)…'
            value={pasteDraft}
            onChange={(e) => setPasteDraft(e.target.value)}
            spellCheck={false}
          />
          <span className="hint">
            The parser accepts the exact JSON schema from step 1, fenced/markdown-wrapped
            JSON, or plain sentence lines as a fallback.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleParse}
          disabled={!pasteDraft.trim()}
        >
          ⚡ Build scenario
        </button>

        {parseError && (
          <div className="error-banner" style={{ marginTop: 16, marginBottom: 0 }}>
            {parseError}
          </div>
        )}

        {lesson && (
          <div className="fade-in" style={{ marginTop: 22 }}>
            <h3 className="card-title">🎬 {lesson.title}</h3>

            {lesson.dialogue.length > 0 && (
              <div className="dialogue-scene">
                {lesson.dialogue.map((turn, index) => (
                  <div
                    key={index}
                    // Speaker A renders as the "model" bubble, everyone else
                    // as the "user" bubble — instantly readable as a scene.
                    className={`msg ${turn.speaker.trim().toUpperCase() === "A" ? "model" : "user"}`}
                  >
                    <span className="speaker-tag">Speaker {turn.speaker}</span>
                    <span className="row" style={{ flexWrap: "nowrap" }}>
                      <span style={{ minWidth: 0 }}>{turn.text}</span>
                      <button
                        type="button"
                        className="btn btn-ghost dialogue-actions"
                        style={{ minHeight: 0, padding: "4px 10px" }}
                        onClick={() => playTurn(turn.text)}
                        title="Play this line"
                        aria-label={`Play line: ${turn.text}`}
                      >
                        🔊
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {lesson.practiceSentences.length > 0 && (
              <>
                <h3 className="card-title" style={{ marginTop: 18 }}>
                  🎯 Practice sentences
                </h3>
                {lesson.practiceSentences.map((sentence, index) => (
                  <div key={index} className="sentence-item">
                    <div className="sentence-body">
                      <p className="sentence-text">“{sentence}”</p>
                    </div>
                    <div className="sentence-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => playTurn(sentence)}
                        title="Play sentence"
                      >
                        🔊
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="controls-row" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleImport}
                disabled={imported}
              >
                {imported ? "Imported ✓ — open My Sentences" : "＋ Import into My Sentences"}
              </button>
              {imported && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => onNavigate("sentences")}
                >
                  📝 Go practice them
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
