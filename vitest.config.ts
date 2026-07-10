// Test runner config. Environment is plain Node — the test surface is the pure
// layer (engines, graders, SRS math, schema validators), which is DOM-free by
// architectural rule (docs/ARCHITECTURE.md §2). Needing jsdom here would be a
// signal that logic has leaked into a view.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
