/**
 * Utility Rail — the right column of the 3-column desktop shell.
 *
 * Persistent gamification pressure: streak, level, daily quests, and the
 * weekly league stay visible from EVERY view, not just the Dashboard. All
 * numbers derive from real state (profile + session records) via the pure
 * helpers in lib/gamification — the rail owns zero state of its own, so it
 * can never disagree with what the learner actually did.
 *
 * Visibility is pure CSS (≥1200px): below that the rail unmounts nothing and
 * costs nothing — display:none keeps the tree stable across resizes.
 */
import { levelProgress, todayKey, useAppState } from "../state/AppStateContext";
import { buildDailyQuests, buildWeeklyLeague } from "../lib/gamification";

export function UtilityRail() {
  const { state } = useAppState();
  const { profile, sessions } = state;

  const progress = levelProgress(profile.xp);
  const quests = buildDailyQuests(sessions);
  const league = buildWeeklyLeague(sessions);
  const practicedToday = profile.lastPracticeDay === todayKey();

  return (
    <aside className="utility-rail" aria-label="Progress, quests and league">
      <section className={`glass rail-card streak-card${practicedToday ? " lit" : ""}`}>
        <h2 className="rail-card-label">Daily Streak</h2>
        <div className="streak-row">
          <span className={`streak-flame${practicedToday ? " lit" : ""}`} aria-hidden="true">
            🔥
          </span>
          <span className="streak-count">{profile.currentStreak}</span>
          <span className="streak-unit">day{profile.currentStreak === 1 ? "" : "s"}</span>
        </div>
        <p className="rail-hint">
          {practicedToday
            ? "Locked in for today — see you tomorrow."
            : "Practice today to keep the flame alive."}
        </p>
        <p className="rail-hint faint">
          Best: {profile.bestStreak} day{profile.bestStreak === 1 ? "" : "s"}
        </p>
      </section>

      <section className="glass rail-card">
        <h2 className="rail-card-label">Level</h2>
        <div className="rail-level-row">
          <span className="rail-level">Level {progress.level}</span>
          <span className="rail-xp-text">
            {progress.intoLevel.toLocaleString()} / {progress.neededForNext.toLocaleString()} XP
          </span>
        </div>
        <div
          className="xp-bar"
          role="progressbar"
          aria-label="Progress to next level"
          aria-valuemin={0}
          aria-valuemax={progress.neededForNext}
          aria-valuenow={progress.intoLevel}
        >
          <div
            className="xp-bar-fill lime"
            style={{ width: `${Math.round(progress.fraction * 100)}%` }}
          />
        </div>
        <p className="rail-hint faint">{profile.xp.toLocaleString()} XP lifetime</p>
      </section>

      <section className="glass rail-card">
        <h2 className="rail-card-label">Daily Quests</h2>
        {quests.map((quest) => {
          const pct = Math.min(100, Math.round((quest.progress / quest.target) * 100));
          return (
            <div key={quest.id} className={`quest${quest.complete ? " complete" : ""}`}>
              <span className="quest-icon" aria-hidden="true">
                {quest.icon}
              </span>
              <div className="quest-body">
                <div className="quest-title-row">
                  <span className="quest-title">{quest.label}</span>
                  <span className="quest-progress-text">
                    {Math.min(quest.progress, quest.target)}/{quest.target}
                  </span>
                </div>
                <div className="quest-bar">
                  <div className="quest-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
              {quest.complete && (
                <span className="quest-check" role="img" aria-label="Quest complete">
                  ✓
                </span>
              )}
            </div>
          );
        })}
      </section>

      <section className="glass rail-card">
        <h2 className="rail-card-label">Weekly League</h2>
        <ol className="league-list">
          {league.map((row, index) => (
            <li
              key={row.name}
              className={`league-row${row.isYou ? " you" : ""}${row.promotion ? " promotion" : ""}`}
            >
              <span className="league-rank">{index + 1}</span>
              <span className="league-name">{row.name}</span>
              <span className="league-xp">{row.xp.toLocaleString()} XP</span>
            </li>
          ))}
        </ol>
        <p className="rail-hint faint">Practice league · resets Monday</p>
      </section>
    </aside>
  );
}
