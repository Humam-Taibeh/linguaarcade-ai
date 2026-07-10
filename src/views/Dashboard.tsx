/**
 * Dashboard — the gamified home screen. Shows the four numbers that drive the
 * habit loop (streak, level, sessions, accuracy), the recent practice
 * history, and the achievement wall. Everything here is derived state: the
 * dashboard writes nothing, which keeps it trivially correct.
 */
import { useMemo } from "react";
import { useAppState, levelProgress } from "../state/AppStateContext";
import type { View } from "../types";

interface Achievement {
  icon: string;
  title: string;
  description: string;
  unlocked: boolean;
}

interface DashboardProps {
  onNavigate: (view: View) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { state } = useAppState();
  const { profile, sessions, sentences } = state;
  const progress = levelProgress(profile.xp);

  // Average over the last 20 scored shadowing takes: recent enough to reflect
  // current skill, long enough to smooth out one bad take.
  const averageAccuracy = useMemo(() => {
    const scored = sessions
      .filter((s) => s.kind === "shadowing" && s.accuracy !== null)
      .slice(0, 20);
    if (scored.length === 0) return null;
    const total = scored.reduce((sum, s) => sum + (s.accuracy ?? 0), 0);
    return Math.round(total / scored.length);
  }, [sessions]);

  const achievements = useMemo<Achievement[]>(() => {
    const hasPerfectTake = sessions.some((s) => (s.accuracy ?? 0) >= 95);
    return [
      {
        icon: "🐣",
        title: "First Steps",
        description: "Complete your first practice session.",
        unlocked: profile.totalSessions >= 1,
      },
      {
        icon: "🔥",
        title: "On Fire",
        description: "Reach a 3-day practice streak.",
        unlocked: profile.bestStreak >= 3,
      },
      {
        icon: "🗓️",
        title: "Week Warrior",
        description: "Reach a 7-day practice streak.",
        unlocked: profile.bestStreak >= 7,
      },
      {
        icon: "🎯",
        title: "Sharpshooter",
        description: "Score 95%+ on a shadowing take.",
        unlocked: hasPerfectTake,
      },
      {
        icon: "✍️",
        title: "Curriculum Author",
        description: "Save 10 of your own sentences.",
        unlocked: sentences.length >= 10,
      },
      {
        icon: "🏆",
        title: "Arcade Veteran",
        description: "Complete 50 practice sessions.",
        unlocked: profile.totalSessions >= 50,
      },
    ];
  }, [profile.totalSessions, profile.bestStreak, sessions, sentences.length]);

  const formatWhen = (iso: string): string => {
    const date = new Date(iso);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <div className="fade-in">
      <h1 className="view-header">Dashboard</h1>
      <p className="view-subtitle">Your fluency, quantified. Keep the streak alive.</p>

      <div className="stats-grid">
        <div className="glass hoverable">
          <span className="stat-icon" aria-hidden="true">🔥</span>
          <div className="stat-value">{profile.currentStreak}</div>
          <div className="stat-label">
            day streak · best {profile.bestStreak}
          </div>
        </div>

        <div className="glass hoverable">
          <span className="stat-icon" aria-hidden="true">⚡</span>
          <div className="stat-value">Level {progress.level}</div>
          <div className="stat-label">
            {progress.intoLevel} / {progress.neededForNext} XP to level {progress.level + 1}
          </div>
          <div className="xp-bar" aria-hidden="true">
            <div
              className="xp-bar-fill"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
        </div>

        <div className="glass hoverable">
          <span className="stat-icon" aria-hidden="true">🎧</span>
          <div className="stat-value">{profile.totalSessions}</div>
          <div className="stat-label">total practice sessions</div>
        </div>

        <div className="glass hoverable">
          <span className="stat-icon" aria-hidden="true">🎯</span>
          <div className="stat-value">
            {averageAccuracy === null ? "—" : `${averageAccuracy}%`}
          </div>
          <div className="stat-label">avg accuracy (last 20 takes)</div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 24 }}>
        <button type="button" className="btn btn-primary" onClick={() => onNavigate("shadowing")}>
          🎙️ Start shadowing
        </button>
        <button type="button" className="btn" onClick={() => onNavigate("conversation")}>
          💬 Talk to Lingua
        </button>
      </div>

      <div className="two-col">
        <div className="glass">
          <h2 className="card-title">Recent sessions</h2>
          {sessions.length === 0 ? (
            <div className="empty-state">
              No sessions yet — your history appears here after your first take.
            </div>
          ) : (
            sessions.slice(0, 8).map((session) => (
              <div key={session.id} className="session-row">
                <span aria-hidden="true">
                  {session.kind === "shadowing" ? "🎙️" : session.kind === "lesson" ? "🧩" : "💬"}
                </span>
                <span className="session-text">{session.textPreview}</span>
                <span className="spacer" />
                {session.accuracy !== null && (
                  <span
                    className={`pill ${
                      session.accuracy >= 85
                        ? "success"
                        : session.accuracy >= 60
                          ? "warning"
                          : "danger"
                    }`}
                  >
                    {session.accuracy}%
                  </span>
                )}
                <span className="pill accent">+{session.xpEarned} XP</span>
                <span style={{ color: "var(--text-faint)", fontSize: "0.78rem" }}>
                  {formatWhen(session.completedAt)}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="glass">
          <h2 className="card-title">Achievements</h2>
          {achievements.map((achievement) => (
            <div
              key={achievement.title}
              className={`achievement${achievement.unlocked ? "" : " locked"}`}
            >
              <span className="achievement-icon" aria-hidden="true">
                {achievement.icon}
              </span>
              <div>
                <div style={{ fontWeight: 650 }}>{achievement.title}</div>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                  {achievement.description}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
