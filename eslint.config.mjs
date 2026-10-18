import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "lib/generated/**",
    "tmp/**",
    "work/**",
    "public/question-search/ocr/**",
    "public/models/speech/vosk-worker-v0.0.8.js",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
