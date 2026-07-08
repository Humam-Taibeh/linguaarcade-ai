/**
 * Per-word pronunciation feedback renderer.
 *
 * Each target word becomes a colored chip: green (accurate), amber (close),
 * red (wrong), dashed red (never spoken). Hovering a mismatched chip reveals
 * what the recognizer actually heard — that "expected vs heard" contrast is
 * the single most useful piece of feedback for fixing a mispronunciation.
 */
import type { PronunciationReport } from "../lib/speech/scorer";

interface WordDiffProps {
  report: PronunciationReport;
}

export function WordDiff({ report }: WordDiffProps) {
  return (
    <div>
      <div className="word-diff">
        {report.words.map((word, index) => {
          const title =
            word.verdict === "correct"
              ? "Accurate"
              : word.verdict === "missing"
                ? "Not detected — this word was never heard"
                : `Heard: “${word.spoken ?? "?"}”`;
          return (
            <span
              key={`${word.target}-${index}`}
              className={`word-chip ${word.verdict}`}
              title={title}
            >
              {word.target}
            </span>
          );
        })}
      </div>

      {report.extraWords.length > 0 && (
        <p className="extra-words">
          Extra words heard:{" "}
          {report.extraWords.map((word, index) => (
            <span key={`${word}-${index}`} className="extra">
              {word}
            </span>
          ))}
        </p>
      )}

      <div className="diff-legend" aria-hidden="true">
        <span>
          <span className="legend-swatch" style={{ background: "var(--success)" }} />
          Accurate
        </span>
        <span>
          <span className="legend-swatch" style={{ background: "var(--warning)" }} />
          Close — refine it
        </span>
        <span>
          <span className="legend-swatch" style={{ background: "var(--danger)" }} />
          Mispronounced
        </span>
        <span>
          <span
            className="legend-swatch"
            style={{ background: "transparent", border: "1px dashed var(--danger)" }}
          />
          Missing
        </span>
      </div>
    </div>
  );
}
