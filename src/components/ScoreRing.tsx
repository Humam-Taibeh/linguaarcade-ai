/**
 * Animated circular accuracy gauge.
 *
 * Implemented as raw SVG (stroke-dasharray trick) instead of a chart library:
 * it is one arc, and the CSS transition on stroke-dashoffset gives us a
 * smooth "fill up" animation for free when the score changes.
 */

interface ScoreRingProps {
  /** 0-100 accuracy percentage. */
  score: number;
  size?: number;
  label?: string;
}

/** Color communicates verdict at a glance, matching the word-chip semantics. */
function colorForScore(score: number): string {
  if (score >= 85) return "var(--success)";
  if (score >= 60) return "var(--warning)";
  return "var(--danger)";
}

export function ScoreRing({ score, size = 132, label = "Accuracy" }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);
  const color = colorForScore(clamped);

  return (
    <div className="score-ring-wrap" role="img" aria-label={`${label}: ${clamped} percent`}>
      <svg width={size} height={size}>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc, rotated so it starts at 12 o'clock. */}
        <circle
          className="score-ring-progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fill={color}
          fontSize={size * 0.22}
          fontWeight="750"
          fontFamily="inherit"
        >
          {clamped}%
        </text>
      </svg>
      <span className="score-ring-label">{label}</span>
    </div>
  );
}
