/**
 * AI Conversation — a live English partner with a hands-free Voice Notes loop,
 * powered by whichever engine is active in Settings (Gemini cloud or local
 * Ollama over ngrok).
 *
 * Voice loop architecture: send → reply → TTS finishes → microphone opens
 * automatically → final transcript auto-sends → repeat. The chain is driven
 * by awaited promises (speak() resolves exactly when playback ends), not
 * timers, so the mic opens "the exact millisecond" TTS stops. A ref mirrors
 * the voice-mode flag because the async continuations must consult the
 * *current* value, not the one captured when the chain started.
 *
 * When the active engine is unconfigured, the view degrades into the Offline Bridge
 * (prompt generator + response ingestion) instead of a dead end.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  sendTutorMessage,
  TutorApiError,
  type ChatMessage,
  type Correction,
  type TutorReply,
} from "../lib/gemini/client";
import { SpeechRecognizer, isRecognitionSupported } from "../lib/speech/recognition";
import { speak, stopSpeaking } from "../lib/speech/synthesis";
import { playXpBlip } from "../lib/audio/chimes";
import { useAppState } from "../state/AppStateContext";
import { OfflineBridge } from "../components/OfflineBridge";
import { VoiceWave, type WavePhase } from "../components/VoiceWave";
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
  text: "Yo! I'm Lingua — your English partner, not the grammar police. We just talk: your day, food, games, whatever. If something needs fixing, it shows up quietly in the little cards under my replies.",
  followUpQuestion: "So, what's been the highlight of your week so far?",
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

  // --- Voice Notes loop state -------------------------------------------
  const [voiceMode, setVoiceMode] = useState(false);
  const [loopPhase, setLoopPhase] = useState<WavePhase>("idle");
  const [loopTranscript, setLoopTranscript] = useState("");
  // "The user is audibly speaking right now": flips on with every interim
  // recognition event and decays shortly after they pause. Drives the
  // voice-reactive surge of the waveform.
  const [speechActive, setSpeechActive] = useState(false);
  const speechActivityTimer = useRef<number | null>(null);
  // Ref mirror: async continuations (post-TTS, post-recognition) must read
  // the live value, not a stale closure snapshot.
  const voiceModeRef = useRef(false);

  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  if (recognizerRef.current === null) {
    recognizerRef.current = new SpeechRecognizer();
  }

  // Forward reference: startVoiceCapture needs sendMessage and vice versa.
  // A ref breaks the cycle without disabling exhaustive callback typing.
  const sendMessageRef = useRef<((text: string) => Promise<void>) | null>(null);

  const chatWindowRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = chatWindowRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    const recognizer = recognizerRef.current;
    return () => {
      voiceModeRef.current = false;
      recognizer?.abort();
      stopSpeaking();
      if (speechActivityTimer.current !== null) {
        window.clearTimeout(speechActivityTimer.current);
      }
    };
  }, []);

  /** Pulse the "user is speaking" flag; it decays 650ms after the last word. */
  const markSpeechActivity = useCallback(() => {
    setSpeechActive(true);
    if (speechActivityTimer.current !== null) {
      window.clearTimeout(speechActivityTimer.current);
    }
    speechActivityTimer.current = window.setTimeout(() => setSpeechActive(false), 650);
  }, []);

  const stopVoiceMode = useCallback((reason?: string) => {
    voiceModeRef.current = false;
    setVoiceMode(false);
    setLoopPhase("idle");
    setLoopTranscript("");
    recognizerRef.current?.abort();
    stopSpeaking();
    if (reason) setError(reason);
  }, []);

  /** Open the microphone for one hands-free turn of the voice loop. */
  const startVoiceCapture = useCallback(() => {
    const recognizer = recognizerRef.current;
    if (!recognizer || !voiceModeRef.current) return;

    setLoopTranscript("");
    setLoopPhase("listening");

    recognizer.start({
      onInterim: (transcript) => {
        setLoopTranscript(transcript);
        markSpeechActivity();
      },
      onFinal: (transcript) => {
        setLoopPhase("idle");
        setLoopTranscript("");
        setSpeechActive(false);
        if (!voiceModeRef.current) return;
        const text = transcript.trim();
        if (text) {
          // Auto-send: this is what makes the loop truly hands-free.
          void sendMessageRef.current?.(text);
        } else {
          // Silence means the user stepped away — pause rather than spin an
          // infinite open-mic loop that burns battery and recognition quota.
          stopVoiceMode("Voice loop paused — I didn't hear anything. Tap 🎧 to resume.");
        }
      },
      onError: (code) => {
        stopVoiceMode(
          code === "not-allowed"
            ? "Microphone access was denied. Allow it in your browser's site settings."
            : `Speech recognition error: ${code}`
        );
      },
    });
  }, [stopVoiceMode, markSpeechActivity]);

  const sendMessage = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || sending) return;

      setError(null);
      setSending(true);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: content }]);

     // Rebuild API-shaped history from what is on screen.
      const history: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        text: m.followUpQuestion ? `${m.text} ${m.followUpQuestion}` : m.text,
      }));

      let reply: TutorReply | null = null;
      try {
        reply = await sendTutorMessage(
          {
            engine: settings.aiEngine,
            geminiApiKey: settings.geminiApiKey,
            ollamaBaseUrl: settings.ollamaBaseUrl,
            ollamaModel: settings.ollamaModel,
            groqApiKey: settings.groqApiKey || "", // هذا السطر اللي كان يسبب الخطأ
          },
          history,
          content
        );
      } catch (err) {
        setError(err instanceof TutorApiError ? err.message : "Unexpected error — try again.");
        if (voiceModeRef.current) stopVoiceMode();
      } finally {
        setSending(false);
      }
      if (!reply) return;
      // Re-bind to a const: TS won't narrow a `let` inside the state-updater
      // closure below, and the loop code reads these fields repeatedly.
      const tutorReply = reply;

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "model",
          text: tutorReply.reply,
          corrections: tutorReply.corrections,
          followUpQuestion: tutorReply.followUpQuestion,
        },
      ]);

      // Every real exchange counts as practice: award XP and advance the streak.
      dispatch({
        type: "RECORD_SESSION",
        kind: "conversation",
        accuracy: null,
        xpEarned: XP_PER_EXCHANGE,
        textPreview: content,
      });
      if (settings.soundEffects) playXpBlip();

      const spokenText = `${tutorReply.reply} ${tutorReply.followUpQuestion}`.trim();
      if (voiceModeRef.current) {
        // The awaited speak() is the timing heart of the loop: it resolves on
        // the utterance's `end` event, so capture starts the moment TTS stops.
        setLoopPhase("speaking");
        await speak(spokenText, {
          voiceURI: settings.voiceURI || undefined,
          rate: settings.speechRate,
          pitch: settings.speechPitch,
        });
        setLoopPhase("idle");
        if (voiceModeRef.current) startVoiceCapture();
      } else if (speakReplies) {
        void speak(spokenText, {
          voiceURI: settings.voiceURI || undefined,
          rate: settings.speechRate,
          pitch: settings.speechPitch,
        });
      }
    },
    [sending, messages, settings, dispatch, speakReplies, startVoiceCapture, stopVoiceMode]
  );

  // Keep the ref pointing at the freshest sendMessage (it recreates whenever
  // messages/settings change; the voice loop must always call the newest one).
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const toggleVoiceMode = useCallback(() => {
    if (voiceModeRef.current) {
      stopVoiceMode();
      return;
    }
    setError(null);
    voiceModeRef.current = true;
    setVoiceMode(true);
    // The user opens the loop by speaking first — mic goes hot immediately.
    startVoiceCapture();
  }, [startVoiceCapture, stopVoiceMode]);

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

  const handleSendClick = () => {
    const text = draft;
    setDraft("");
    void sendMessage(text);
  };

  // The chat is usable when the *active* engine is configured: Gemini needs a
  // key, Ollama needs a tunnel URL. Otherwise the Offline Bridge takes over.
  const engineReady =
    settings.aiEngine === "gemini"
      ? settings.geminiApiKey.trim().length > 0
      : settings.ollamaBaseUrl.trim().length > 0;

  return (
    // view-fill: this view owns the full pane height — the page never
    // scrolls here, only the chat window inside the card does (app-like).
    <div className={engineReady ? "fade-in view-fill" : "fade-in"}>
      <h1 className="view-header">AI Conversation</h1>
      <p className="view-subtitle">
        Free-talk with your AI partner — by text, or fully hands-free in Voice Notes mode.
        It corrects your grammar and keeps the conversation moving.
      </p>

      {!engineReady ? (
        <OfflineBridge onNavigate={onNavigate} />
      ) : (
        <div className="glass chat-card">
          {error && <div className="error-banner">{error}</div>}

          {voiceMode && (
            // The phase class drives the panel's visual state: a pulsing teal
            // halo while listening ("the AI hears me"), indigo while speaking.
            <div className={`voice-loop-panel ${loopPhase}`}>
              <VoiceWave phase={loopPhase} active={speechActive} />
              <span className="voice-loop-status">
                {loopPhase === "listening"
                  ? "Your turn — speak now"
                  : loopPhase === "speaking"
                    ? "Lingua is speaking…"
                    : "Thinking…"}
              </span>
              <span className="voice-loop-transcript">{loopTranscript}</span>
            </div>
          )}

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

                {message.followUpQuestion && (
                  <div className="follow-up">{message.followUpQuestion}</div>
                )}
              </div>
            ))}
            {sending && (
              <div className="typing-indicator">
                Lingua is thinking
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
              placeholder="Write (or dictate) your message in English…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter makes a newline — chat convention.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendClick();
                }
              }}
              disabled={sending || voiceMode}
            />
            {isRecognitionSupported() && (
              <button
                type="button"
                className={`btn ${dictating ? "btn-recording" : "btn-ghost"}`}
                onClick={handleDictate}
                disabled={voiceMode}
                title={dictating ? "Stop dictation" : "Dictate with your voice"}
              >
                🎙️
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSendClick}
              disabled={sending || voiceMode || !draft.trim()}
            >
              Send
            </button>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            {isRecognitionSupported() && (
              <button
                type="button"
                className={`btn ${voiceMode ? "btn-recording" : ""}`}
                onClick={toggleVoiceMode}
                title="Hands-free spoken conversation: Lingua speaks, then your mic opens automatically"
              >
                🎧 {voiceMode ? "Stop Voice Notes" : "Voice Notes mode"}
              </button>
            )}
            <label style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>
              <input
                type="checkbox"
                checked={speakReplies}
                onChange={(e) => setSpeakReplies(e.target.checked)}
                disabled={voiceMode}
                style={{ marginRight: 6 }}
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
