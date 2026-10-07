import { config } from "@repo/eslint-config/react-internal";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    files: [
      "src/main/**/*.{ts,tsx}",
      "src/preload/**/*.{ts,tsx}",
      "scripts/**/*.{js,mjs}",
      "electron.vite.config.ts",
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // These files are type-checked by `tsc -p tsconfig.node.json`; the flat
      // config's babel parser can't see TS type-position usage here, so the
      // core rules misfire on interface members and type-only imports.
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    // Custom widgets are plain browser scripts; the host injects `mypa`
    // through /__mypa/sdk.js (src/main/widgets/runtime/sdk.js defines it).
    files: ["widgets/**/*.js", "src/main/widgets/runtime/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, mypa: "readonly" },
    },
  },
  {
    ignores: ["out/**", "dist/**", "resources/registry/**"],
  },
];
