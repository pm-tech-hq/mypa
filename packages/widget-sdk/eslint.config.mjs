import { config } from "@repo/eslint-config/base";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    // The starter widget is a browser script; the host injects `mypa`.
    files: ["template/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, mypa: "readonly" },
    },
  },
];
