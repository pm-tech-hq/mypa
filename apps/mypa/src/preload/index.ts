import { clipboard, contextBridge, ipcRenderer, webUtils } from "electron";

import { IPC } from "../shared/api";
import { MARKET_IPC } from "../shared/marketApi";
import { ASSISTANT_IPC } from "../shared/assistant";
import { TUTOR_IPC } from "../shared/tutor";

// Shape must match `MypaApi` in ../shared/api (enforced on the renderer side
// via the `Window.mypa` declaration in src/renderer/global.d.ts).
contextBridge.exposeInMainWorld("mypa", {
  getVersion: () => ipcRenderer.invoke(IPC.getVersion),
  copyText: (text: string) => clipboard.writeText(String(text)),
  win: {
    minimize: () => ipcRenderer.send(IPC.winMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.winMaximizeToggle),
    close: () => ipcRenderer.send(IPC.winClose),
    isMaximized: () => ipcRenderer.invoke(IPC.winIsMaximized),
    onMaximizeChange: (cb: (maximized: boolean) => void) => {
      const handler = (_e: unknown, maximized: boolean) => cb(maximized);
      ipcRenderer.on(IPC.winMaximizeChanged, handler);
      return () => ipcRenderer.removeListener(IPC.winMaximizeChanged, handler);
    },
  },
  db: {
    snapshot: () => ipcRenderer.invoke(IPC.snapshot),

    createPage: (input: unknown) => ipcRenderer.invoke(IPC.pageCreate, input),
    updatePage: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.pageUpdate, id, patch),
    deletePage: (id: string) => ipcRenderer.invoke(IPC.pageDelete, id),
    setCurrentPage: (id: string) => ipcRenderer.invoke(IPC.pageSetCurrent, id),

    createWidget: (input: unknown) => ipcRenderer.invoke(IPC.widgetCreate, input),
    updateWidget: (id: string, patch: unknown) =>
      ipcRenderer.invoke(IPC.widgetUpdate, id, patch),
    updateWidgetSettings: (id: string, settings: unknown) =>
      ipcRenderer.invoke(IPC.widgetSettings, id, settings),
    deleteWidget: (id: string) => ipcRenderer.invoke(IPC.widgetDelete, id),

    createGoal: (input: unknown) => ipcRenderer.invoke(IPC.goalCreate, input),
    updateGoal: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.goalUpdate, id, patch),
    deleteGoal: (id: string) => ipcRenderer.invoke(IPC.goalDelete, id),

    createTask: (input: unknown) => ipcRenderer.invoke(IPC.taskCreate, input),
    updateTask: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.taskUpdate, id, patch),
    deleteTask: (id: string) => ipcRenderer.invoke(IPC.taskDelete, id),

    createStep: (input: unknown) => ipcRenderer.invoke(IPC.stepCreate, input),
    updateStep: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.stepUpdate, id, patch),
    deleteStep: (id: string) => ipcRenderer.invoke(IPC.stepDelete, id),

    createCalendarEvent: (input: unknown) => ipcRenderer.invoke(IPC.calendarEventCreate, input),
    updateCalendarEvent: (id: string, patch: unknown) =>
      ipcRenderer.invoke(IPC.calendarEventUpdate, id, patch),
    deleteCalendarEvent: (id: string) => ipcRenderer.invoke(IPC.calendarEventDelete, id),

    addGoogleCalendar: (input: unknown) =>
      ipcRenderer.invoke(IPC.calendarAccountAddGoogle, input),
    addOutlookCalendar: (input: unknown) =>
      ipcRenderer.invoke(IPC.calendarAccountAddOutlook, input),
    addIcsCalendar: (input: unknown) => ipcRenderer.invoke(IPC.calendarAccountAddIcs, input),
    reconnectCalendarAccount: (id: string) =>
      ipcRenderer.invoke(IPC.calendarAccountReconnect, id),
    syncCalendarAccount: (id: string) => ipcRenderer.invoke(IPC.calendarAccountSync, id),
    removeCalendarAccount: (id: string) => ipcRenderer.invoke(IPC.calendarAccountRemove, id),

    pickAndTranscribeFile: (modelSize: string) =>
      ipcRenderer.invoke(IPC.transcribePickFile, modelSize),
    transcribeUrlMedia: (input: unknown) => ipcRenderer.invoke(IPC.transcribeUrlMedia, input),
    transcribePage: (input: unknown) => ipcRenderer.invoke(IPC.transcribePage, input),
    deleteTranscript: (id: string) => ipcRenderer.invoke(IPC.transcriptDelete, id),
    retryTranscript: (input: unknown) => ipcRenderer.invoke(IPC.transcriptRetry, input),
    transcribeFiles: (paths: string[], modelSize: string) =>
      ipcRenderer.invoke(IPC.transcribeFiles, paths, modelSize),
    renameTranscript: (id: string, title: string) =>
      ipcRenderer.invoke(IPC.transcriptRename, id, title),
    exportTranscript: (id: string) => ipcRenderer.invoke(IPC.transcriptExport, id),
    pathForFile: (file: File) => webUtils.getPathForFile(file),

    setMeta: (key: string, value: boolean) => ipcRenderer.invoke(IPC.setMeta, key, value),

    onSnapshotChanged: (cb: (snapshot: unknown) => void) => {
      const handler = (_e: unknown, snapshot: unknown) => cb(snapshot);
      ipcRenderer.on(IPC.snapshotChanged, handler);
      return () => ipcRenderer.removeListener(IPC.snapshotChanged, handler);
    },
  },
  assistant: {
    getSettings: () => ipcRenderer.invoke(ASSISTANT_IPC.getSettings),
    saveSettings: (s: unknown) => ipcRenderer.invoke(ASSISTANT_IPC.saveSettings, s),
    scopes: () => ipcRenderer.invoke(ASSISTANT_IPC.scopes),
    modelInfo: () => ipcRenderer.invoke(ASSISTANT_IPC.modelInfo),
    send: (req: unknown) => ipcRenderer.invoke(ASSISTANT_IPC.send, req),
    cancel: (requestId: string) => ipcRenderer.invoke(ASSISTANT_IPC.cancel, requestId),
    approve: (actionId: string, allow: boolean) =>
      ipcRenderer.invoke(ASSISTANT_IPC.approve, actionId, allow),
    undo: (actionId: string) => ipcRenderer.invoke(ASSISTANT_IPC.undo, actionId),
    onEvent: (cb: (e: unknown) => void) => {
      const handler = (_e: unknown, event: unknown) => cb(event);
      ipcRenderer.on(ASSISTANT_IPC.event, handler);
      return () => ipcRenderer.removeListener(ASSISTANT_IPC.event, handler);
    },
  },
  tutor: {
    getConfig: () => ipcRenderer.invoke(TUTOR_IPC.getConfig),
    saveProvider: (input: unknown) => ipcRenderer.invoke(TUTOR_IPC.saveProvider, input),
    deleteProvider: (id: string) => ipcRenderer.invoke(TUTOR_IPC.deleteProvider, id),
    setLocalModel: (id: string) => ipcRenderer.invoke(TUTOR_IPC.setLocalModel, id),
    chat: (req: unknown) => ipcRenderer.invoke(TUTOR_IPC.chat, req),
    cancel: (requestId: string) => ipcRenderer.invoke(TUTOR_IPC.cancel, requestId),
    onChatEvent: (cb: (e: unknown) => void) => {
      const handler = (_e: unknown, event: unknown) => cb(event);
      ipcRenderer.on(TUTOR_IPC.chatEvent, handler);
      return () => ipcRenderer.removeListener(TUTOR_IPC.chatEvent, handler);
    },
    speak: (text: string, voice: string) => ipcRenderer.invoke(TUTOR_IPC.speak, text, voice),
    transcribeMic: (samples: Float32Array) => ipcRenderer.invoke(TUTOR_IPC.transcribeMic, samples),
  },
  market: {
    catalog: (force?: boolean) => ipcRenderer.invoke(MARKET_IPC.catalog, force),
    install: (id: string, registryUrl: string) =>
      ipcRenderer.invoke(MARKET_IPC.install, id, registryUrl),
    installFile: () => ipcRenderer.invoke(MARKET_IPC.installFile),
    linkDev: () => ipcRenderer.invoke(MARKET_IPC.linkDev),
    uninstall: (id: string) => ipcRenderer.invoke(MARKET_IPC.uninstall, id),
    setEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke(MARKET_IPC.setEnabled, id, enabled),
    activateLicense: (id: string, key: string) =>
      ipcRenderer.invoke(MARKET_IPC.activateLicense, id, key),
    addRegistry: (url: string) => ipcRenderer.invoke(MARKET_IPC.addRegistry, url),
    removeRegistry: (url: string) => ipcRenderer.invoke(MARKET_IPC.removeRegistry, url),
    bridgeFetch: (widgetId: string, url: string, init: unknown) =>
      ipcRenderer.invoke(MARKET_IPC.bridgeFetch, widgetId, url, init),
    bridgeNotify: (widgetId: string, title: string, body: string) =>
      ipcRenderer.invoke(MARKET_IPC.bridgeNotify, widgetId, title, body),
    openExternal: (url: string) => ipcRenderer.invoke(MARKET_IPC.openExternal, url),
    onDevChanged: (cb: (widgetId: string) => void) => {
      const handler = (_e: unknown, id: string) => cb(id);
      ipcRenderer.on(MARKET_IPC.devChanged, handler);
      return () => ipcRenderer.removeListener(MARKET_IPC.devChanged, handler);
    },
    onOpenWidget: (cb: (widgetId: string) => void) => {
      const handler = (_e: unknown, id: string) => cb(id);
      ipcRenderer.on(MARKET_IPC.openWidget, handler);
      return () => ipcRenderer.removeListener(MARKET_IPC.openWidget, handler);
    },
  },
});
