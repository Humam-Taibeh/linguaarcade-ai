/**
 * AI Conversation — a live English partner with a hands-free Voice Notes loop,
 * powered by whichever engine is active in Settings (Gemini cloud or local
 * Ollama over ngrok).
 *
 * All chat machinery (send pipeline, dictation, Voice Notes loop, validation,
 * persistence wiring) lives in useVoiceChat. This view contributes only what
 * is unique to free conversation: the tutor prompt binding, the transcript
 * storage key, the XP policy, and the layout.
 *
 * When the active engine is unconfigured, the view degrades into the Offline
 * Bridge (prompt generator + response ingestion) instead of a dead end.
 */
import {
  sendTutorMessage,
  engineConfigFromSettings,
  hasConfiguredEngine,
} from "../lib/gemini/client";
import {
  loadConversation,
  saveConversation,
  clearConversation,
  type StoredChatMessage,
} from "../lib/chatStore";
import { playXpBlip } from "../lib/audio/chimes";
import { useAppState } from "../state/AppStateContext";
import { useVoiceChat, MAX_MESSAGE_CHARS } from "../hooks/useVoiceChat";
import { OfflineBridge } from "../components/OfflineBridge";
import { VoiceWave } from "../components/VoiceWave";
import type { View } from "../types";

const XP_PER_EXCHANGE = 6;

/** Start showing the character counter this close to the cap. */
const COUNTER_THRESHOLD = MAX_MESSAGE_CHARS - 200;

const OPENING_MESSAGE: StoredChatMessage = {
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

  const {
    messages,
    sending,
    error,
    chatWindowRef,
    draft,
    setDraft,
    sendDraft,
    overLimit,
    dictating,
    toggleDictation,
    recognitionSupported,
    speakReplies,
    setSpeakReplies,
    voiceMode,
    loopPhase,
    loopTranscript,
    speechActive,
    toggleVoiceMode,
    resetChat,
  } = useVoiceChat({
    sendTurn: (history, text) =>
      sendTutorMessage(engineConfigFromSettings(settings), history, text),
    // Resume the persisted transcript — the chat survives reloads, navigation,
    // and even the AI backend dying mid-session.
    initialMessages: () => loadConversation() ?? [OPENING_MESSAGE],
    onMessagesChange: saveConversation,
    onExchangeComplete: (content) => {
      // Every real exchange counts as practice: award XP, advance the streak.
      dispatch({
        type: "RECORD_SESSION",
        kind: "conversation",
        accuracy: null,
        xpEarned: XP_PER_EXCHANGE,
        textPreview: content,
      });
      if (settings.soundEffects) playXpBlip();
    },
  });

  const handleNewChat = () => {
    clearConversation();
    resetChat([OPENING_MESSAGE]);
  };

  // The chat is usable when ANY engine is configured — failover means the
  // preferred one doesn't have to be the working one. Otherwise the Offline
  // Bridge takes over.
  const engineReady = hasConfiguredEngine(engineConfigFromSettings(settings));

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
              placeholder="Write (or dictate) your message in English…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter makes a newline — chat convention.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendDraft();
                }
              }}
              disabled={sending || voiceMode}
            />
            {recognitionSupported && (
              <button
                type="button"
                className={`btn ${dictating ? "btn-recording" : "btn-ghost"}`}
                onClick={toggleDictation}
                disabled={voiceMode}
                title={dictating ? "Stop dictation" : "Dictate with your voice"}
              >
                🎙️
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={sendDraft}
              disabled={sending || voiceMode || !draft.trim() || overLimit}
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
            {recognitionSupported && (
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
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleNewChat}
              disabled={sending}
              title="Start a fresh conversation (clears the saved transcript)"
            >
              🗑️ New chat
            </button>
            <span className="pill accent">+{XP_PER_EXCHANGE} XP per exchange</span>
          </div>
        </div>
      )}
    </div>
  );
}
