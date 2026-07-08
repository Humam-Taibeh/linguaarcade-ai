/**
 * Local Ollama API client via ngrok tunnel for LinguaArcade AI.
 *
 * Design decisions:
 * - Fully detached from Google Gemini cloud infrastructure to eliminate quota limits.
 * - Routes all conversation turns to the local Ollama instance running on the home GPU.
 * - Normalizes the Gemini history payload into standard ChatCompletion messages array
 *   safely readable by llama3 or any open-source local model.
 * - Adheres strictly to strict-mode type-safety rules to pass CI production validation pipelines.
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

// Strictly typed constant endpoint for local ngrok environment mapping
const API_BASE = "https://handwrite-oboe-cozy.ngrok-free.dev/v1/chat/completions";
const MODEL = "llama3";

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
 * Open-source local models frequently disregard the JSON mime-type instructions
 * and wrap the block inside markdown fences. This extracts the clean raw JSON block object defensively.
 */
function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new GeminiError("The local AI model reply was not valid JSON. Please try rephrasing.");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

function toTutorReply(parsed: unknown): TutorReply {
  const obj = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
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
 * Structurally validate the response from Ollama/OpenAI ChatCompletions endpoint
 */
interface OllamaResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

/**
 * Send one turn of conversation directly down the ngrok tunnel to the local home GPU.
 * Formats data structure cleanly for OpenAI/Ollama ChatCompletion parameters.
 */
export async function sendTutorMessage(
  apiKey: string,
  history: ChatMessage[],
  userMessage: string
): Promise<TutorReply> {
  const recentHistory = history.slice(-20);
  
  // Transform existing application history states to standard OpenAI schemas
  const messagesPayload = [
    { role: "system", content: TUTOR_SYSTEM_PROMPT },
    ...recentHistory.map((msg) => ({
      role: msg.role === "model" ? "assistant" : "user",
      content: msg.text,
    })),
    { role: "user", content: userMessage }
  ];

  const body = {
    model: MODEL,
    messages: messagesPayload,
    temperature: 0.7,
    max_tokens: 1024,
    response_format: { type: "json_object" }
  };

  let response: Response;
  try {
    // Standardizing apiKey usage to pass unused-parameter checks in strict environments
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey.trim()) {
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    }

    response = await fetch(API_BASE, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new GeminiError("Tunnel connection failed — ensure your local ngrok instance is active and running.");
  }

  if (!response.ok) {
    throw new GeminiError(`Local Server Error (HTTP Status: ${response.status}).`, response.status);
  }

  const data = (await response.json()) as OllamaResponse;
  const text = data.choices?.[0]?.message?.content ?? "";

  if (!text) {
    throw new GeminiError("The local AI returned an empty response block. Please try sending again.");
  }

  return toTutorReply(extractJsonObject(text));
}