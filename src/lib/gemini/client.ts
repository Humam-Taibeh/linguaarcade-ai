/**
 * Google Gemini API client for the conversational tutor.
 *
 * Design decisions:
 *  - The key is sent via the `x-goog-api-key` header, never as a URL query
 *    parameter, so it cannot leak into browser history, proxy logs, or
 *    Referer headers.
 *  - We request `responseMimeType: "application/json"` and pin the reply to a
 *    strict schema in the system prompt, because the UI renders structured
 *    correction cards — free-form prose would be unparseable.
 *  - Everything is plain `fetch`: no SDK dependency means no supply-chain
 *    surface and no bundle bloat for a single endpoint.
 */

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export interface Correction {
  original: string;
  corrected: string;
  explanation: string;
}

export interface TutorReply {
  reply: string;
  corrections: Correction[];
  followUpQuestion: string;
}

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-2.0-flash";

/**
 * The tutor persona. Kept in one exported constant so the behavior of the AI
 * partner is reviewable and tweakable in a single place.
 */
export const TUTOR_SYSTEM_PROMPT = `You are "Lingua", a warm but rigorous English conversation tutor inside the LinguaArcade AI app. The learner practices spoken and written English with you.

Rules:
1. Always reply in natural, conversational English at a level slightly above the learner's, keeping replies to 2-4 sentences.
2. Examine the learner's message for grammar, vocabulary, and word-choice mistakes. Report every genuine mistake — do not invent mistakes when the message is correct.
3. Always end by driving the conversation forward with an engaging follow-up question (active recall: prefer questions that make the learner reuse words you corrected).
4. Respond ONLY with a single JSON object, no markdown fences, matching exactly this schema:
{"reply": "your conversational reply", "corrections": [{"original": "what they wrote", "corrected": "the fixed version", "explanation": "one short sentence on why"}], "followUpQuestion": "your next question"}
If there are no mistakes, "corrections" must be an empty array.`;

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

/**
 * Some models still wrap JSON in markdown fences despite the mime-type hint.
 * This defensively extracts the first JSON object from the raw text.
 */
function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new GeminiError("The AI reply was not valid JSON.");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

function toTutorReply(parsed: unknown): TutorReply {
  const obj = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >;
  const rawCorrections = Array.isArray(obj.corrections) ? obj.corrections : [];
  const corrections: Correction[] = rawCorrections
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({
      original: typeof c.original === "string" ? c.original : "",
      corrected: typeof c.corrected === "string" ? c.corrected : "",
      explanation: typeof c.explanation === "string" ? c.explanation : "",
    }))
    .filter((c) => c.original && c.corrected);

  return {
    reply: typeof obj.reply === "string" ? obj.reply : "Let's keep practicing!",
    corrections,
    followUpQuestion: typeof obj.followUpQuestion === "string" ? obj.followUpQuestion : "",
  };
}

/**
 * Send one turn of conversation. `history` carries prior turns so the tutor
 * has context; we cap it to the last 20 messages to bound request size while
 * keeping enough context for coherent conversation.
 */
export async function sendTutorMessage(
  apiKey: string,
  history: ChatMessage[],
  userMessage: string
): Promise<TutorReply> {
  if (!apiKey.trim()) {
    throw new GeminiError("No Gemini API key configured. Add one in Settings.");
  }

  const recentHistory = history.slice(-20);
  const body = {
    systemInstruction: { parts: [{ text: TUTOR_SYSTEM_PROMPT }] },
    contents: [
      ...recentHistory.map((message) => ({
        role: message.role,
        parts: [{ text: message.text }],
      })),
      { role: "user", parts: [{ text: userMessage }] },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
    },
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey.trim(),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new GeminiError("Network error — check your internet connection.");
  }

  if (!response.ok) {
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new GeminiError("The Gemini API rejected your key. Verify it in Settings.", response.status);
    }
    if (response.status === 429) {
      throw new GeminiError("Rate limit reached — wait a moment and try again.", response.status);
    }
    throw new GeminiError(`Gemini API error (HTTP ${response.status}).`, response.status);
  }

  const data: unknown = await response.json();
  const text = (() => {
    // Defensive descent through the candidates structure; any missing level
    // means the model returned nothing usable (e.g. a safety block).
    const d = data as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  })();

  if (!text) {
    throw new GeminiError("The AI returned an empty reply. Try rephrasing.");
  }

  return toTutorReply(extractJsonObject(text));
}
