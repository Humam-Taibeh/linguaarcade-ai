/**
 * useVoiceChat — the single engine behind every chat surface in the app
 * (AI Conversation and Scenario Studio).
 *
 * One hook owns the full pipeline: composer draft → validation → optimistic
 * user bubble → AI turn → model bubble → optional TTS → (in Voice Notes mode)
 * automatic microphone reopen. The views keep only what genuinely differs:
 * which engine call to make (`sendTurn`), where the transcript persists, and
 * what a completed exchange is worth in XP.
 *
 * Voice loop architecture: send → reply → TTS finishes → microphone opens
 * automatically → final transcript auto-sends → repeat. The chain is driven
 * by awaited promises (speak() resolves exactly when playback ends), not
 * timers. Ref mirrors (`voiceModeRef`, `messagesRef`, `optionsRef`) exist
 * because the async continuations must consult the *current* values, not the
 * ones captured when the chain started.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { TutorApiError, type ChatMessage, type TutorReply } from "../lib/gemini/client";
import type { StoredChatMessage } from "../lib/chatStore";
import { SpeechRecognizer, isRecognitionSupported } from "../lib/speech/recognition";
import { speak, stopSpeaking } from "../lib/speech/synthesis";
import { useAppState } from "../state/AppStateContext";
import type { WavePhase } from "../components/VoiceWave";

/** Hard cap enforced at the single choke point — typed, dictated, or voice-loop input. */
export const MAX_MESSAGE_CHARS = 2000;

/**
 * One AI turn. Each view binds its engine + prompt flavor:
 *   Conversation:   (h, t) => sendTutorMessage(config, h, t)
 *   ScenarioStudio: (h, t) => sendScenarioMessage(config, scenario, h, t)
 */
export type SendTurn = (history: ChatMessage[], userText: string) => Promise<TutorReply>;

export interface SendMessageOptions {
  /**
   * false = the text is sent to the engine but never rendered as a user
   * bubble (Scenario Studio's hidden "set the scene" seed). Hidden turns also
   * never fire onExchangeComplete — they are not learner exchanges.
   */
  echoUser?: boolean;
}

export interface UseVoiceChatOptions {
  sendTurn: SendTurn;
  /** Lazy initializer — persisted transcript or opening message. */
  initialMessages: () => StoredChatMessage[];
  /** Fires on every transcript change; the view owns its storage key/shape. */
  onMessagesChange?: (messages: StoredChatMessage[]) => void;
  /** Fires once per SUCCESSFUL visible exchange — XP dispatch + chime live here. */
  onExchangeComplete?: (userText: string, reply: TutorReply) => void;
}

export interface UseVoiceChatResult {
  // Transcript
  messages: StoredChatMessage[];
  sending: boolean;
  error: string | null;
  /** Attach to the scroll container; the hook owns keep-newest-in-view. */
  chatWindowRef: RefObject<HTMLDivElement>;

  // Composer
  draft: string;
  setDraft: (text: string) => void;
  /** Sends the draft and clears it — unless invalid, in which case the draft survives. */
  sendDraft: () => void;
  sendMessage: (text: string, opts?: SendMessageOptions) => Promise<void>;
  /** True while the draft exceeds MAX_MESSAGE_CHARS — drives counter + disabled Send. */
  overLimit: boolean;

  // Dictation (🎙️ → draft)
  dictating: boolean;
  toggleDictation: () => void;
  recognitionSupported: boolean;

  // Read-aloud
  speakReplies: boolean;
  setSpeakReplies: (on: boolean) => void;

  // Voice Notes loop (🎧 hands-free)
  voiceMode: boolean;
  loopPhase: WavePhase;
  loopTranscript: string;
  speechActive: boolean;
  toggleVoiceMode: () => void;

  // Lifecycle: New chat / End scene — kills loop, TTS, recognizer, resets state.
  resetChat: (messages?: StoredChatMessage[]) => void;
}

