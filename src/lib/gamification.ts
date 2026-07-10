/**
 * Gamification derivations for the Utility Rail: daily quests and the weekly
 * practice league.
 *
 * Everything here is a PURE function of (sessions, clock) — no stored quest
 * state, no backend. Quests recompute from today's real session records, so
 * they can never drift out of sync with actual practice. The league is a
 * local, deterministic simulation: pace-setter competitors are seeded from
 * the week key, so their scores are identical across reloads and grow
 * smoothly through the week — a motivating pace to race, not a fake claim
 * of other humans.
 */
import type { SessionRecord } from "../types";
import { todayKey } from "../state/AppStateContext";

// ---------------------------------------------------------------------------
// Daily quests
// ---------------------------------------------------------------------------

export interface DailyQuest {
  id: string;
  icon: string;
  label: string;
  target: number;
  progress: number;
  complete: boolean;
}

/** Sessions completed on the local calendar day of `now`. */
function sessionsToday(sessions: SessionRecord[], now: Date): SessionRecord[] {
  const today = todayKey(now);
  return sessions.filter((s) => todayKey(new Date(s.completedAt)) === today);
}

/**
 * The three-quest daily board. Targets are tuned to one honest practice
 * sitting (~15 minutes): reachable daily, never trivial.
 */
export function buildDailyQuests(
  sessions: SessionRecord[],
  now: Date = new Date()
): DailyQuest[] {
  const todays = sessionsToday(sessions, now);
  const xpToday = todays.reduce((sum, s) => sum + s.xpEarned, 0);
  const conversationsToday = todays.filter((s) => s.kind === "conversation").length;

  const quests = [
    { id: "xp", icon: "⚡", label: "Earn 50 XP", target: 50, progress: xpToday },
    { id: "sessions", icon: "🎯", label: "Finish 3 practice sessions", target: 3, progress: todays.length },
    { id: "conversation", icon: "💬", label: "Complete a conversation exchange", target: 1, progress: conversationsToday },
  ];
  return quests.map((q) => ({ ...q, complete: q.progress >= q.target }));
}

// ---------------------------------------------------------------------------
// Weekly league
// ---------------------------------------------------------------------------

export interface LeagueRow {
  name: string;
  xp: number;
  isYou: boolean;
  /** Top-3 slot — rendered in the "promotion zone" style. */
  promotion: boolean;
}

/** Monday 00:00 local time of the week containing `date`. */
export function weekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** FNV-1a — turns the week key into a stable 32-bit PRNG seed. */
function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32 — tiny deterministic PRNG; quality is plenty for cosmetics. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPETITOR_NAMES = [
  "Miguel", "Sofia", "Yuki", "Amara", "Lucas", "Priya", "Hana",
  "Diego", "Elif", "Noah", "Inès", "Ravi", "Mei", "Tomás", "Zara",
];

const LEAGUE_SIZE = 10; // 9 pace-setters + the user

/**
 * The weekly league table, sorted by XP. The user's row aggregates their
 * REAL session XP since Monday; the nine competitors are deterministic
 * pace-setters whose weekly pace is fixed per week (same seed ⇒ same pace)
 * and whose scores accrue continuously as the week elapses — so the table
 * moves between visits, like a live league would.
 */
export function buildWeeklyLeague(
  sessions: SessionRecord[],
  now: Date = new Date()
): LeagueRow[] {
  const start = weekStart(now);
  const userXp = sessions
    .filter((s) => new Date(s.completedAt) >= start)
    .reduce((sum, s) => sum + s.xpEarned, 0);

  const rng = mulberry32(hashString(todayKey(start)));

  // Deterministic Fisher–Yates draw of this week's nine competitors.
  const pool = [...COMPETITOR_NAMES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const elapsedDays = Math.min(7, (now.getTime() - start.getTime()) / 86_400_000);
  const rows: LeagueRow[] = pool.slice(0, LEAGUE_SIZE - 1).map((name) => {
    // Pace spread (18–88 XP/day) brackets a real learner's output, so the
    // user always has someone just ahead and someone just behind.
    const dailyPace = 18 + rng() * 70;
    const headStart = rng() * 20; // staggers Monday-morning zeros
    return {
      name,
      xp: Math.round(dailyPace * elapsedDays + headStart),
      isYou: false,
      promotion: false,
    };
  });

  rows.push({ name: "You", xp: userXp, isYou: true, promotion: false });
  rows.sort((a, b) => b.xp - a.xp);
  return rows.map((row, index) => ({ ...row, promotion: index < 3 }));
}
