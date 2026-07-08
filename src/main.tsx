/**
 * Application entry point. StrictMode stays on permanently: its double-invoke
 * behavior in development surfaces effect-cleanup bugs early, which matters in
 * an app juggling microphone sessions and speech synthesis lifecycles.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/global.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found — index.html is malformed.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
