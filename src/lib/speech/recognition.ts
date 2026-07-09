/**
 * Thin, typed wrapper around the browser's SpeechRecognition API.
 *
 * Why the hand-written ambient types: SpeechRecognition is still a
 * vendor-prefixed, non-standardized API, so TypeScript's DOM lib does not
 * ship types for it. Declaring the minimal surface we use keeps the rest of
 * the codebase fully type-safe without pulling in a third-party types package.
 *
 * Why a class with callbacks (not a Promise): recognition is a *stream* —
 * we need interim results live on screen while the user speaks, then the
 * final transcript when the engine detects end-of-speech. A single Promise
 * cannot model that.
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const w = window as unknown as Record<string, unknown>;
  return (w["SpeechRecognition"] ?? w["webkitSpeechRecognition"] ?? null) as
    | SpeechRecognitionConstructor
    | null;
}

export function isRecognitionSupported(): boolean {
  return getRecognitionConstructor() !== null;
}

export interface RecognizerCallbacks {
  /** Fires continuously while speaking: full transcript so far + live tail. */
  onInterim: (transcriptSoFar: string) => void;
  /** Fires exactly once, when the session ends, with the final transcript. */
  onFinal: (finalTranscript: string) => void;
  /** Fires on unrecoverable errors ("not-allowed", "no-speech", ...). */
  onError: (error: string) => void;
}

export class SpeechRecognizer {
  private recognition: SpeechRecognitionLike | null = null;
  private finalSegments: string[] = [];
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Begin one recognition session. `continuous: true` + a manual stop() gives
   * the user control over long sentences instead of the engine cutting them
   * off at the first pause — essential for shadowing multi-clause sentences.
   */
  start(callbacks: RecognizerCallbacks): void {
    const Ctor = getRecognitionConstructor();
    if (!Ctor) {
      callbacks.onError("unsupported");
      return;
    }
    if (this.active) return; // one session at a time

    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    this.finalSegments = [];
    this.active = true;

    recognition.onresult = (event) => {
      let interimTail = "";
      // resultIndex marks the first result that changed in this event; results
      // before it were already consumed into finalSegments in earlier events.
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          this.finalSegments.push(text.trim());
        } else {
          interimTail += text;
        }
      }
      const soFar = [...this.finalSegments, interimTail.trim()]
        .filter(Boolean)
        .join(" ");
      callbacks.onInterim(soFar);
    };

    recognition.onerror = (event) => {
      // "no-speech" and "aborted" are normal user-flow outcomes, not failures;
      // onend still fires after them and delivers whatever we captured.
      if (event.error !== "no-speech" && event.error !== "aborted") {
        this.active = false;
        callbacks.onError(event.error);
      }
    };

    recognition.onend = () => {
      if (!this.active) return; // an onerror already reported this session
      this.active = false;
      callbacks.onFinal(this.finalSegments.join(" ").trim());
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      // iOS Safari throws InvalidStateError when a previous session is still
      // tearing down (abort() racing a pending onend). Surface it as a normal
      // recognition error so the UI resets cleanly instead of crashing.
      this.active = false;
      this.recognition = null;
      callbacks.onError("start-failed");
    }
  }

  /** Graceful stop: flushes pending audio, then onend delivers the final text. */
  stop(): void {
    this.recognition?.stop();
  }

  /** Hard cancel: discard everything, fire no callbacks. Used on unmount. */
  abort(): void {
    this.active = false;
    this.recognition?.abort();
    this.recognition = null;
  }
}
