# 🕹️ LinguaArcade AI

**An immersive, gamified English-learning platform built around advanced shadowing practice, ultra-precise AI pronunciation analysis, and a live conversational AI partner — running 100% in your browser.**

LinguaArcade AI is a fully static, serverless single-page application. Your progress, your custom training sentences, and your Gemini API key never leave your machine: everything is stored in browser LocalStorage, and the only network calls are the ones *you* enable to Google's Gemini API.

---

## ✨ Features

| Feature | What it does |
| --- | --- |
| 🎙️ **Shadowing Studio** | Listen to native-quality TTS phrasing, record your imitation, and get instant word-by-word feedback: **green** = accurate, **amber** = close, **red** = mispronounced, dashed = missing — plus an explicit accuracy percentage. |
| 🧠 **Pronunciation Analyst** | A dynamic-programming word aligner (Needleman–Wunsch style) with character-level similarity scoring, digit/word equivalences, and a configurable strictness mode that demands near-exact matches. |
| 💬 **AI Conversation** | Plug in your own Gemini API key and chat with "Lingua", a tutor persona that replies naturally, reports every grammar mistake as a structured correction card, and drives the conversation with active-recall questions. |
| 📝 **My Sentences** | Paste your own scripts, movie lines, or work phrases — every line becomes a trackable shadowing exercise with per-sentence best-score history. |
| 🏆 **Gamified Fluency Engine** | Daily streaks, quadratic XP/level curve, achievements, and procedurally synthesized Web Audio chimes for milestones. |
| 🌌 **Premium Dark UI** | Glassmorphism surfaces, aurora background glows, glowing micro-interactions, and a fully responsive layout — with zero external fonts, images, or CDNs. |

---

## 🧰 Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | ≥ 20 | Required for development and building only |
| npm | ≥ 10 | Ships with Node 20 |
| Browser | Chrome or Edge (latest) | The Web Speech **recognition** API is Chromium-only; TTS works everywhere |
| Microphone | Any | Required for shadowing & dictation |
| [Gemini API key](https://aistudio.google.com) | Free tier works | Optional — only needed for the AI Conversation module |

> **Note:** browsers only expose the microphone in a *secure context* — `http://localhost` or any HTTPS origin.

---

## 🚀 Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/linguaarcade-ai.git
cd linguaarcade-ai

# 2. Install dependencies (reproducible, honors the lockfile)
npm ci

# 3. Start the dev server
npm run dev
# → open http://localhost:5173
```

### Production build

```bash
npm run build     # lint-strict typecheck + optimized bundle in dist/
npm run preview   # serve the production bundle locally
```

### Quality gates

```bash
npm run lint       # ESLint (flat config, TS-aware)
npm run typecheck  # tsc --strict, app + tooling configs
```

---

## 🔑 Activating the AI Conversation partner

1. Create a free API key at [Google AI Studio](https://aistudio.google.com).
2. In the app, open **Settings → Gemini API key**, paste it, and click **Save key**.
3. Open **AI Conversation** and start talking.

The key is stored **only** in your browser's LocalStorage and transmitted **only** to `generativelanguage.googleapis.com` via an HTTPS request header. Never commit an API key to this or any repository.

---

## 🏗️ Architecture

```
linguaarcade-ai/
├── .github/
│   └── workflows/
│       └── ci.yml                  # Lint + typecheck + build CI pipeline
├── src/
│   ├── components/                 # Reusable presentational components
│   │   ├── ScoreRing.tsx           #   Animated SVG accuracy gauge
│   │   ├── Sidebar.tsx             #   Navigation + live level/streak summary
│   │   └── WordDiff.tsx            #   Green/amber/red word-level feedback chips
│   ├── data/
│   │   └── lessons.ts              # Built-in shadowing curriculum (4 categories)
│   ├── lib/
│   │   ├── audio/
│   │   │   └── chimes.ts           # Procedural Web Audio chimes (no audio files)
│   │   ├── gemini/
│   │   │   └── client.ts           # Zero-dependency Gemini API client + tutor persona
│   │   ├── speech/
│   │   │   ├── recognition.ts      # Typed SpeechRecognition wrapper (streaming)
│   │   │   ├── scorer.ts           # DP word alignment + similarity scoring engine
│   │   │   └── synthesis.ts        # TTS with async voice loading
│   │   └── storage.ts              # Versioned LocalStorage persistence
│   ├── state/
│   │   └── AppStateContext.tsx     # Reducer: XP/levels/streaks/sentences/settings
│   ├── styles/
│   │   └── global.css              # Design tokens + glassmorphism system
│   ├── types/
│   │   └── index.ts                # Shared domain types (persisted schema)
│   ├── views/
│   │   ├── Conversation.tsx        # AI partner chat with correction cards
│   │   ├── Dashboard.tsx           # Stats, history, achievements
│   │   ├── MySentences.tsx         # Custom training-material library
│   │   ├── Settings.tsx            # API key, voice, strictness, reset
│   │   └── ShadowingStudio.tsx     # Listen → shadow → score core loop
│   ├── App.tsx                     # View routing + cross-view practice hand-off
│   └── main.tsx                    # Entry point (global ErrorBoundary lives here)
├── index.html
├── package.json
├── tsconfig.json / tsconfig.node.json
├── vite.config.ts
├── eslint.config.js
├── .editorconfig / .gitattributes / .gitignore
└── LICENSE                         # MIT
```

### Key engineering decisions

- **Serverless by design.** Every feature (speech recognition, TTS, scoring, chimes, persistence) uses native browser APIs. The Gemini call is the app's only network dependency, made directly from the browser with the *user's own* key — so there is no backend to secure, pay for, or leak data through.
- **Pronunciation scoring via transcript alignment.** The Web Speech API returns recognized text, not phonemes. Because the recognizer is trained on native speech, mispronounced words come back as *different*, mangled, or missing words — so a strict dynamic-programming alignment between target and transcript is a robust mispronunciation detector (see `src/lib/speech/scorer.ts` for the full algorithm).
- **Context + reducer over a state library.** The whole persisted state is one small, serializable document with well-defined transitions — a reducer gives auditability and LocalStorage persistence with zero dependencies.
- **Two runtime dependencies total** (`react`, `react-dom`). Minimal supply-chain surface, instant installs, tiny bundle.

---

## 🧪 How shadowing practice works

1. **Listen** — the target sentence is spoken with your chosen voice and rate (0.8–0.9× recommended).
2. **Shadow** — hit *Shadow It* and imitate the phrasing immediately; your live transcript streams on screen.
3. **Score** — stop (or pause naturally) and get the word-by-word verdict, accuracy percentage, and XP.
4. **Iterate** — retry for the 95%+ *perfect take* bonus, then move to the next sentence.

---

## 📄 License

Released under the [MIT License](LICENSE).
