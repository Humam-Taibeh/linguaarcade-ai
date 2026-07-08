/**
 * AI Conversation — a live English partner powered by the user's own Gemini
 * API key. Every learner message is checked for mistakes; corrections render
 * as inline cards under the tutor's reply, and each exchange earns XP so
 * conversation practice feeds the same streak/level economy as shadowing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  sendTutorMessage,
  GeminiError,
  type ChatMessage,
  type Correction,
} from "../lib/gemini/client";
import { SpeechRecognizer, isRecognitionSupported } from "../lib/speech/recognition";
import { speak, stopSpeaking } from "../lib/speech/synthesis";
import { playXpBlip } from "../lib/audio/chimes";
import { useAppState } from "../state/AppStateContext";
import type { View } from "../types";

interface DisplayMessage {
  id: string;
  role: "user" | "model";
  text: string;
  corrections?: Correction[];
  followUpQuestion?: string;
}

const XP_PER_EXCHANGE = 6;

const OPENING_MESSAGE: DisplayMessage = {
  id: "opening",
  role: "model",
  text: "Hi! I'm Lingua, your English conversation partner. Tell me about your day, a topic you love, or anything at all — I'll chat with you and point out any mistakes I notice.",
  followUpQuestion: "So — what's something interesting that happened to you recently?",
};

interface ConversationProps {
  onNavigate: (view: View) => void;
}

export function Conversation({ onNavigate }: ConversationProps) {
  const { state, dispatch } = useAppState();
  const { settings } = state;

  const [messages, setMessages] = useState<DisplayMessage[]>([OPENING_MESSAGE]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  if (recognizerRef.current === null) {
    recognizerRef.current = new SpeechRecognizer();
  }

  const chatWindowRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = chatWindowRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    const recognizer = recognizerRef.current;
    return () => {
      recognizer?.abort();
      stopSpeaking();
    };
  }, []);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;

    setError(null);
    setDraft("");
    setSending(true);
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text }]);

    // Rebuild API-shaped history from what is on screen. Model turns include
    // the follow-up question so the tutor remembers what it asked.
    const history: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      text: m.followUpQuestion ? `${m.text} ${m.followUpQuestion}` : m.text,
    }));

    try {
      const reply = await sendTutorMessage(settings.geminiApiKey, history, text);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "model",
          text: reply.reply,
          corrections: reply.corrections,
          followUpQuestion: reply.followUpQuestion,
        },
      ]);

      // Every real exchange counts as practice: award XP and advance the streak.
      dispatch({
        type: "RECORD_SESSION",
        kind: "conversation",
        accuracy: null,
        xpEarned: XP_PER_EXCHANGE,
        textPreview: text,
      });
      if (settings.soundEffects) playXpBlip();

      if (speakReplies) {
        void speak(`${reply.reply} ${reply.followUpQuestion}`.trim(), {
          voiceURI: settings.voiceURI || undefined,
          rate: settings.speechRate,
        });
      }
    } catch (err) {
      setError(err instanceof GeminiError ? err.message : "Unexpected error — try again.");
    } finally {
      setSending(false);
    }
  }, [draft, sending, messages, settings, dispatch, speakReplies]);

  const handleDictate = useCallback(() => {
    const recognizer = recognizerRef.current;
    if (!recognizer) return;
    if (dictating) {
      recognizer.stop();
      return;
    }
    setDictating(true);
    recognizer.start({
      onInterim: () => {
        /* the composed text lands via onFinal; interim display is skipped to
           keep the input field stable while speaking */
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
  }, [dictating]);

  const hasKey = settings.geminiApiKey.trim().length > 0;

  return (
    <div className="fade-in">
      <h1 className="view-header">AI Conversation</h1>
      <p className="view-subtitle">
        Free-talk with your AI partner. It corrects your grammar and keeps the conversation
        moving with active-recall questions.
      </p>

      {!hasKey ? (
        <div className="glass">
          <div className="info-banner">
            To activate the AI partner, add your Gemini API key first. The key is stored only
            in this browser and sent only to Google's API.
          </div>
          <button type="button" className="btn btn-primary" onClick={() => onNavigate("settings")}>
            ⚙️ Open Settings
          </button>
        </div>
      ) : (
        <div className="glass">
          {error && <div className="error-banner">{error}</div>}

          <div className="chat-window" ref={chatWindowRef}>
            {messages.map((message) => (
              <div key={message.id} className={`msg ${message.role}`}>
                <div>{message.text}</div>

                {message.corrections?.map((correction, index) => (
                  <div key={index} className="correction-card">
                    <span className="from">{correction.original}</span>
                    {" → "}
                    <span className="to">{correction.corrected}</span>
                    <span className="why">{correction.explanation}</span>
                  </div>
                ))}

                {message.followUpQuestion && (
                  <div style={{ marginTop: 8, fontWeight: 600 }}>
                    {message.followUpQuestion}
                  </div>
                )}
              </div>
            ))}
            {sending && <div className="typing-indicator">Lingua is thinking…</div>}
          </div>

          <div className="chat-input-row">
            <textarea
              className="input"
              rows={2}
              placeholder="Write (or dictate) your message in English…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter makes a newline — chat convention.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              disabled={sending}
            />
            {isRecognitionSupported() && (
              <button
                type="button"
                className={`btn ${dictating ? "btn-recording" : "btn-ghost"}`}
                onClick={handleDictate}
                title={dictating ? "Stop dictation" : "Dictate with your voice"}
              >
                🎙️
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSend()}
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
                style={{ marginRight: 6, accentColor: "var(--accent)" }}
              />
              Read replies aloud
            </label>
            <span className="spacer" />
            <span className="pill accent">+{XP_PER_EXCHANGE} XP per exchange</span>
          </div>
        </div>
      )}
    </div>
  );
}
