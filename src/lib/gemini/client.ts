/**
 * Tutor API client for LinguaArcade AI — dual-engine architecture.
 *
 * Two interchangeable backends sit behind one `sendTutorMessage` entry point:
 * - "gemini": Google Gemini cloud (generativelanguage.googleapis.com), using
 *   the learner's own API key. JSON output is enforced via responseMimeType.
 * - "ollama": a local Ollama server tunneled through ngrok, speaking the
 *   OpenAI-compatible /v1/chat/completions dialect.
 *
 * The active engine is chosen per call from the persisted Settings (global
 * state), so the Settings view can flip backends without a reload. Both paths
 * normalize into the same strictly-validated TutorReply shape, so the UI
 * (correction cards, Voice Notes loop) never knows which engine answered.
 */
import type { AiEngine } from "../../types";

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

/** Everything the client needs to route one turn, sliced from Settings. */
export interface EngineConfig {
  engine: AiEngine;
  geminiApiKey: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
}

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/** Only the last N turns are sent — enough context, minimal latency. */
const HISTORY_WINDOW = 20;
const TEMPERATURE = 0.7;
const MAX_OUTPUT_TOKENS = 512;

export const TUTOR_SYSTEM_PROMPT = `You are "Lingua" — the learner's hype English coach inside the LinguaArcade AI app. Two friends practice spoken and written English with you. Your vibe: a witty native-speaker friend in their twenties, never a boring schoolteacher.

Personality rules:
1. Sound like a real friend: warm, playful, genuinely curious, with natural modern slang where it fits (fr, ngl, tbh, bet, lowkey, "that's fire"). Sprinkle at most 1-2 slang terms per reply — season, don't flood. Celebrate real wins briefly ("ngl, that sentence was clean").
2. Keep replies to 2-4 short sentences of natural SPOKEN English — they are read aloud by text-to-speech. Never use emojis, asterisks, quotes-for-emphasis, or any formatting: TTS pronounces them out loud and ruins the flow.
3. NEVER teach grammar inside "reply". The reply is pure conversation. Every correction lives ONLY in the corrections array — the app renders those as flashcards under your message. This invisible-correction style is the heart of the product.
4. Deep analysis: catch every genuine grammar, vocabulary, word-choice, and unnatural-phrasing mistake (never invent one). Each "explanation" is one short, friendly sentence. Then casually reuse the corrected phrasing inside your reply so the learner hears it used right — that is how you correct "invisibly".
5. If the learner writes in Arabic or mixes Arabic in: do NOT scold and do NOT reply in Arabic. React to what they actually said in English, hand them the exact English phrase they were missing, and add a correction card with original = their Arabic words and corrected = the natural English version. Tease gently and pull them back — make English feel like the fun option, not homework.
6. Always end with followUpQuestion: one engaging question that pushes the conversation forward and, when possible, makes the learner reuse a word you just corrected (active recall).

Output contract (absolute, no exceptions):
Respond ONLY with a single raw JSON object — no markdown fences, no text before or after — matching exactly this schema:
{"reply": "your conversational reply", "corrections": [{"original": "what they wrote", "corrected": "the fixed version", "explanation": "one short friendly sentence on why"}], "followUpQuestion": "your next question"}
If there are no mistakes, "corrections" must be an empty array.`;

export class TutorApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null
  ) {
    super(message);
    this.name = "TutorApiError";
  }
}

// ---------------------------------------------------------------------------
// Shared response normalization
// ---------------------------------------------------------------------------

/**
 * Models occasionally disregard the JSON-only instruction and wrap the object
 * in markdown fences or prose. This defensively extracts the raw JSON block.
 */
function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new TutorApiError("The AI reply was not valid JSON. Please try rephrasing.");
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  } catch {
    throw new TutorApiError("The AI reply contained malformed JSON. Please try again.");
  }
}

/** Structurally validate the parsed reply so the UI never renders garbage. */
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
    .filter((c) => c.original.length > 0 && c.corrected.length > 0);

  return {
    reply: typeof obj.reply === "string" ? obj.reply : "Let's keep practicing!",
    corrections,
    followUpQuestion: typeof obj.followUpQuestion === "string" ? obj.followUpQuestion : "",
  };
}

// ---------------------------------------------------------------------------
// Engine: Local Ollama via ngrok (OpenAI ChatCompletions dialect)
// ---------------------------------------------------------------------------

interface OpenAiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

/**
 * Normalize a user-entered tunnel URL into a clean https origin.
 * Handles the classic mobile-input hazards: ordinary and zero-width
 * whitespace pasted from chat apps, a missing scheme, an http:// scheme
 * (which the browser silently blocks as mixed content on the https app),
 * and accidentally pasted paths like /v1/chat/completions.
 */
