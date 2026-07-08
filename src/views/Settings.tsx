/**
 * Settings — AI engine selection (Gemini cloud vs. local Ollama), API key and
 * tunnel management, voice tuning, scorer strictness, and the (guarded)
 * progress reset.
 *
 * Security posture for the API key: it lives exclusively in this browser's
 * LocalStorage, is rendered as a password field, and is transmitted only to
 * Google's Gemini endpoint over HTTPS via a request header. It never touches
 * any server owned by this project — there isn't one.
 */
import { useEffect, useState } from "react";
import { useAppState } from "../state/AppStateContext";
import { getEnglishVoices, speak } from "../lib/speech/synthesis";
import { sanitizeOllamaBaseUrl } from "../lib/gemini/client";
import type { AiEngine, Strictness } from "../types";

export function SettingsView() {
  const { state, dispatch } = useAppState();
  const { settings } = state;

  const [keyDraft, setKeyDraft] = useState(settings.geminiApiKey);
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [ollamaUrlDraft, setOllamaUrlDraft] = useState(settings.ollamaBaseUrl);
  const [ollamaModelDraft, setOllamaModelDraft] = useState(settings.ollamaModel);
  const [ollamaSaved, setOllamaSaved] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getEnglishVoices().then((list) => {
      if (!cancelled) setVoices(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveKey = () => {
    dispatch({ type: "UPDATE_SETTINGS", settings: { geminiApiKey: keyDraft.trim() } });
    setKeySaved(true);
    window.setTimeout(() => setKeySaved(false), 2500);
  };

  const handleSaveOllama = () => {
    // Same sanitizer the client uses at send time: strips invisible
    // characters, forces https, and reduces the value to a bare origin.
    // Reflecting it back into the draft shows the user exactly what saved.
    const cleanedUrl = sanitizeOllamaBaseUrl(ollamaUrlDraft);
    setOllamaUrlDraft(cleanedUrl);
    dispatch({
      type: "UPDATE_SETTINGS",
      settings: {
        ollamaBaseUrl: cleanedUrl,
        ollamaModel: ollamaModelDraft.trim() || "llama3",
      },
    });
    setOllamaSaved(true);
    window.setTimeout(() => setOllamaSaved(false), 2500);
  };

  const handleEngineChange = (engine: AiEngine) => {
    dispatch({ type: "UPDATE_SETTINGS", settings: { aiEngine: engine } });
  };

  const handlePreviewVoice = () => {
    void speak("This is how your practice sentences will sound.", {
      voiceURI: settings.voiceURI || undefined,
      rate: settings.speechRate,
    });
  };

  const handleReset = () => {
    // A destructive, irreversible action gets an explicit confirm dialog.
    const confirmed = window.confirm(
      "Reset ALL progress? XP, streaks, session history, and saved sentences will be permanently deleted. Your settings (including the API key) are kept."
    );
    if (confirmed) {
      dispatch({ type: "RESET_ALL" });
    }
  };

  return (
    <div className="fade-in">
      <h1 className="view-header">Settings</h1>
      <p className="view-subtitle">Tune your AI partner, voice, and scoring strictness.</p>

      <div className="stack">
        <div className="glass">
          <h2 className="card-title">🧠 AI engine</h2>
          <div className="field" style={{ marginBottom: 0 }}>
            <div className="row" role="radiogroup" aria-label="AI engine">
              <button
                type="button"
                className={`btn ${settings.aiEngine === "gemini" ? "btn-primary" : "btn-ghost"}`}
                aria-pressed={settings.aiEngine === "gemini"}
                onClick={() => handleEngineChange("gemini")}
              >
                ☁️ Gemini Cloud
              </button>
              <button
                type="button"
                className={`btn ${settings.aiEngine === "ollama" ? "btn-primary" : "btn-ghost"}`}
                aria-pressed={settings.aiEngine === "ollama"}
                onClick={() => handleEngineChange("ollama")}
              >
                🖥️ Local Ollama
              </button>
            </div>
            <span className="hint">
              {settings.aiEngine === "gemini"
                ? "Conversations go to Google's Gemini API using your key below. Works anywhere, no PC required."
                : "Conversations go to Ollama on your PC through the ngrok tunnel below. Your PC, Ollama, and ngrok must be running."}
            </span>
          </div>
        </div>

        <div className="glass">
          <h2 className="card-title">🤖 Gemini API key</h2>
          <div className="field">
            <label htmlFor="gemini-key">API key</label>
            <div className="row">
              <input
                id="gemini-key"
                className="input"
                style={{ flex: 1, minWidth: 220 }}
                type={showKey ? "text" : "password"}
                placeholder="AIza…"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? "Hide" : "Show"}
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSaveKey}>
                {keySaved ? "Saved ✓" : "Save key"}
              </button>
            </div>
            <span className="hint">
              Get a free key at aistudio.google.com. Stored only in this browser's
              LocalStorage; sent only to Google's API. Never commit it anywhere.
            </span>
          </div>
        </div>

        <div className="glass">
          <h2 className="card-title">🖥️ Local Ollama tunnel</h2>
          <div className="field">
            <label htmlFor="ollama-url">ngrok tunnel URL</label>
            <input
              id="ollama-url"
              className="input"
              type="url"
              placeholder="https://your-domain.ngrok-free.dev"
              value={ollamaUrlDraft}
              onChange={(e) => setOllamaUrlDraft(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="hint">
              The static domain from your ngrok dashboard — origin only, no /v1 path.
            </span>
          </div>
          <div className="field">
            <label htmlFor="ollama-model">Model</label>
            <div className="row">
              <input
                id="ollama-model"
                className="input"
                style={{ flex: 1, minWidth: 160 }}
                type="text"
                placeholder="llama3"
                value={ollamaModelDraft}
                onChange={(e) => setOllamaModelDraft(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="btn btn-primary" onClick={handleSaveOllama}>
                {ollamaSaved ? "Saved ✓" : "Save tunnel"}
              </button>
            </div>
            <span className="hint">
              Must match a model pulled on your PC (run "ollama list" to check).
            </span>
          </div>
        </div>

        <div className="glass">
          <h2 className="card-title">🔊 Voice &amp; playback</h2>

          <div className="field">
            <label htmlFor="voice-select">Practice voice</label>
            <div className="row">
              <select
                id="voice-select"
                className="select"
                style={{ flex: 1, minWidth: 220 }}
                value={settings.voiceURI}
                onChange={(e) =>
                  dispatch({ type: "UPDATE_SETTINGS", settings: { voiceURI: e.target.value } })
                }
              >
                <option value="">Browser default (English)</option>
                {voices.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} ({voice.lang})
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost" onClick={handlePreviewVoice}>
                ▶ Preview
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="rate-slider">
              Speaking rate: {settings.speechRate.toFixed(2)}×
            </label>
            <input
              id="rate-slider"
              className="slider"
              type="range"
              min={0.6}
              max={1.3}
              step={0.05}
              value={settings.speechRate}
              onChange={(e) =>
                dispatch({
                  type: "UPDATE_SETTINGS",
                  settings: { speechRate: Number(e.target.value) },
                })
              }
            />
            <span className="hint">
              0.8–0.9× is the sweet spot for shadowing; raise it as you improve.
            </span>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label>
              <input
                type="checkbox"
                checked={settings.soundEffects}
                onChange={(e) =>
                  dispatch({
                    type: "UPDATE_SETTINGS",
                    settings: { soundEffects: e.target.checked },
                  })
                }
                style={{ marginRight: 8, accentColor: "var(--accent)" }}
              />
              Achievement &amp; feedback chimes
            </label>
          </div>
        </div>

        <div className="glass">
          <h2 className="card-title">🎯 Scoring strictness</h2>
          <div className="field" style={{ marginBottom: 0 }}>
            <select
              className="select"
              style={{ maxWidth: 320 }}
              value={settings.strictness}
              onChange={(e) =>
                dispatch({
                  type: "UPDATE_SETTINGS",
                  settings: { strictness: e.target.value as Strictness },
                })
              }
              aria-label="Scoring strictness"
            >
              <option value="standard">Standard — forgiving of tiny slips</option>
              <option value="strict">Strict — near-exact matches only</option>
            </select>
            <span className="hint">
              Strict mode raises the similarity thresholds the pronunciation analyst uses to
              mark a word green.
            </span>
          </div>
        </div>

        <div className="glass" style={{ borderColor: "rgba(255, 93, 115, 0.35)" }}>
          <h2 className="card-title" style={{ color: "var(--danger)" }}>
            ⚠️ Danger zone
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem", marginTop: 0 }}>
            Wipes XP, streaks, history, and your sentence library. Settings survive.
          </p>
          <button type="button" className="btn btn-danger" onClick={handleReset}>
            Reset all progress
          </button>
        </div>
      </div>
    </div>
  );
}
