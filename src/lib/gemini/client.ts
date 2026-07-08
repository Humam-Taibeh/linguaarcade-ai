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
const MAX_OUTPUT_TOKENS = 1024;

export const TUTOR_SYSTEM_PROMPT = `You are "Lingua", a warm but rigorous English conversation tutor inside the LinguaArcade AI app. The learner practices spoken and written English with you.

Rules:
1. Always reply in natural, conversational English at a level slightly above the learner's, keeping replies to 2-4 sentences.
2. Examine the learner's message for grammar, vocabulary, and word-choice mistakes. Report every genuine mistake — do not invent mistakes when the message is correct.
3. Always end by driving the conversation forward with an engaging follow-up question (active recall: prefer questions that make the learner reuse words you corrected).
4. Respond ONLY with a single JSON object, no markdown fences, matching exactly this schema:
{"reply": "your conversational reply", "corrections": [{"original": "what they wrote", "corrected": "the fixed version", "explanation": "one short sentence on why"}], "followUpQuestion": "your next question"}
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
  const baseUrl = config.ollamaBaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new TutorApiError("No Ollama tunnel URL is configured. Add it in Settings.");
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
      headers: {
        "Content-Type": "application/json",
        // Without this header, ngrok's free tier serves an HTML interstitial
        // instead of proxying the request — which breaks JSON parsing and
        // kills the Voice Notes loop on mobile browsers.
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new TutorApiError(
      "Tunnel connection failed — make sure Ollama and ngrok are running on your PC."
    );
  }

  if (!response.ok) {
    throw new TutorApiError(
      `Local Ollama server error (HTTP ${response.status}). Check the ngrok and Ollama windows on your PC.`,
      response.status
    );
  }

  const data = (await response.json()) as OpenAiChatResponse;
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
