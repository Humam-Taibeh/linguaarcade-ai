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

/**
 * Module-level cached voice loading. iOS Safari (and Chrome) populate
 * getVoices() asynchronously — the first synchronous call returns [] and the
 * real list arrives with the "voiceschanged" event. Every TTS consumer awaits
 * this ONE shared promise, so the race is paid at most once per page load.
 *
 * A resolved-empty result does NOT poison the cache: if the timeout fires
 * before the event on a slow device, the next caller retries instead of being
 * stuck with the robotic default voice forever.
 */
let voicesReadyPromise: Promise<SpeechSynthesisVoice[]> | null = null;

export function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  if (voicesReadyPromise) return voicesReadyPromise;

  voicesReadyPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    if (!isSynthesisSupported()) {
      resolve([]);
      return;
    }
    const immediate = window.speechSynthesis.getVoices();
    if (immediate.length > 0) {
      resolve(immediate);
      return;
    }
    // Voices not loaded yet: wait for the event, with a timeout fallback so a
    // browser that never fires it (some WebViews) can't hang the caller.
    const settle = () => resolve(window.speechSynthesis.getVoices());
    const timer = window.setTimeout(settle, 2000);
    window.speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        window.clearTimeout(timer);
        settle();
      },
      { once: true }
    );
  }).then((voices) => {
    if (voices.length === 0) voicesReadyPromise = null; // allow a later retry
    return voices;
  });

  return voicesReadyPromise;
}

/** Resolve the browser's English voices, waiting for async population. */
export async function getEnglishVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = await voicesReady();
  return voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
}

/**
 * Rank voices by how natural they sound. Browsers never expose a quality
 * field, so this scores the strongest available signals instead: vendor
 * neural/natural naming (Edge "Natural", Google cloud voices), cloud-backed
 * engines (localService=false), and known high-quality voice names. eSpeak
 * variants are actively penalized — they are the "robotic" sound users hate.
 */
const KNOWN_GOOD_NAMES = [
  // Microsoft Edge "Natural" voices
  "aria",
  "jenny",
  "guy",
  "ryan",
  "sonia",
  "libby",
  "michelle",
  // Apple's best English voices (iPhone/Mac; Enhanced/Premium variants
  // appear here once downloaded in iOS Settings → Accessibility)
  "samantha",
  "ava",
  "zoe",
  "evan",
  "allison",
  "joelle",
  "karen",
  "daniel",
  "zira",
];

function scoreVoice(voice: SpeechSynthesisVoice): number {
  // iOS often puts the quality marker in the voiceURI, not the display name
  // (e.g. "com.apple.voice.enhanced.en-US.Ava") — score both.
  const id = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;
  if (id.includes("natural")) score += 10;
  if (id.includes("neural")) score += 9;
  if (id.includes("siri")) score += 9;
  if (id.includes("premium") || id.includes("enhanced")) score += 7;
  if (id.includes("google")) score += 6;
  if (id.includes("online")) score += 3;
  if (!voice.localService) score += 3;
  if (KNOWN_GOOD_NAMES.some((n) => id.includes(n))) score += 2;
  if (lang.startsWith("en-us")) score += 2;
  else if (lang.startsWith("en-gb")) score += 1;
  if (id.includes("espeak") || id.includes("compact")) score -= 8;
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
export async function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  if (!isSynthesisSupported() || !text.trim()) return;

  // Cancel anything already queued: overlapping utterances during shadowing
  // practice is always a bug, never a feature.
  window.speechSynthesis.cancel();

  // iOS race fix: wait for the async voice list before resolving the voice.
  // Cached after the first load, so this is a microtask on every later call.
  const voices = await voicesReady();

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = options.rate ?? 0.9;
    // 1.02 lifts the voice just above flat-neutral — warmer, never chipmunk.
    utterance.pitch = options.pitch ?? 1.02;

    // Voice resolution: the user's explicit pick wins; otherwise auto-select
    // the most natural voice this device offers instead of the browser
    // default (which is often the most robotic one installed).
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
