/**
 * Tutor API client for LinguaArcade AI — multi-engine, self-healing.
 *
 * Three interchangeable backends sit behind one entry point:
 * - "groq": Groq cloud (api.groq.com, OpenAI-compatible, very fast).
 * - "gemini": Google Gemini cloud (generativelanguage.googleapis.com).
 * - "ollama": a local Ollama server tunneled through ngrok.
 *
 * Redundancy: the user's preferred engine is tried first; if it fails for ANY
 * reason (network, quota, dead tunnel, malformed reply) the client silently
 * fails over to the other *configured* engines before surfacing an error.
 * All paths normalize into the same strictly-validated TutorReply shape, so
 * the UI (correction cards, Voice Notes loop) never knows which engine
 * answered. The same machinery powers both the free Conversation tutor and
 * the Scenario Studio roleplay via different system prompts.
 */
import type { AiEngine, Settings } from "../../types";

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
  groqApiKey: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
}

/** One place to slice Settings → EngineConfig, shared by every view. */
export function engineConfigFromSettings(settings: Settings): EngineConfig {
  return {
    engine: settings.aiEngine,
    geminiApiKey: settings.geminiApiKey,
    groqApiKey: settings.groqApiKey,
    ollamaBaseUrl: settings.ollamaBaseUrl,
    ollamaModel: settings.ollamaModel,
  };
}

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/** Only the last N turns are sent — enough context, minimal latency. */
const HISTORY_WINDOW = 10;
const TEMPERATURE = 0.7;
const MAX_OUTPUT_TOKENS = 512;

export const TUTOR_SYSTEM_PROMPT = `You are "Lingua" — the learner's hype English coach inside the LinguaArcade AI app. Two friends practice spoken and written English with you. Your vibe: a witty native-speaker friend in their twenties, never a boring schoolteacher.

Personality rules:
1. Sound like a real friend, never a formal teacher: warm, playful, genuinely curious, cracks a light joke when the moment invites it, with natural modern slang where it fits (fr, ngl, tbh, bet, lowkey, "that's fire"). Sprinkle at most 1-2 slang terms per reply — season, don't flood. Celebrate real wins briefly ("ngl, that sentence was clean").
2. Keep replies to 2-4 short sentences of natural SPOKEN English — they are read aloud by text-to-speech. Never use emojis, asterisks, quotes-for-emphasis, or any formatting: TTS pronounces them out loud and ruins the flow.
3. NEVER teach grammar inside "reply". The reply is pure conversation. Every correction lives ONLY in the corrections array — the app renders those as flashcards under your message. This invisible-correction style is the heart of the product.
4. Deep analysis: catch every genuine grammar, vocabulary, word-choice, and unnatural-phrasing mistake (never invent one). Each "explanation" is one short, friendly sentence. Then casually reuse the corrected phrasing inside your reply so the learner hears it used right — that is how you correct "invisibly".
5. Polyglot buddy rule — you code-switch like a bilingual friend, three cases:
   a) The learner writes mostly in Arabic: reply the way a bilingual friend would — a short, warm Arabic reply naturally woven with English phrases and slang — then steer your follow-up question back into English. ALWAYS add correction card(s) with original = their Arabic sentence and corrected = the natural English version, so they collect the English they needed.
   b) The learner explicitly asks for help in Arabic ("شو معنى..." / "كيف أقول..." / "ما فهمت"): be respectful, not evasive. Answer clearly (Arabic is fine), hand them the English version, and pivot the very next sentence seamlessly back into English. Never lecture them for asking.
   c) The learner drops one or two Arabic words into an English message: react in English to what they meant, feed them the missing phrase, and add the Arabic → English correction card. Tease gently — make English feel like the fun option, not homework.
6. Always end with followUpQuestion: one engaging question that pushes the conversation forward and, when possible, makes the learner reuse a word you just corrected (active recall).

Output contract (absolute, no exceptions):
Respond ONLY with a single raw JSON object — no markdown fences, no text before or after — matching exactly this schema:
{"reply": "your conversational reply", "corrections": [{"original": "what they wrote", "corrected": "the fixed version", "explanation": "one short friendly sentence on why"}], "followUpQuestion": "your next question"}
If there are no mistakes, "corrections" must be an empty array.`;

