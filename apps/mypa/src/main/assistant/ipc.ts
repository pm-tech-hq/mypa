import { ipcMain } from "electron";

import {
  ASSISTANT_IPC,
  type AssistantEvent,
  type AssistantRequest,
  type AssistantSettings,
} from "../../shared/assistant";
import { answerApproval, modelInfo, runAgent, undoAction } from "./agent";
import { getSettings, listScopes, saveSettings } from "./settings";

const running = new Map<string, AbortController>();

export function registerAssistantHandlers(): void {
  ipcMain.handle(ASSISTANT_IPC.getSettings, () => getSettings());
  ipcMain.handle(ASSISTANT_IPC.saveSettings, (_e, s: AssistantSettings) => saveSettings(s));
  ipcMain.handle(ASSISTANT_IPC.scopes, () => listScopes());
  ipcMain.handle(ASSISTANT_IPC.modelInfo, () => modelInfo());

  ipcMain.handle(ASSISTANT_IPC.send, (e, req: AssistantRequest) => {
    const send = (event: AssistantEvent) => {
      if (!e.sender.isDestroyed()) e.sender.send(ASSISTANT_IPC.event, event);
    };
    const ctrl = new AbortController();
    running.set(req.requestId, ctrl);
    void (async () => {
      try {
        await runAgent(req, send, ctrl.signal);
        send({ requestId: req.requestId, type: "done" });
      } catch (err) {
        if (ctrl.signal.aborted) send({ requestId: req.requestId, type: "done" });
        else
          send({
            requestId: req.requestId,
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
      } finally {
        running.delete(req.requestId);
      }
    })();
  });

  ipcMain.handle(ASSISTANT_IPC.cancel, (_e, requestId: string) => running.get(requestId)?.abort());
  ipcMain.handle(ASSISTANT_IPC.approve, (_e, actionId: string, allow: boolean) =>
    answerApproval(actionId, allow === true),
  );
  ipcMain.handle(ASSISTANT_IPC.undo, (_e, actionId: string) => undoAction(actionId));
}
