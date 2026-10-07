import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // The Whisper worker is a separate entry (not an import of index.ts) —
        // it runs in its own worker_thread so heavy ONNX inference can never
        // block the main process's event loop (window/IPC/DB all live there).
        input: {
          index: fileURLToPath(new URL("./src/main/index.ts", import.meta.url)),
          "transcribe/whisper-worker": fileURLToPath(
            new URL("./src/main/transcribe/whisper-worker.ts", import.meta.url),
          ),
          "tutor/local-worker": fileURLToPath(
            new URL("./src/main/tutor/local-worker.ts", import.meta.url),
          ),
          "tutor/tts-worker": fileURLToPath(
            new URL("./src/main/tutor/tts-worker.ts", import.meta.url),
          ),
        },
      },
    },
    // The widget SDK is TypeScript source and the fonts are inlined as data
    // URIs for widget iframes; both must be bundled, not required at runtime.
    plugins: [externalizeDepsPlugin({ exclude: ["@repo/widget-sdk", "@fontsource/poppins"] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src/renderer/src", import.meta.url)),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
