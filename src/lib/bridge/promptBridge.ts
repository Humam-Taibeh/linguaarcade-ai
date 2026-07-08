/**
 * The "No-API Bridge": deterministic fallback for users without a Gemini key.
 *
 * Two halves, both pure functions so they are trivially testable:
 *   1. buildExternalPrompt() — generates a rigorously structured prompt the
 *      user copies into ANY external AI (ChatGPT, Claude, Gemini web, ...).
 *      The prompt pins the response to one exact JSON schema, which is what
 *      makes half 2 reliable.
 *   2. parseExternalResponse() — tolerantly parses whatever the user pastes
 *      back (fenced JSON, prose-wrapped JSON, or even plain sentence lines)
 *      into a typed LessonPayload the UI can render as a living scenario.
 */

export interface Scenario {
  id: string;
  title: string;
  /** One-line description shown in the picker. */
  description: string;
  /** Rich situational context injected into the generated prompt. */
  setting: string;
}

export type LearnerLevel = "beginner" | "intermediate" | "advanced";
export type FocusArea = "grammar" | "vocabulary" | "fluency";

export interface DialogueTurn {
  speaker: string;
  text: string;
}

export interface LessonPayload {
  title: string;
  dialogue: DialogueTurn[];
  practiceSentences: string[];
}

export type ParseResult =
  | { ok: true; lesson: LessonPayload }
  | { ok: false; error: string };

/**
 * Curated high-value scenarios. Each `setting` is written to give the
 * external model enough situational texture to produce specific, realistic
 * language instead of generic textbook dialogue.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: "airport",
    title: "Airport Check-in",
    description: "Bags, boarding passes, seat changes, and a delayed flight.",
    setting:
      "An international airport check-in desk. The traveler has one bag to check, wants an aisle seat, and just learned the flight is delayed 40 minutes.",
  },
  {
    id: "cafe",
    title: "Ordering at a Café",
    description: "Customizing an order, asking questions, handling a mistake.",
    setting:
      "A busy specialty coffee shop. The customer wants a customized drink, asks about food options, and politely points out that the order came out wrong.",
  },
  {
    id: "tech-interview",
    title: "Tech Job Interview",
    description: "Introducing yourself, describing projects, asking smart questions.",
    setting:
      "A video interview for a software role. The candidate introduces their background, walks through a past project, handles a behavioral question, and asks the interviewer two thoughtful questions.",
  },
  {
    id: "doctor",
    title: "Doctor's Appointment",
    description: "Describing symptoms, understanding instructions, follow-ups.",
    setting:
      "A general practitioner's office. The patient describes symptoms that started a week ago, answers the doctor's questions, and confirms the treatment instructions.",
  },
  {
    id: "hotel",
    title: "Hotel Problems",
    description: "Complaining politely and negotiating a solution.",
    setting:
      "A hotel front desk at 10 pm. The guest's room key stopped working, the air conditioning is broken, and they negotiate a room change or a discount.",
  },
  {
    id: "small-talk",
    title: "Workplace Small Talk",
    description: "Natural chit-chat with colleagues before a meeting.",
    setting:
      "The five minutes before a team meeting starts. Two colleagues chat about the weekend, a new restaurant, and a project deadline, using natural idioms and fillers.",
  },
];

/**
 * Build the copy-paste prompt. The schema block is the load-bearing part:
 * demanding "ONLY a single JSON object" with an exact shape is what lets
 * parseExternalResponse() work across every external model.
 */
export function buildExternalPrompt(
  scenario: Scenario,
  level: LearnerLevel,
  focus: FocusArea
): string {
  const focusInstruction: Record<FocusArea, string> = {
    grammar:
      "Weave in varied tenses, conditionals, and question forms so the learner practices grammatical range.",
    vocabulary:
      "Use rich, scenario-specific vocabulary and collocations the learner is unlikely to know yet.",
    fluency:
      "Prioritize natural rhythm: contractions, linking phrases, fillers, and idiomatic spoken English.",
  };

  return `You are an expert English-learning content generator. Create a realistic practice scenario for a ${level} learner.

SCENARIO: ${scenario.title}
SETTING: ${scenario.setting}
FOCUS: ${focusInstruction[focus]}

Respond with ONLY a single JSON object — no markdown fences, no commentary before or after — matching EXACTLY this schema:
{
  "type": "lesson",
  "title": "short scenario title",
  "dialogue": [
    {"speaker": "A", "text": "first line of the conversation"},
    {"speaker": "B", "text": "reply"}
  ],
  "practiceSentences": ["sentence 1", "sentence 2"]
}

Requirements:
- "dialogue": 8 to 12 turns, strictly alternating speakers "A" and "B", telling one coherent version of the scenario from start to resolution.
- "practiceSentences": exactly 6 standalone sentences distilled from the dialogue, each 8 to 16 words long, in natural spoken English, chosen for their shadowing value (rhythm, linking sounds, useful chunks).
- Match the difficulty to a ${level} learner throughout.
- Every string must be plain text: no quotes-within-quotes issues, no line breaks inside strings.`;
}

/** Strip markdown fences and isolate the outermost JSON object, if any. */
function isolateJson(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}

function asLessonPayload(parsed: unknown): LessonPayload | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const dialogue: DialogueTurn[] = Array.isArray(obj.dialogue)
    ? obj.dialogue
        .filter(
          (t): t is Record<string, unknown> => typeof t === "object" && t !== null
        )
        .map((t) => ({
          speaker: typeof t.speaker === "string" ? t.speaker : "?",
          text: typeof t.text === "string" ? t.text.trim() : "",
        }))
        .filter((t) => t.text.length > 0)
    : [];

  const practiceSentences: string[] = Array.isArray(obj.practiceSentences)
    ? obj.practiceSentences
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];

  if (dialogue.length === 0 && practiceSentences.length === 0) return null;

  return {
    title: typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "Imported lesson",
    dialogue,
    practiceSentences,
  };
}

/**
 * Parse whatever the user pasted. Three tiers of tolerance:
 *   1. Valid schema JSON (possibly fenced/wrapped) → full lesson.
 *   2. Any other text with sentence-like lines → those lines become practice
 *      sentences, so even a plain bullet list from an AI still "just works".
 *   3. Nothing usable → a clear, actionable error.
 */
export function parseExternalResponse(raw: string): ParseResult {
  const input = raw.trim();
  if (!input) {
    return { ok: false, error: "Paste the AI's response first — the board is empty." };
  }

  const jsonCandidate = isolateJson(input);
  if (jsonCandidate) {
    try {
      const lesson = asLessonPayload(JSON.parse(jsonCandidate));
      if (lesson) return { ok: true, lesson };
    } catch {
      // Malformed JSON — fall through to the plain-text tier.
    }
  }

  // Plain-text fallback: keep lines that look like real sentences (3+ words),
  // stripping common list decorations ("1.", "-", "•", quotes).
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^["“]|["”]$/g, "").trim())
    .filter((line) => line.split(/\s+/).length >= 3);

  if (lines.length > 0) {
    return {
      ok: true,
      lesson: { title: "Imported lines", dialogue: [], practiceSentences: lines },
    };
  }

  return {
    ok: false,
    error:
      "Couldn't find a lesson in that text. Paste the AI's full JSON reply, or at least a few full sentences (one per line).",
  };
}
