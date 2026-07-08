/**
 * Primary navigation. Renders the brand, the five view links, and a live
 * mini-summary of the player's level and streak so progress is always visible
 * — a core gamification principle (persistent progress feedback).
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
  { view: "conversation", label: "AI Conversation", icon: "💬" },
  { view: "sentences", label: "My Sentences", icon: "📝" },
  { view: "settings", label: "Settings", icon: "⚙️" },
];

interface SidebarProps {
  activeView: View;
  onNavigate: (view: View) => void;
}

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  const { state } = useAppState();
  const level = levelFromXp(state.profile.xp);

  return (
    <nav className="sidebar" aria-label="Primary navigation">
      <div className="brand">
        <span className="brand-mark">LA</span>
        <span className="brand-text">
          Lingua<span className="brand-gradient-text">Arcade</span>
        </span>
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
