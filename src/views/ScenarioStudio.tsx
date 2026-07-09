/**
 * Scenario Studio — immersive roleplay practice. The learner picks (or
 * randomizes) a real-life scene; Lingua plays Person A in character and the
 * learner improvises Person B. Reuses the Conversation chat UI primitives
 * (bubbles, correction cards, typing indicator) and the multi-engine client
 * with a scenario-specific system prompt, so the whole feature is mostly
 * composition, not new machinery.
 *
 * The active session (scenario + transcript) persists to localStorage, so a
 * reload or a dead engine never loses the scene.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  sendScenarioMessage,
  engineConfigFromSettings,
  hasConfiguredEngine,
  TutorApiError,
  RANDOM_SCENARIOS,
  type ChatMessage,
  type TutorReply,
} from "../lib/gemini/client";
import {
  loadScenarioSession,
  saveScenarioSession,
  clearScenarioSession,
  type StoredChatMessage,
} from "../lib/chatStore";
import { SpeechRecognizer, isRecognitionSupported } from "../lib/speech/recognition";
import { speak, stopSpeaking } from "../lib/speech/synthesis";
import { useAppState } from "../state/AppStateContext";
import type { View } from "../types";

const XP_PER_SCENE_TURN = 8;

interface ScenarioStudioProps {
  onNavigate: (view: View) => void;
}

export function ScenarioStudio({ onNavigate }: ScenarioStudioProps) {
  const { state, dispatch } = useAppState();
  const { settings } = state;

  // Resume a persisted session if one exists — the scene survives reloads.
  const [session] = useState(() => loadScenarioSession());
  const [scenario, setScenario] = useState(session?.scenario ?? "");
  const [messages, setMessages] = useState<StoredChatMessage[]>(session?.messages ?? []);
  const [started, setStarted] = useState(session !== null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [recognizer] = useState(() => new SpeechRecognizer());
  const chatWindowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      recognizer.abort();
      stopSpeaking();
    };
  }, [recognizer]);

  // Keep the newest line in view as the scene grows.
  useEffect(() => {
    const el = chatWindowRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  // Persist on every transition so nothing is ever lost mid-scene.
  useEffect(() => {
    if (started && scenario.trim()) {
      saveScenarioSession({ scenario: scenario.trim(), messages });
    }
  }, [started, scenario, messages]);

  const engineReady = hasConfiguredEngine(engineConfigFromSettings(settings));

  const requestTurn = useCallback(
    async (scene: string, history: StoredChatMessage[], userText: string) => {
      setError(null);
      setSending(true);
      let reply: TutorReply | null = null;
      try {
        const apiHistory: ChatMessage[] = history.map((m) => ({ role: m.role, text: m.text }));
        reply = await sendScenarioMessage(
          engineConfigFromSettings(settings),
          scene,
          apiHistory,
          userText
        );
      } catch (err) {
        setError(err instanceof TutorApiError ? err.message : "Unexpected error — try again.");
      } finally {
        setSending(false);
      }
      if (!reply) return;
      const line = reply;

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "model",
          text: line.reply,
          corrections: line.corrections,
        },
      ]);
      if (speakReplies) {
        void speak(line.reply, {
          voiceURI: settings.voiceURI || undefined,
          rate: settings.speechRate,
          pitch: settings.speechPitch,
        });
      }
    },
    [settings, speakReplies]
  );

  const startScenario = useCallback(
    (scene: string) => {
      const cleaned = scene.trim();
      if (!cleaned || sending) return;
      setScenario(cleaned);
      setStarted(true);
      setMessages([]);
      void requestTurn(
        cleaned,
        [],
        "Let's begin the scenario. Set the scene and give me your opening line."
      );
    },
    [sending, requestTurn]
  );

  const handleRandom = () => {
    const pick = RANDOM_SCENARIOS[Math.floor(Math.random() * RANDOM_SCENARIOS.length)];
    setScenario(pick);
  };

  const endScenario = useCallback(() => {
    stopSpeaking();
    recognizer.abort();
    clearScenarioSession();
    setStarted(false);
    setMessages([]);
    setScenario("");
    setDraft("");
    setError(null);
  }, [recognizer]);

  const sendLine = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || sending) return;
      const userMessage: StoredChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: content,
      };
      const history = messages;
      setMessages((prev) => [...prev, userMessage]);
      dispatch({
        type: "RECORD_SESSION",
        kind: "conversation",
        accuracy: null,
        xpEarned: XP_PER_SCENE_TURN,
        textPreview: content,
      });
      void requestTurn(scenario, history, content);
    },
    [messages, scenario, sending, dispatch, requestTurn]
  );

  const handleDictate = useCallback(() => {
    if (dictating) {
      recognizer.stop();
      return;
    }
    setDictating(true);
    recognizer.start({
      onInterim: () => {
        /* keep the input stable while speaking; text lands via onFinal */
      },
      onFinal: (transcript) => {
        setDictating(false);
        if (transcript) {
          setDraft((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      },
      onError: (code) => {
        setDictating(false);
        setError(
          code === "not-allowed"
            ? "Microphone access was denied. Allow it in your browser's site settings."
            : `Speech recognition error: ${code}`
        );
      },
    });
  }, [dictating, recognizer]);

  const handleSendClick = () => {
    const text = draft;
    setDraft("");
    sendLine(text);
  };

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
                  handleSendClick();
                }
              }}
              disabled={sending}
            />
            {isRecognitionSupported() && (
              <button
                type="button"
                className={`btn ${dictating ? "btn-recording" : "btn-ghost"}`}
                onClick={handleDictate}
                title={dictating ? "Stop dictation" : "Speak your line"}
              >
                🎙️
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSendClick}
              disabled={sending || !draft.trim()}
            >
              Send
            </button>
          </div>

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
