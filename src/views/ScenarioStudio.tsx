/**
 * Scenario Studio — immersive roleplay practice. The learner picks (or
 * randomizes) a real-life scene; Lingua plays Person A in character and the
 * learner improvises Person B.
 *
 * All chat machinery lives in useVoiceChat — this view contributes only the
 * scenario lifecycle (pick → start → end), the scenario prompt binding, its
 * own session persistence (scene + transcript together), and the XP policy.
 *
 * The active session persists to localStorage, so a reload or a dead engine
 * never loses the scene.
 */
import { useEffect, useRef, useState } from "react";
import {
  sendScenarioMessage,
  engineConfigFromSettings,
  hasConfiguredEngine,
  RANDOM_SCENARIOS,
} from "../lib/gemini/client";
import {
  loadScenarioSession,
  saveScenarioSession,
  clearScenarioSession,
} from "../lib/chatStore";
import { useAppState } from "../state/AppStateContext";
import { useVoiceChat, MAX_MESSAGE_CHARS } from "../hooks/useVoiceChat";
import type { View } from "../types";

const XP_PER_SCENE_TURN = 8;

/** Start showing the character counter this close to the cap. */
const COUNTER_THRESHOLD = MAX_MESSAGE_CHARS - 200;

/** Hidden seed that opens every scene; never rendered as a user bubble. */
const OPENING_SEED = "Let's begin the scenario. Set the scene and give me your opening line.";

interface ScenarioStudioProps {
  onNavigate: (view: View) => void;
}