export function sanitizeOllamaBaseUrl(raw: string): string {
  const compact = raw.replace(/[\s\p{Cf}]/gu, "");
  if (!compact) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(compact) ? compact : `https://${compact}`;
  const upgraded = withScheme.replace(/^http:\/\//i, "https://");
  try {
    return new URL(upgraded).origin;
  } catch {
    return "";
  }
}

/** App history → OpenAI/Ollama messages array, system prompt first. */
function toOpenAiMessages(history: ChatMessage[], userMessage: string): OpenAiChatMessage[] {
  return [
    { role: "system", content: TUTOR_SYSTEM_PROMPT },
    ...history.slice(-HISTORY_WINDOW).map<OpenAiChatMessage>((msg) => ({
      role: msg.role === "model" ? "assistant" : "user",
      content: msg.text,
    })),
    { role: "user", content: userMessage },
  ];
}

async function sendViaOllama(
  config: EngineConfig,
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  const baseUrl = sanitizeOllamaBaseUrl(config.ollamaBaseUrl);
  if (!baseUrl) {
    throw new TutorApiError("The Ollama tunnel URL is missing or invalid. Fix it in Settings.");
  }

  const body = {
    model: config.ollamaModel.trim() || "llama3",
    messages: toOpenAiMessages(history, userMessage),
    temperature: TEMPERATURE,
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: "json_object" },
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      // Deliberately ONLY Content-Type. Ollama's CORS layer allows a fixed
      // list of request headers, so any custom header (including
      // "ngrok-skip-browser-warning") makes the browser's CORS preflight fail
      // before the request ever leaves the phone — which surfaced as an
      // instant "Tunnel connection failed". The ngrok interstitial is skipped
      // at the tunnel itself instead: run ngrok with
      //   --request-header-add "ngrok-skip-browser-warning: true"
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new TutorApiError(
      "The browser blocked the request before it reached the tunnel (CORS preflight or mixed content). " +
        "On the PC: quit Ollama from the tray and reopen it so OLLAMA_ORIGINS takes effect, " +
        "and start ngrok with --host-header=localhost:11434."
    );
  }

  if (!response.ok) {
    throw new TutorApiError(
      `Local Ollama server error (HTTP ${response.status}). Check the ngrok and Ollama windows on your PC.`,
      response.status
    );
  }

  const rawBody = await response.text();
  // ngrok's free tier can answer with its HTML warning page instead of
  // proxying the request. Detect it explicitly so the user gets the real
  // cause instead of a JSON parse error.
  if (rawBody.trimStart().startsWith("<")) {
    throw new TutorApiError(
      'ngrok returned its browser-warning page instead of JSON. Restart the tunnel with: ngrok http 11434 --request-header-add "ngrok-skip-browser-warning: true" ...'
    );
  }

  let data: OpenAiChatResponse;
  try {
    data = JSON.parse(rawBody) as OpenAiChatResponse;
  } catch {
    throw new TutorApiError("The tunnel returned a non-JSON response. Check the ngrok window on your PC.");
  }
  return data.choices?.[0]?.message?.content ?? "";
}

// ---------------------------------------------------------------------------
// Engine: Google Gemini cloud
// ---------------------------------------------------------------------------

interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

async function sendViaGemini(
  config: EngineConfig,
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  const apiKey = config.geminiApiKey.trim();
  if (!apiKey) {
    throw new TutorApiError("No Gemini API key is configured. Add one in Settings.");
  }

  const contents: GeminiContent[] = [
    ...history.slice(-HISTORY_WINDOW).map<GeminiContent>((msg) => ({
      role: msg.role,
      parts: [{ text: msg.text }],
    })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  const body = {
    systemInstruction: { parts: [{ text: TUTOR_SYSTEM_PROMPT }] },
    contents,
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // Forces Gemini to emit pure JSON — no markdown fences to strip.
      responseMimeType: "application/json",
    },
  };

  let response: Response;
  try {
    response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new TutorApiError("Could not reach the Gemini API — check your internet connection.");
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new TutorApiError(
      "Gemini rejected the API key. Verify it in Settings (aistudio.google.com).",
      response.status
    );
  }
  if (response.status === 429) {
    throw new TutorApiError(
      "Gemini free-tier rate limit reached. Wait a minute, or switch to Local Ollama in Settings.",
      response.status
    );
  }
  if (!response.ok) {
    throw new TutorApiError(`Gemini API error (HTTP ${response.status}).`, response.status);
  }

  const data = (await response.json()) as GeminiResponse;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Send one conversation turn through whichever engine the user selected in
 * Settings. Both engines return the same validated TutorReply, so callers
 * (including the Voice Notes loop) are engine-agnostic.
 */
export async function sendTutorMessage(
  config: EngineConfig,
  history: ChatMessage[],
  userMessage: string
): Promise<TutorReply> {
  const rawText =
    config.engine === "gemini"
      ? await sendViaGemini(config, history, userMessage)
      : await sendViaOllama(config, history, userMessage);

  if (!rawText) {
    throw new TutorApiError("The AI returned an empty response. Please try sending again.");
  }

  return toTutorReply(extractJsonObject(rawText));
}
