import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Sourcemaps stay ON in production builds intentionally: this is a personal
// learning tool, and being able to debug the deployed bundle beats the
// (irrelevant here) source-obfuscation concern.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    outDir: "dist",
  },
});