/**
 * Scenario Studio: Lingua plays Person A in a user-chosen scene while the
 * learner improvises Person B. Same JSON contract as the tutor, so the whole
 * chat UI (bubbles, correction cards, TTS) is reused unchanged.
 */
export function buildScenarioPrompt(scenario: string): string {
  return `You are "Lingua" inside the LinguaArcade AI app, running Scenario Studio: immersive roleplay where the learner practices real-life spoken English.

Scenario: "${scenario}"
You play Person A — whichever character naturally drives this scene (the interviewer, the waiter, the border officer...). The learner improvises Person B.

Rules:
1. Your FIRST message only: set the scene in one short sentence (where we are, who you are), then deliver Person A's natural opening line.
2. Every turn after that: stay fully in character. Natural spoken English, 1-3 short sentences, and always end your turn with a line that invites the learner's response. No emojis or formatting — your lines are read aloud by text-to-speech.
3. Keep the invisible-correction discipline: never teach grammar inside "reply". Report every genuine mistake in the corrections array (original / corrected / explanation, one friendly sentence), then quietly reuse the corrected phrasing in a later line.
4. If the learner is stuck or answers in Arabic, keep the scene moving: react in character and feed them the English line they needed through a correction card.
5. "followUpQuestion" must be an empty string — your in-character line already carries the hook.

Output contract (absolute, no exceptions):
Respond ONLY with a single raw JSON object — no markdown fences, no text before or after — matching exactly:
{"reply": "your in-character line", "corrections": [{"original": "...", "corrected": "...", "explanation": "..."}], "followUpQuestion": ""}
If there are no mistakes, "corrections" must be an empty array.`;
}

/** Fun, conversational scene ideas for the Random Scenario button. */
export const RANDOM_SCENARIOS: readonly string[] = [
  "At the airport check-in desk with an overweight suitcase",
  "Job interview for your dream role",
  "Ordering at a fancy restaurant where everything is sold out",
  "Haggling with a street market vendor",
  "Doctor's appointment for a mysterious ache",
  "You just met your favorite celebrity in an elevator",
  "Lost in a new city, asking a local for directions",
  "Coffee chat with a new coworker on your first day",
  "Returning a broken product without the receipt",
  "Planning a road trip with a friend on a tiny budget",
  "Hotel check-in, but they lost your reservation",
  "First session at the gym with an over-enthusiastic trainer",
  "Calling tech support about wifi that only works in one corner",
  "House-hunting with a very optimistic real estate agent",
  "Small talk at a wedding where you know nobody",
  "Convincing a friend to watch your favorite show",
];

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

/** App history → OpenAI-dialect messages array, system prompt first. */
function toOpenAiMessages(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string
): OpenAiChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...history.slice(-HISTORY_WINDOW).map<OpenAiChatMessage>((msg) => ({
      role: msg.role === "model" ? "assistant" : "user",
      content: msg.text,
    })),
    { role: "user", content: userMessage },
  ];
}

// ---------------------------------------------------------------------------
// Engine: Groq cloud (OpenAI ChatCompletions dialect)
// ---------------------------------------------------------------------------

async function sendViaGroq(
  config: EngineConfig,
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  const apiKey = config.groqApiKey.trim();
  if (!apiKey) {
    throw new TutorApiError("No Groq API key is configured. Add one in Settings.");
  }

  const body = {
    model: GROQ_MODEL,
    messages: toOpenAiMessages(systemPrompt, history, userMessage),
    temperature: TEMPERATURE,
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: "json_object" },
  };

  let response: Response;
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new TutorApiError("Could not reach the Groq API — check your internet connection.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new TutorApiError(
      "Groq rejected the API key. Verify it in Settings (console.groq.com).",
      response.status
    );
  }
  if (response.status === 429) {
    throw new TutorApiError("Groq rate limit reached — falling back shortly.", response.status);
  }
  if (!response.ok) {
    throw new TutorApiError(`Groq API error (HTTP ${response.status}).`, response.status);
  }

  const data = (await response.json()) as OpenAiChatResponse;
  return data.choices?.[0]?.message?.content ?? "";
}

