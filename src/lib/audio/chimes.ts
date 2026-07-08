/**
 * Procedural UI sound effects via the Web Audio API.
 *
 * Why synthesized tones instead of audio files: zero assets to load, zero
 * network requests, and the chimes stay perfectly crisp at any volume. Each
 * chime is a tiny additive-synthesis phrase (sine oscillators + exponential
 * gain envelopes), which reads as "premium game UI" rather than "system beep".
 *
 * The AudioContext is created lazily on first use because browsers block
 * audio contexts created before a user gesture.
 */

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (sharedContext) {
    if (sharedContext.state === "suspended") {
      void sharedContext.resume();
    }
    return sharedContext;
  }
  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;
  sharedContext = new Ctor();
  return sharedContext;
}

/**
 * Play one enveloped tone. `startOffset` (seconds from now) lets callers
 * compose arpeggios by scheduling several tones on the audio clock — far more
 * accurate than setTimeout chains.
 */
function playTone(
  frequency: number,
  startOffset: number,
  duration: number,
  type: OscillatorType = "sine",
  peakGain = 0.16
): void {
  const ctx = getContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + startOffset;
  const end = start + duration;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);

  // Fast attack, exponential decay: the shape of every satisfying UI chime.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(end + 0.05);
}

/** Rising major-triad arpeggio: "you did well". */
export function playSuccessChime(): void {
  playTone(523.25, 0.0, 0.28); // C5
  playTone(659.25, 0.09, 0.28); // E5
  playTone(783.99, 0.18, 0.34); // G5
}

/** Success arpeggio crowned with a high octave: reserved for 95%+ scores. */
export function playPerfectChime(): void {
  playTone(523.25, 0.0, 0.26);
  playTone(659.25, 0.08, 0.26);
  playTone(783.99, 0.16, 0.26);
  playTone(1046.5, 0.24, 0.5, "sine", 0.2); // C6
}

/** Triumphant two-chord fanfare for level-ups and unlocked achievements. */
export function playLevelUpFanfare(): void {
  // G major chord...
  playTone(392.0, 0.0, 0.35, "triangle", 0.12);
  playTone(493.88, 0.0, 0.35, "triangle", 0.12);
  playTone(587.33, 0.0, 0.35, "triangle", 0.12);
  // ...resolving up to C major.
  playTone(523.25, 0.28, 0.6, "triangle", 0.14);
  playTone(659.25, 0.28, 0.6, "triangle", 0.14);
  playTone(783.99, 0.28, 0.6, "triangle", 0.14);
  playTone(1046.5, 0.4, 0.55, "sine", 0.16);
}

/** Soft low double-tap: "try again", deliberately gentle, never punishing. */
export function playTryAgainTone(): void {
  playTone(220, 0.0, 0.16, "sine", 0.1);
  playTone(196, 0.14, 0.24, "sine", 0.1);
}

/** Tiny neutral blip for small XP gains (e.g. conversation turns). */
export function playXpBlip(): void {
  playTone(880, 0.0, 0.12, "sine", 0.08);
}
