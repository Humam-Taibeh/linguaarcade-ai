/**
 * Pulsating audio-wave visualizer for the voice-first conversation loop.
 *
 * Why CSS-driven bars instead of a real AnalyserNode spectrum: the microphone
 * stream is owned by the SpeechRecognition engine during the loop, and
 * opening a second getUserMedia capture just to draw amplitudes risks device
 * contention on some platforms (and costs battery on phones). Animated bars
 * communicate the same state — "the app is speaking / hearing you" — with
 * zero extra audio plumbing and perfectly smooth 60 fps compositor-only
 * animation (transform: scaleY).
 */

export type WavePhase = "idle" | "speaking" | "listening";

interface VoiceWaveProps {
  phase: WavePhase;
  /**
   * True while the recognizer is actively producing interim transcript —
   * i.e. the user is audibly speaking right now. The bars surge in response,
   * which is what makes the loop feel like it hears you. Interim events are
   * a free voice-activity signal; no second getUserMedia capture needed.
   */
  active?: boolean;
}

const BAR_COUNT = 7;

export function VoiceWave({ phase, active = false }: VoiceWaveProps) {
  return (
    <div
      className={`voice-wave ${phase}${active ? " active" : ""}`}
      role="status"
      aria-label={
        phase === "listening"
          ? "Microphone is live — speak now"
          : phase === "speaking"
            ? "AI partner is speaking"
            : "Voice loop idle"
      }
    >
      {Array.from({ length: BAR_COUNT }, (_, index) => (
        <span
          key={index}
          className="voice-bar"
          // Staggered delays make the bars roll like a real waveform instead
          // of pumping in unison.
          style={{ animationDelay: `${index * 90}ms` }}
        />
      ))}
    </div>
  );
}