export function ScenarioStudio({ onNavigate }: ScenarioStudioProps) {
  const { state, dispatch } = useAppState();
  const { settings } = state;

  // Resume a persisted session if one exists — the scene survives reloads.
  const [session] = useState(() => loadScenarioSession());
  const [scenario, setScenario] = useState(session?.scenario ?? "");
  const [started, setStarted] = useState(session !== null);
  // Ref mirror: the sendTurn binding below must read the scene chosen in the
  // SAME tick as the opening seed, before React has re-rendered.
  const scenarioRef = useRef(scenario);
  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  const {
    messages,
    sending,
    error,
    chatWindowRef,
    draft,
    setDraft,
    sendDraft,
    sendMessage,
    overLimit,
    dictating,
    toggleDictation,
    recognitionSupported,
    speakReplies,
    setSpeakReplies,
    resetChat,
  } = useVoiceChat({
    sendTurn: (history, text) =>
      sendScenarioMessage(
        engineConfigFromSettings(settings),
        scenarioRef.current,
        history,
        text
      ),
    initialMessages: () => session?.messages ?? [],
    onExchangeComplete: (content) => {
      dispatch({
        type: "RECORD_SESSION",
        kind: "conversation",
        accuracy: null,
        xpEarned: XP_PER_SCENE_TURN,
        textPreview: content,
      });
    },
  });

  // Persist on every transition so nothing is ever lost mid-scene. Lives here
  // (not in the hook's onMessagesChange) because the stored document couples
  // the transcript with the scene title and only exists once started.
  useEffect(() => {
    if (started && scenario.trim()) {
      saveScenarioSession({ scenario: scenario.trim(), messages });
    }
  }, [started, scenario, messages]);

  const startScenario = (scene: string) => {
    const cleaned = scene.trim();
    if (!cleaned || sending) return;
    scenarioRef.current = cleaned;
    setScenario(cleaned);
    setStarted(true);
    resetChat();
    void sendMessage(OPENING_SEED, { echoUser: false });
  };

  const handleRandom = () => {
    const pick = RANDOM_SCENARIOS[Math.floor(Math.random() * RANDOM_SCENARIOS.length)];
    setScenario(pick);
  };

  const endScenario = () => {
    clearScenarioSession();
    setStarted(false);
    setScenario("");
    resetChat();
  };

  const engineReady = hasConfiguredEngine(engineConfigFromSettings(settings));

  return (
    <div className={started ? "fade-in view-fill" : "fade-in"}>
      <h1 className="view-header">Scenario Studio</h1>
      <p className="view-subtitle">
        Step into a scene — Lingua plays their part, you play yours. Real-life English,
        zero stakes.
      </p>

      {!engineReady ? (
        <div className="glass">
          <div className="info-banner">
            Scenario Studio needs an AI engine. Add a Groq or Gemini key (or your Ollama
            tunnel) first.
          </div>
          <button type="button" className="btn btn-primary" onClick={() => onNavigate("settings")}>
            ⚙️ Open Settings
          </button>
        </div>
      ) : !started ? (
        <div className="glass">
          <div className="field">
            <label htmlFor="scenario-input">Your scene</label>
            <div className="row">
              <input
                id="scenario-input"
                className="input"
                style={{ flex: 1, minWidth: 220 }}
                type="text"
                placeholder="e.g. Job interview, At the airport, Ordering coffee…"
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    startScenario(scenario);
                  }
                }}
                autoComplete="off"
              />
              <button type="button" className="btn btn-ghost" onClick={handleRandom}>
                🎲 Random
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => startScenario(scenario)}
                disabled={!scenario.trim()}
              >
                🎬 Start scene
              </button>
            </div>
            <span className="hint">
              Lingua becomes the other person — interviewer, waiter, agent — and opens the
              scene. Every mistake you make lands quietly in a correction card.
            </span>
          </div>
        </div>
      ) : (
        <div className="glass chat-card">
          {error && <div className="error-banner">{error}</div>}

          <div className="scene-bar">
            <span className="scene-avatar" aria-hidden="true">
              🎭
            </span>
            <div className="scene-info">
              <div className="scene-title">{scenario}</div>
              <div className="scene-status">
                {sending ? "typing…" : "Lingua · in character"}
              </div>
            </div>
            <button type="button" className="btn btn-ghost" onClick={endScenario}>
              ✖ End
            </button>
          </div>

          <div className="chat-window" ref={chatWindowRef}>
            {messages.map((message) => (
              <div key={message.id} className={`msg ${message.role}`}>
                <div>{message.text}</div>
                {message.corrections?.map((correction, index) => (
                  <div key={index} className="correction-card">
                    <span className="correction-label" aria-hidden="true">
                      ✦ Quick fix
                    </span>
                    <span className="from">{correction.original}</span>
                    {" → "}
                    <span className="to">{correction.corrected}</span>
                    <span className="why">{correction.explanation}</span>
                  </div>
                ))}
              </div>
            ))}
            {sending && (
              <div className="typing-indicator" role="status" aria-label="Lingua is typing">
                <span className="typing-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            )}
          </div>

          <div className="chat-input-row">
            <textarea
              className="input"
              rows={2}
              placeholder="Your line as Person B…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendDraft();
                }
              }}
              disabled={sending}
            />
            {recognitionSupported && (
              <button
                type="button"
                className={`btn ${dictating ? "btn-recording" : "btn-ghost"}`}
                onClick={toggleDictation}
                title={dictating ? "Stop dictation" : "Speak your line"}
              >
                🎙️
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={sendDraft}
              disabled={sending || !draft.trim() || overLimit}
            >
              Send
            </button>
          </div>

          {draft.length > COUNTER_THRESHOLD && (
            <div className={`char-counter ${overLimit ? "over" : ""}`} aria-live="polite">
              {draft.length.toLocaleString()} / {MAX_MESSAGE_CHARS.toLocaleString()}
            </div>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <label style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>
              <input
                type="checkbox"
                checked={speakReplies}
                onChange={(e) => setSpeakReplies(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              Read lines aloud
            </label>
            <span className="spacer" />
            <span className="pill accent">+{XP_PER_SCENE_TURN} XP per line</span>
          </div>
        </div>
      )}
    </div>
  );
}
