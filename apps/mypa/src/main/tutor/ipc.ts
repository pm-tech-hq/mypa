import { ipcMain } from "electron";

import {
  TUTOR_IPC,
  type ChatEvent,
  type ChatRequest,
  type LocalModelId,
  type SaveProviderInput,
} from "../../shared/tutor";
import * as config from "./config";
import { streamLocal } from "./local";
import { streamProvider } from "./providers";
import { transcribeAudio } from "../transcribe/whisper";
import { speak } from "./tts";

const running = new Map<string, AbortController>();

export function registerTutorHandlers(): void {
  ipcMain.handle(TUTOR_IPC.getConfig, () => config.getConfig());
  ipcMain.handle(TUTOR_IPC.saveProvider, (_e, input: SaveProviderInput) =>
    config.saveProvider(input),
  );
  ipcMain.handle(TUTOR_IPC.deleteProvider, (_e, id: string) => config.deleteProvider(id));
  ipcMain.handle(TUTOR_IPC.setLocalModel, (_e, id: LocalModelId) => config.setLocalModel(id));

  ipcMain.handle(TUTOR_IPC.chat, (e, req: ChatRequest) => {
    const send = (event: ChatEvent) => {
      if (!e.sender.isDestroyed()) e.sender.send(TUTOR_IPC.chatEvent, event);
    };
    const ctrl = new AbortController();
    const id = req.requestId;
    running.set(id, ctrl);

    void (async () => {
      try {
        if (req.target === "local") {
          await streamLocal(
            id,
            config.getLocalModel(),
            req.messages,
            ctrl.signal,
            (text) => send({ requestId: id, type: "delta", text }),
            (text) => send({ requestId: id, type: "status", text }),
          );
        } else {
          const provider = config.getProviderWithKey(req.target);
          if (!provider) throw new Error("That AI provider no longer exists.");
          await streamProvider(provider, req.messages, ctrl.signal, (text) =>
            send({ requestId: id, type: "delta", text }),
          );
        }
        send({ requestId: id, type: "done" });
      } catch (err) {
        if (ctrl.signal.aborted) send({ requestId: id, type: "done" });
        else
          send({
            requestId: id,
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
      } finally {
        running.delete(id);
      }
    })();
  });

  ipcMain.handle(TUTOR_IPC.cancel, (_e, requestId: string) => {
    running.get(requestId)?.abort();
  });

  ipcMain.handle(TUTOR_IPC.speak, (_e, text: string, voice: string) => speak(text, voice));

  ipcMain.handle(TUTOR_IPC.transcribeMic, (_e, samples: Float32Array) =>
    transcribeAudio(new Float32Array(samples), "base", () => undefined),
  );
}
