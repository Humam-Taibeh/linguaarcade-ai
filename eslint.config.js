// Flat ESLint config (ESLint 9+). Kept deliberately lean: the TypeScript
// compiler in strict mode already catches most correctness issues, so ESLint
// focuses on the recommended rule sets rather than a wall of style rules.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["vite.config.ts", "eslint.config.js"],
    languageOptions: {
      globals: globals.node,
    },
  }
);
