/**
 * Primary navigation. Renders the brand, the animated theme toggle, the six
 * view links (Review Studio carries a live SRS-queue badge), and a mini
 * summary of the player's level and streak so progress is always visible —
 * a core gamification principle (persistent progress feedback).
 */
import { useAppState, levelFromXp } from "../state/AppStateContext";
import type { View } from "../types";

interface NavEntry {
  view: View;
  label: string;
  icon: string;
}

const NAV_ENTRIES: NavEntry[] = [
  { view: "dashboard", label: "Dashboard", icon: "📊" },
  { view: "shadowing", label: "Shadowing Studio", icon: "🎙️" },
  { view: "review", label: "Review Studio", icon: "🔁" },
  { view: "conversation", label: "AI Conversation", icon: "💬" },
  { view: "scenario", label: "Scenario Studio", icon: "🎭" },
  { view: "sentences", label: "My Sentences", icon: "📝" },
  { view: "settings", label: "Settings", icon: "⚙️" },
];

interface SidebarProps {
  activeView: View;
  onNavigate: (view: View) => void;
}

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  const { state, dispatch } = useAppState();
  const level = levelFromXp(state.profile.xp);
  const reviewCount = state.reviewQueue.length;
  const theme = state.settings.theme;

  const toggleTheme = () => {
    // The reducer persists the choice; the provider's effect stamps
    // data-theme on <html>, and pure CSS does the rest of the flip.
    dispatch({
      type: "UPDATE_SETTINGS",
      settings: { theme: theme === "dark" ? "light" : "dark" },
    });
  };

  return (
    <nav className="sidebar" aria-label="Primary navigation">
      <div className="brand">
        <span className="brand-mark">LA</span>
        <span className="brand-text">
          Lingua<span className="brand-gradient-text">Arcade</span>
        </span>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          <span className="theme-icon sun" aria-hidden="true">
            ☀️
          </span>
          <span className="theme-icon moon" aria-hidden="true">
            🌙
          </span>
        </button>
      </div>

      {NAV_ENTRIES.map((entry) => (
        <button
          key={entry.view}
          type="button"
          className={`nav-item${entry.view === activeView ? " active" : ""}`}
          onClick={() => onNavigate(entry.view)}
          aria-current={entry.view === activeView ? "page" : undefined}
        >
          <span className="nav-icon" aria-hidden="true">
            {entry.icon}
          </span>
          <span className="nav-label">{entry.label}</span>
          {entry.view === "review" && reviewCount > 0 && (
            <span className="nav-badge" aria-label={`${reviewCount} phrases to review`}>
              {reviewCount}
            </span>
          )}
        </button>
      ))}

      <div className="sidebar-footer">
        <span>
          Level <strong>{level}</strong> · <strong>{state.profile.xp}</strong> XP
        </span>
        <span>
          🔥 Streak: <strong>{state.profile.currentStreak}</strong> day
          {state.profile.currentStreak === 1 ? "" : "s"}
        </span>
      </div>
    </nav>
  );
}
