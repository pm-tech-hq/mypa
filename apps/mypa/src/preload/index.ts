import { clipboard, contextBridge, ipcRenderer, webUtils } from "electron";

import { IPC } from "../shared/api";
import { MARKET_IPC } from "../shared/marketApi";
import { ASSISTANT_IPC } from "../shared/assistant";
import { TUTOR_IPC } from "../shared/tutor";
import { EMAIL_IPC } from "../shared/email";
import { MEETINGS_IPC } from "../shared/meetings";
import { SYSTEM_IPC } from "../shared/system";

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
    noteHistory: (widgetId: string) => ipcRenderer.invoke(IPC.noteHistory, widgetId),
    restoreNoteVersion: (widgetId: string, versionId: string) =>
      ipcRenderer.invoke(IPC.noteRestore, widgetId, versionId),
    closedNotes: () => ipcRenderer.invoke(IPC.notesClosed),

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
    importIcsFile: () => ipcRenderer.invoke(IPC.calendarImportIcs),

    addGoogleCalendar: (input: unknown) =>
      ipcRenderer.invoke(IPC.calendarAccountAddGoogle, input),
    addOutlookCalendar: (input: unknown) =>
      ipcRenderer.invoke(IPC.calendarAccountAddOutlook, input),
    addIcsCalendar: (input: unknown) => ipcRenderer.invoke(IPC.calendarAccountAddIcs, input),
    reconnectCalendarAccount: (id: string) =>
      ipcRenderer.invoke(IPC.calendarAccountReconnect, id),
    syncCalendarAccount: (id: string) => ipcRenderer.invoke(IPC.calendarAccountSync, id),
    removeCalendarAccount: (id: string) => ipcRenderer.invoke(IPC.calendarAccountRemove, id),
    addZohoCalendar: (input: unknown) => ipcRenderer.invoke(IPC.calendarAccountAddZoho, input),
    addCaldavCalendar: (input: unknown) => ipcRenderer.invoke(IPC.calendarAccountAddCaldav, input),
    updateCalendarAccount: (id: string, patch: unknown) =>
      ipcRenderer.invoke(IPC.calendarAccountUpdate, id, patch),
    createRemoteEvent: (input: unknown) => ipcRenderer.invoke(IPC.calendarRemoteCreate, input),
    updateRemoteEvent: (id: string, patch: unknown) =>
      ipcRenderer.invoke(IPC.calendarRemoteUpdate, id, patch),
    deleteRemoteEvent: (id: string) => ipcRenderer.invoke(IPC.calendarRemoteDelete, id),
    respondToEvent: (id: string, answer: string) =>
      ipcRenderer.invoke(IPC.calendarRemoteRespond, id, answer),
    setCalendarReminder: (minutes: number) => ipcRenderer.invoke(IPC.calendarSetReminder, minutes),
    setGoogleClient: (client: unknown) => ipcRenderer.invoke(IPC.calendarSetGoogleClient, client),
    onCalendarFocus: (cb: (eventId: string) => void) => {
      const handler = (_e: unknown, id: string) => cb(id);
      ipcRenderer.on(IPC.calendarFocus, handler);
      return () => ipcRenderer.removeListener(IPC.calendarFocus, handler);
    },

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

    createExpense: (input: unknown) => ipcRenderer.invoke(IPC.expenseCreate, input),
    updateExpense: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.expenseUpdate, id, patch),
    deleteExpenses: (ids: string[]) => ipcRenderer.invoke(IPC.expenseDelete, ids),
    createExpenseCategory: (input: unknown) => ipcRenderer.invoke(IPC.expenseCategoryCreate, input),
    updateExpenseCategory: (id: string, patch: unknown) =>
      ipcRenderer.invoke(IPC.expenseCategoryUpdate, id, patch),
    deleteExpenseCategory: (id: string, moveTo?: string) =>
      ipcRenderer.invoke(IPC.expenseCategoryDelete, id, moveTo),
    createExpenseBill: (input: unknown) => ipcRenderer.invoke(IPC.expenseBillCreate, input),
    updateExpenseBill: (id: string, patch: unknown) =>
      ipcRenderer.invoke(IPC.expenseBillUpdate, id, patch),
    deleteExpenseBill: (id: string) => ipcRenderer.invoke(IPC.expenseBillDelete, id),
    setExpenseSettings: (patch: unknown) => ipcRenderer.invoke(IPC.expenseSettings, patch),
    exportExpenses: (csv: string, name: string) => ipcRenderer.invoke(IPC.expenseExport, csv, name),

    createReminder: (input: unknown) => ipcRenderer.invoke(IPC.reminderCreate, input),
    updateReminder: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.reminderUpdate, id, patch),
    completeReminder: (id: string, done: boolean) =>
      ipcRenderer.invoke(IPC.reminderComplete, id, done),
    snoozeReminder: (id: string, until: number | null) =>
      ipcRenderer.invoke(IPC.reminderSnooze, id, until),
    deleteReminders: (ids: string[]) => ipcRenderer.invoke(IPC.reminderDelete, ids),
    addMemory: (input: unknown) => ipcRenderer.invoke(IPC.memoryAdd, input),
    updateMemory: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.memoryUpdate, id, patch),
    deleteMemories: (ids: string[]) => ipcRenderer.invoke(IPC.memoryDelete, ids),
    putMemories: (list: unknown) => ipcRenderer.invoke(IPC.memoryPut, list),
    createShoppingList: (name: string) => ipcRenderer.invoke(IPC.shopListCreate, name),
    renameShoppingList: (id: string, name: string) => ipcRenderer.invoke(IPC.shopListRename, id, name),
    deleteShoppingList: (id: string) => ipcRenderer.invoke(IPC.shopListDelete, id),
    addShopping: (listId: string, text: string) => ipcRenderer.invoke(IPC.shopAdd, listId, text),
    updateShoppingItem: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.shopUpdate, id, patch),
    putShoppingItems: (items: unknown) => ipcRenderer.invoke(IPC.shopPut, items),
    deleteShoppingItems: (ids: string[]) => ipcRenderer.invoke(IPC.shopDelete, ids),
    checkAllShopping: (listId: string, checked: boolean) => ipcRenderer.invoke(IPC.shopCheckAll, listId, checked),
    finishShopping: (listId: string, expense: unknown) => ipcRenderer.invoke(IPC.shopFinish, listId, expense),
    forgetShopping: (name: string) => ipcRenderer.invoke(IPC.shopForget, name),
    setShoppingSettings: (patch: unknown) => ipcRenderer.invoke(IPC.shopSettings, patch),
    saveJournal: (day: string, patch: unknown) => ipcRenderer.invoke(IPC.journalSave, day, patch),
    deleteJournal: (days: string[]) => ipcRenderer.invoke(IPC.journalDelete, days),
    putJournal: (entries: unknown) => ipcRenderer.invoke(IPC.journalPut, entries),
    unlockJournal: (code: string) => ipcRenderer.invoke(IPC.journalUnlock, code),
    lockJournal: () => ipcRenderer.invoke(IPC.journalLock),
    setJournalPasscode: (current: string, next: string) => ipcRenderer.invoke(IPC.journalPasscode, current, next),
    eraseJournal: () => ipcRenderer.invoke(IPC.journalErase),
    journalVerifyMethod: () => ipcRenderer.invoke(IPC.journalVerifyMethod),
    applyStarterPlan: (plan: unknown) => ipcRenderer.invoke(IPC.onboardingApply, plan),
    setOnboarding: (show: boolean) => ipcRenderer.invoke(IPC.onboardingSet, show),
    setUserName: (name: string) => ipcRenderer.invoke(IPC.userNameSet, name),
    resetJournalWithOs: () => ipcRenderer.invoke(IPC.journalResetWithOs),
    setJournalSettings: (patch: unknown) => ipcRenderer.invoke(IPC.journalSettings, patch),
    exportJournal: () => ipcRenderer.invoke(IPC.journalExport),
    touchJournal: () => ipcRenderer.send(IPC.journalTouch),
    createProject: (name: string, patch?: unknown) => ipcRenderer.invoke(IPC.projCreate, name, patch),
    updateProject: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.projUpdate, id, patch),
    deleteProject: (id: string) => ipcRenderer.invoke(IPC.projDelete, id),
    moveTask: (taskId: string, col: string, sort?: number) => ipcRenderer.invoke(IPC.projMoveTask, taskId, col, sort),
    saveSubject: (id: string | null, patch: unknown) => ipcRenderer.invoke(IPC.studySubject, id, patch),
    deleteSubject: (id: string) => ipcRenderer.invoke(IPC.studySubjectDelete, id),
    saveExam: (id: string | null, patch: unknown) => ipcRenderer.invoke(IPC.studyExam, id, patch),
    deleteExam: (id: string) => ipcRenderer.invoke(IPC.studyExamDelete, id),
    addSessions: (list: unknown) => ipcRenderer.invoke(IPC.studyAdd, list),
    updateSession: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.studyUpdate, id, patch),
    deleteSessions: (ids: string[]) => ipcRenderer.invoke(IPC.studyDelete, ids),
    putSessions: (list: unknown) => ipcRenderer.invoke(IPC.studyPut, list),
    setStudySettings: (patch: unknown) => ipcRenderer.invoke(IPC.studySettings, patch),
    writeBriefing: () => ipcRenderer.invoke(IPC.briefingWrite),
    clearBriefing: () => ipcRenderer.invoke(IPC.briefingClear),
    setBriefingSettings: (patch: unknown) => ipcRenderer.invoke(IPC.briefingSettings, patch),
    onBriefingFocus: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.briefingFocus, handler);
      return () => ipcRenderer.removeListener(IPC.briefingFocus, handler);
    },
    createTimer: (input: unknown) => ipcRenderer.invoke(IPC.timerCreate, input),
    timerAction: (id: string, action: unknown) => ipcRenderer.invoke(IPC.timerAction, id, action),
    updateTimer: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.timerUpdate, id, patch),
    deleteTimer: (id: string) => ipcRenderer.invoke(IPC.timerDelete, id),
    putTimer: (row: unknown) => ipcRenderer.invoke(IPC.timerPut, row),
    setTimerSettings: (patch: unknown) => ipcRenderer.invoke(IPC.timerSettings, patch),
    onTimerFired: (cb: (id: string, clicked: boolean) => void) => {
      const handler = (_e: unknown, id: string, clicked: boolean) => cb(id, clicked);
      ipcRenderer.on(IPC.timerFired, handler);
      return () => ipcRenderer.removeListener(IPC.timerFired, handler);
    },
    saveCapture: (text: string, kind?: string) => ipcRenderer.invoke(IPC.captureSave, text, kind),
    convertCapture: (id: string, kind: string) => ipcRenderer.invoke(IPC.captureConvert, id, kind),
    deleteCaptures: (ids: string[], targets: boolean) => ipcRenderer.invoke(IPC.captureDelete, ids, targets),
    setCaptureDone: (id: string, done: boolean) => ipcRenderer.invoke(IPC.captureDone, id, done),
    captureToNote: (id: string, widgetId: string) => ipcRenderer.invoke(IPC.captureToNote, id, widgetId),
    setCaptureSettings: (patch: unknown) => ipcRenderer.invoke(IPC.captureSettings, patch),
    captureHotkeyStatus: () => ipcRenderer.invoke(IPC.captureHotkeyStatus),
    hideCapture: () => ipcRenderer.send(IPC.captureHide),
    openMainFromCapture: () => ipcRenderer.send(IPC.captureOpenMain),
    resizeCapture: (height: number) => ipcRenderer.send(IPC.captureResize, height),
    onCaptureShown: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.captureShown, handler);
      return () => {
        ipcRenderer.removeListener(IPC.captureShown, handler);
      };
    },
    savePlan: (day: string, blocks: unknown) => ipcRenderer.invoke(IPC.planSave, day, blocks),
    setPlanDay: (day: string, patch: unknown) => ipcRenderer.invoke(IPC.planDay, day, patch),
    setPlannerSettings: (patch: unknown) => ipcRenderer.invoke(IPC.plannerSettings, patch),
    onReminderFocus: (cb: (id: string) => void) => {
      const handler = (_e: unknown, id: string) => cb(id);
      ipcRenderer.on(IPC.reminderFocus, handler);
      return () => ipcRenderer.removeListener(IPC.reminderFocus, handler);
    },

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
    modelStatus: (model: string) => ipcRenderer.invoke(ASSISTANT_IPC.modelStatus, model),
    modelDownload: (model: string) => ipcRenderer.invoke(ASSISTANT_IPC.modelDownload, model),
    modelPause: () => ipcRenderer.invoke(ASSISTANT_IPC.modelPause),
    modelCancel: (model: string) => ipcRenderer.invoke(ASSISTANT_IPC.modelCancel, model),
    onModelStatus: (cb: (s: unknown) => void) => {
      const handler = (_e: unknown, status: unknown) => cb(status);
      ipcRenderer.on(ASSISTANT_IPC.modelEvent, handler);
      return () => ipcRenderer.removeListener(ASSISTANT_IPC.modelEvent, handler);
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
    speak: (text: string, voice: string, engine?: string) =>
      ipcRenderer.invoke(TUTOR_IPC.speak, text, voice, engine),
    setVoiceKey: (service: string, key: string) =>
      ipcRenderer.invoke(TUTOR_IPC.setVoiceKey, service, key),
    listVoices: (service: string) => ipcRenderer.invoke(TUTOR_IPC.listVoices, service),
    transcribeMic: (samples: Float32Array) => ipcRenderer.invoke(TUTOR_IPC.transcribeMic, samples),
  },
  email: {
    accounts: () => ipcRenderer.invoke(EMAIL_IPC.accounts),
    addAccount: (input: unknown) => ipcRenderer.invoke(EMAIL_IPC.addAccount, input),
    addGoogle: (input: unknown) => ipcRenderer.invoke(EMAIL_IPC.addGoogle, input),
    reconnectGoogle: (id: string) => ipcRenderer.invoke(EMAIL_IPC.reconnectGoogle, id),
    updateAccount: (id: string, patch: unknown) =>
      ipcRenderer.invoke(EMAIL_IPC.updateAccount, id, patch),
    removeAccount: (id: string) => ipcRenderer.invoke(EMAIL_IPC.removeAccount, id),
    syncAccount: (id: string) => ipcRenderer.invoke(EMAIL_IPC.syncAccount, id),
    list: (query: unknown) => ipcRenderer.invoke(EMAIL_IPC.list, query),
    open: (id: string) => ipcRenderer.invoke(EMAIL_IPC.open, id),
    loadImages: (id: string) => ipcRenderer.invoke(EMAIL_IPC.loadImages, id),
    act: (ids: string[], action: string) => ipcRenderer.invoke(EMAIL_IPC.act, ids, action),
    undo: (token: string) => ipcRenderer.invoke(EMAIL_IPC.undo, token),
    pickFiles: () => ipcRenderer.invoke(EMAIL_IPC.pickFiles),
    saveAttachment: (id: string, index: number) =>
      ipcRenderer.invoke(EMAIL_IPC.saveAttachment, id, index),
    send: (input: unknown) => ipcRenderer.invoke(EMAIL_IPC.send, input),
    drafts: () => ipcRenderer.invoke(EMAIL_IPC.drafts),
    dismissDraft: (id: string) => ipcRenderer.invoke(EMAIL_IPC.dismissDraft, id),
    setCategories: (patches: unknown) => ipcRenderer.invoke(EMAIL_IPC.setCategories, patches),
    onEvent: (cb: (e: unknown) => void) => {
      const handler = (_e: unknown, event: unknown) => cb(event);
      ipcRenderer.on(EMAIL_IPC.event, handler);
      return () => ipcRenderer.removeListener(EMAIL_IPC.event, handler);
    },
  },
  meetings: {
    start: (input: unknown) => ipcRenderer.invoke(MEETINGS_IPC.start, input),
    append: (id: string, track: string, data: ArrayBuffer) =>
      ipcRenderer.invoke(MEETINGS_IPC.append, id, track, data),
    stop: (id: string) => ipcRenderer.invoke(MEETINGS_IPC.stop, id),
    discard: (id: string) => ipcRenderer.invoke(MEETINGS_IPC.discard, id),
    retry: (id: string, options: unknown) => ipcRenderer.invoke(MEETINGS_IPC.retry, id, options),
    summarize: (id: string, ai: string) => ipcRenderer.invoke(MEETINGS_IPC.summarize, id, ai),
    renameSpeaker: (id: string, label: string, name: string) =>
      ipcRenderer.invoke(MEETINGS_IPC.renameSpeaker, id, label, name),
    addAction: (id: string, index: number) =>
      ipcRenderer.invoke(MEETINGS_IPC.addAction, id, index),
    openFolder: (id: string) => ipcRenderer.invoke(MEETINGS_IPC.openFolder, id),
    deleteAudio: (id: string) => ipcRenderer.invoke(MEETINGS_IPC.deleteAudio, id),
    onEvent: (cb: (e: unknown) => void) => {
      const handler = (_e: unknown, event: unknown) => cb(event);
      ipcRenderer.on(MEETINGS_IPC.event, handler);
      return () => ipcRenderer.removeListener(MEETINGS_IPC.event, handler);
    },
  },
  system: {
    getState: () => ipcRenderer.invoke(SYSTEM_IPC.getState),
    setPrefs: (patch: unknown) => ipcRenderer.invoke(SYSTEM_IPC.setPrefs, patch),
    testNotification: () => ipcRenderer.invoke(SYSTEM_IPC.testNotification),
    checkForUpdates: () => ipcRenderer.invoke(SYSTEM_IPC.checkForUpdates),
    installUpdate: () => ipcRenderer.send(SYSTEM_IPC.installUpdate),
    onStateChanged: (cb: (state: unknown) => void) => {
      const handler = (_e: unknown, state: unknown) => cb(state);
      ipcRenderer.on(SYSTEM_IPC.stateChanged, handler);
      return () => ipcRenderer.removeListener(SYSTEM_IPC.stateChanged, handler);
    },
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