async function sendViaOllama(
  config: EngineConfig,
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  const baseUrl = sanitizeOllamaBaseUrl(config.ollamaBaseUrl);
  if (!baseUrl) {
    throw new TutorApiError("The Ollama tunnel URL is missing or invalid. Fix it in Settings.");
  }

  const body = {
    model: config.ollamaModel.trim() || "llama3",
    messages: toOpenAiMessages(systemPrompt, history, userMessage),
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
  systemPrompt: string,
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
    systemInstruction: { parts: [{ text: systemPrompt }] },
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
// Public entry point — unified wrapper with automatic failover
// ---------------------------------------------------------------------------

/** Fallback priority when the preferred engine fails: fast cloud → cloud → local. */
const FAILOVER_ORDER: readonly AiEngine[] = ["groq", "gemini", "ollama"];

/** True when the engine has the credentials/URL it needs to be attempted. */
export function isEngineConfigured(engine: AiEngine, config: EngineConfig): boolean {
  switch (engine) {
    case "groq":
      return config.groqApiKey.trim().length > 0;
    case "gemini":
      return config.geminiApiKey.trim().length > 0;
    case "ollama":
      return sanitizeOllamaBaseUrl(config.ollamaBaseUrl).length > 0;
  }
}

/** True when at least one engine can be attempted (chat UIs gate on this). */
export function hasConfiguredEngine(config: EngineConfig): boolean {
  return FAILOVER_ORDER.some((engine) => isEngineConfigured(engine, config));
}

function sendViaEngine(
  engine: AiEngine,
  config: EngineConfig,
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  switch (engine) {
    case "groq":
      return sendViaGroq(config, systemPrompt, history, userMessage);
    case "gemini":
      return sendViaGemini(config, systemPrompt, history, userMessage);
    case "ollama":
      return sendViaOllama(config, systemPrompt, history, userMessage);
  }
}

/**
 * The redundancy core: try the preferred engine, then silently fail over to
 * every other configured engine. A malformed/empty reply counts as a failure
 * too, so a rambling local model can be rescued by a cloud engine mid-chat.
 * Only when the whole chain is exhausted does the last error reach the UI.
 */
async function requestReply(
  config: EngineConfig,
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string
): Promise<TutorReply> {
  const chain = [
    config.engine,
    ...FAILOVER_ORDER.filter((engine) => engine !== config.engine),
  ].filter((engine) => isEngineConfigured(engine, config));

  if (chain.length === 0) {
    throw new TutorApiError(
      "No AI engine is configured yet. Add a Groq or Gemini key (or the Ollama tunnel URL) in Settings."
    );
  }

  let lastError: TutorApiError | null = null;
  for (const engine of chain) {
    try {
      const rawText = await sendViaEngine(engine, config, systemPrompt, history, userMessage);
      if (!rawText) {
        throw new TutorApiError("The AI returned an empty response.");
      }
      return toTutorReply(extractJsonObject(rawText));
    } catch (err) {
      lastError =
        err instanceof TutorApiError ? err : new TutorApiError("Unexpected engine failure.");
    }
  }
  throw lastError ?? new TutorApiError("All AI engines failed. Please try again.");
}

/** One turn with the free-talk tutor persona (Conversation view). */
export function sendTutorMessage(
  config: EngineConfig,
  history: ChatMessage[],
  userMessage: string
): Promise<TutorReply> {
  return requestReply(config, TUTOR_SYSTEM_PROMPT, history, userMessage);
}

/** One turn of Scenario Studio roleplay, with Lingua as Person A. */
export function sendScenarioMessage(
  config: EngineConfig,
  scenario: string,
  history: ChatMessage[],
  userMessage: string
): Promise<TutorReply> {
  return requestReply(config, buildScenarioPrompt(scenario), history, userMessage);
}
