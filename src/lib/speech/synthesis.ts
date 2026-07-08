/**
 * Text-to-speech helper built on speechSynthesis.
 *
 * Why the voice list is Promise-based: browsers populate getVoices()
 * asynchronously (Chrome returns [] until the "voiceschanged" event). Every
 * consumer awaiting one shared promise-producing function is far more robust
 * than each component racing the event on its own.
 */

export function isSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Resolve the browser's English voices, waiting for async population. */
export function getEnglishVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!isSynthesisSupported()) {
      resolve([]);
      return;
    }
    const pickEnglish = (voices: SpeechSynthesisVoice[]) =>
      voices.filter((v) => v.lang.toLowerCase().startsWith("en"));

    const immediate = window.speechSynthesis.getVoices();
    if (immediate.length > 0) {
      resolve(pickEnglish(immediate));
      return;
    }
    // Voices not loaded yet: wait for the event, with a timeout fallback so a
    // browser that never fires it (some WebViews) can't hang the caller.
    const timer = window.setTimeout(() => {
      resolve(pickEnglish(window.speechSynthesis.getVoices()));
    }, 2000);
    window.speechSynthesis.onvoiceschanged = () => {
      window.clearTimeout(timer);
      resolve(pickEnglish(window.speechSynthesis.getVoices()));
    };
  });
}

export interface SpeakOptions {
  /** voiceURI of the preferred voice; falls back to browser default. */
  voiceURI?: string;
  /** 0.5 (very slow) .. 1.5 (fast). Shadowing works best slightly slow. */
  rate?: number;
}

/**
 * Speak text and resolve when playback finishes (or errors). Resolving on
 * both outcomes lets callers use `await speak(...)` to sequence
 * listen-then-record flows without special error plumbing.
 */
export function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    if (!isSynthesisSupported() || !text.trim()) {
      resolve();
      return;
    }
    // Cancel anything already queued: overlapping utterances during shadowing
    // practice is always a bug, never a feature.
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = options.rate ?? 0.9;
    utterance.pitch = 1;

    if (options.voiceURI) {
      const voice = window.speechSynthesis
        .getVoices()
        .find((v) => v.voiceURI === options.voiceURI);
      if (voice) utterance.voice = voice;
    }

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (isSynthesisSupported()) {
    window.speechSynthesis.cancel();
  }
}
