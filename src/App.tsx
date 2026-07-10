/**
 * Root component: owns navigation state and the cross-view "practice this
 * sentence" hand-off (My Sentences → Shadowing Studio).
 *
 * Navigation is plain component state rather than a router: the app is a
 * single-screen tool with six panels and no need for deep links, so a router
 * dependency would be pure overhead.
 */
import { useCallback, useState } from "react";
import { AppStateProvider } from "./state/AppStateContext";
import { Sidebar } from "./components/Sidebar";
import { UtilityRail } from "./components/UtilityRail";
import { Dashboard } from "./views/Dashboard";
import { LessonFlow } from "./views/LessonFlow";
import { ShadowingStudio } from "./views/ShadowingStudio";
import { ReviewStudio } from "./views/ReviewStudio";
import { Conversation } from "./views/Conversation";
import { ScenarioStudio } from "./views/ScenarioStudio";
import { MySentences } from "./views/MySentences";
import { SettingsView } from "./views/Settings";
import type { View } from "./types";

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  // When set, the Shadowing Studio opens preloaded with this custom sentence.
  // It is keyed by content+time so practicing the same sentence twice in a row
  // still re-triggers the studio's initialization effect.
  const [practiceRequest, setPracticeRequest] = useState<{
    sentenceId: string;
    text: string;
    requestedAt: number;
  } | null>(null);

  const handlePracticeSentence = useCallback((sentenceId: string, text: string) => {
    setPracticeRequest({ sentenceId, text, requestedAt: Date.now() });
    setView("shadowing");
  }, []);

  return (
    <AppStateProvider>
      <div className="app-shell">
        <Sidebar activeView={view} onNavigate={setView} />
        <main className="main-content">
          {view === "dashboard" && <Dashboard onNavigate={setView} />}
          {view === "lessons" && <LessonFlow />}
          {view === "shadowing" && <ShadowingStudio practiceRequest={practiceRequest} />}
          {view === "review" && <ReviewStudio />}
          {view === "conversation" && <Conversation onNavigate={setView} />}
          {view === "scenario" && <ScenarioStudio onNavigate={setView} />}
          {view === "sentences" && <MySentences onPractice={handlePracticeSentence} />}
          {view === "settings" && <SettingsView />}
        </main>
        <UtilityRail />
      </div>
    </AppStateProvider>
  );
}