export function useVoiceChat(options: UseVoiceChatOptions): UseVoiceChatResult {
  const { state } = useAppState();
  const { settings } = state;

  const [messages, setMessages] = useState<StoredChatMessage[]>(options.initialMessages);
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
  // recognition event and decays shortly after they pause.
  const [speechActive, setSpeechActive] = useState(false);
  const speechActivityTimer = useRef<number | null>(null);

  // --- Ref mirrors: async continuations must read live values ------------
  const voiceModeRef = useRef(false);
  const sendingRef = useRef(false);
  const messagesRef = useRef(messages);
  // Latest render's callbacks/settings, so sendMessage stays referentially
  // stable while never calling a stale sendTurn or speaking with old settings.
  const optionsRef = useRef(options);
  const settingsRef = useRef(settings);
  const speakRepliesRef = useRef(true);
  useEffect(() => {
    optionsRef.current = options;
    settingsRef.current = settings;
    speakRepliesRef.current = speakReplies;
    messagesRef.current = messages;
  });

  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  if (recognizerRef.current === null) {
    recognizerRef.current = new SpeechRecognizer();
  }

  // Forward reference: startVoiceCapture needs sendMessage and vice versa.
  // A ref breaks the cycle without disabling exhaustive callback typing.
  const sendMessageRef = useRef<
    ((text: string, opts?: SendMessageOptions) => Promise<void>) | null
  >(null);

  const chatWindowRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = chatWindowRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  // Persist every transition so nothing is ever lost.
  useEffect(() => {
    optionsRef.current.onMessagesChange?.(messages);
  }, [messages]);

  // Unmount: kill the loop, the mic, the TTS, and the decay timer.
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
    setSpeechActive(false);
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
    async (text: string, opts?: SendMessageOptions) => {
      const content = text.trim();
      if (!content || sendingRef.current) return;

      // Centralized validation: ONE choke point for typed, dictated, and
      // voice-loop input. Reject — never truncate — so the tutor can't
      // respond to a sentence the learner didn't finish.
      if (content.length > MAX_MESSAGE_CHARS) {
        const message = `That message is ${content.length.toLocaleString()} characters — the limit is ${MAX_MESSAGE_CHARS.toLocaleString()}. Trim it down and send again.`;
        if (voiceModeRef.current) {
          stopVoiceMode(message);
        } else {
          setError(message);
        }
        return;
      }

      const echoUser = opts?.echoUser !== false;
      // Snapshot BEFORE the optimistic append: the API receives the new text
      // separately from the history.
      const priorMessages = messagesRef.current;

      setError(null);
      sendingRef.current = true;
      setSending(true);
      if (echoUser) {
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: content }]);
      }

      // Rebuild API-shaped history from what is on screen. Folding the
      // follow-up question into the text is a no-op for Scenario Studio,
      // whose replies never carry one.
      const history: ChatMessage[] = priorMessages.map((m) => ({
        role: m.role,
        text: m.followUpQuestion ? `${m.text} ${m.followUpQuestion}` : m.text,
      }));

      let reply: TutorReply | null = null;
      try {
        reply = await optionsRef.current.sendTurn(history, content);
      } catch (err) {
        setError(err instanceof TutorApiError ? err.message : "Unexpected error — try again.");
        if (voiceModeRef.current) stopVoiceMode();
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
      if (!reply) return;
      // Re-bind to a const: TS won't narrow a `let` inside the closures below.
      const tutorReply = reply;

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "model",
          text: tutorReply.reply,
          corrections: tutorReply.corrections,
          // Store only when present, so Scenario transcripts stay lean.
          ...(tutorReply.followUpQuestion ? { followUpQuestion: tutorReply.followUpQuestion } : {}),
        },
      ]);

      // Every real (visible) exchange counts as practice; hidden seeds don't.
      if (echoUser) {
        optionsRef.current.onExchangeComplete?.(content, tutorReply);
      }

      const activeSettings = settingsRef.current;
      const speakOptions = {
        voiceURI: activeSettings.voiceURI || undefined,
        rate: activeSettings.speechRate,
        pitch: activeSettings.speechPitch,
      };
      const spokenText = `${tutorReply.reply} ${tutorReply.followUpQuestion}`.trim();
      if (voiceModeRef.current) {
        // The awaited speak() is the timing heart of the loop: it resolves on
        // the utterance's `end` event, so capture starts the moment TTS stops.
        setLoopPhase("speaking");
        await speak(spokenText, speakOptions);
        setLoopPhase("idle");
        if (voiceModeRef.current) startVoiceCapture();
      } else if (speakRepliesRef.current) {
        void speak(spokenText, speakOptions);
      }
    },
    [startVoiceCapture, stopVoiceMode]
  );

  // Keep the ref pointing at the freshest sendMessage for the voice loop.
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const sendDraft = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    if (text.length > MAX_MESSAGE_CHARS) {
      // Keep the draft intact — clearing it here would destroy user text.
      setError(
        `That message is ${text.length.toLocaleString()} characters — the limit is ${MAX_MESSAGE_CHARS.toLocaleString()}. Trim it down and send again.`
      );
      return;
    }
    setDraft("");
    void sendMessage(text);
  }, [draft, sendMessage]);

  const toggleVoiceMode = useCallback(() => {
    if (voiceModeRef.current) {
      stopVoiceMode();
      return;
    }
    // Reclaim the mic from an in-flight dictation session. abort() fires no
    // callbacks, so the stale dictation onFinal can never write into the
    // draft (or flip `dictating`) after the loop has taken over.
    recognizerRef.current?.abort();
    setDictating(false);
    setError(null);
    voiceModeRef.current = true;
    setVoiceMode(true);
    // The user opens the loop by speaking first — mic goes hot immediately.
    startVoiceCapture();
  }, [startVoiceCapture, stopVoiceMode]);

  const toggleDictation = useCallback(() => {
    const recognizer = recognizerRef.current;
    if (!recognizer) return;
    if (dictating) {
      recognizer.stop();
      return;
    }
    // The voice loop owns the microphone while active. Browsers allow only
    // one live recognition session — a second start() would silently no-op,
    // stranding `dictating` at true and letting the next tap kill the loop's
    // session instead of a dictation one.
    if (voiceModeRef.current || recognizer.isActive) return;
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

  const resetChat = useCallback(
    (nextMessages?: StoredChatMessage[]) => {
      if (voiceModeRef.current) stopVoiceMode();
      recognizerRef.current?.abort();
      setDictating(false);
      stopSpeaking();
      const next = nextMessages ?? [];
      // Sync the mirror immediately: a send fired in the same tick (Scenario
      // Studio's opening seed) must see the fresh, empty history.
      messagesRef.current = next;
      setMessages(next);
      setDraft("");
      setError(null);
    },
    [stopVoiceMode]
  );

  return {
    messages,
    sending,
    error,
    chatWindowRef,
    draft,
    setDraft,
    sendDraft,
    sendMessage,
    overLimit: draft.length > MAX_MESSAGE_CHARS,
    dictating,
    toggleDictation,
    recognitionSupported: isRecognitionSupported(),
    speakReplies,
    setSpeakReplies,
    voiceMode,
    loopPhase,
    loopTranscript,
    speechActive,
    toggleVoiceMode,
    resetChat,
  };
}
