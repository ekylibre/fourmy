import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Configuration ESLint partagée (flat config).
 * Règle de frontière (architecture §3) : `packages/domain` ne doit importer
 * ni la base ni le réseau — il reste testable en isolation.
 */
export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["packages/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "postgres", message: "domain ne doit pas toucher la base." },
            { name: "drizzle-orm", message: "domain ne doit pas toucher la base." },
            { name: "hono", message: "domain ne doit pas toucher le réseau." },
          ],
          patterns: ["@fourmy/db", "**/client.js"],
        },
      ],
    },
  },
  {
    // Interface React : règles des hooks (dépendances d'effets, appels conditionnels).
    files: ["apps/web/**/*.{ts,tsx}", "packages/ui-lyvre/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["**/*.test.ts", "**/test/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
