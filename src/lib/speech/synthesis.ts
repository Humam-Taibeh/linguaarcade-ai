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

/**
 * Rank voices by how natural they sound. Browsers never expose a quality
 * field, so this scores the strongest available signals instead: vendor
 * neural/natural naming (Edge "Natural", Google cloud voices), cloud-backed
 * engines (localService=false), and known high-quality voice names. eSpeak
 * variants are actively penalized — they are the "robotic" sound users hate.
 */
const KNOWN_GOOD_NAMES = [
  "aria",
  "jenny",
  "guy",
  "ryan",
  "sonia",
  "libby",
  "michelle",
  "samantha",
  "karen",
  "daniel",
  "zira",
];

function scoreVoice(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;
  if (name.includes("natural")) score += 10;
  if (name.includes("neural")) score += 9;
  if (name.includes("premium") || name.includes("enhanced")) score += 7;
  if (name.includes("google")) score += 6;
  if (name.includes("online")) score += 3;
  if (!voice.localService) score += 3;
  if (KNOWN_GOOD_NAMES.some((n) => name.includes(n))) score += 2;
  if (lang.startsWith("en-us")) score += 2;
  else if (lang.startsWith("en-gb")) score += 1;
  if (name.includes("espeak")) score -= 8;
  return score;
}

/** The most human-sounding English voice available on this device, or null. */
export function pickPremiumVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (english.length === 0) return null;
  return english.reduce((best, v) => (scoreVoice(v) > scoreVoice(best) ? v : best));
}

export interface SpeakOptions {
  /** voiceURI of the preferred voice; empty/absent means "auto-pick premium". */
  voiceURI?: string;
  /** 0.5 (very slow) .. 1.5 (fast). Shadowing works best slightly slow. */
  rate?: number;
  /** 0.5 .. 2. Defaults to a hair above neutral, which reads warmer. */
  pitch?: number;
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
    // 1.02 lifts the voice just above flat-neutral — warmer, never chipmunk.
    utterance.pitch = options.pitch ?? 1.02;

    // Voice resolution: the user's explicit pick wins; otherwise auto-select
    // the most natural voice this device offers instead of the browser
    // default (which is often the most robotic one installed).
    const voices = window.speechSynthesis.getVoices();
    const requested = options.voiceURI
      ? voices.find((v) => v.voiceURI === options.voiceURI)
      : undefined;
    const voice = requested ?? pickPremiumVoice(voices);
    if (voice) utterance.voice = voice;

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
