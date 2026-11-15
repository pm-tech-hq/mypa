/**
 * The welcome guide in the main process: building the starter pages a new
 * user picks, the name myPA calls them, and whether the guide shows.
 */
import { ipcMain } from "electron";

import { IPC } from "../shared/api";
import type { StarterPlan } from "../shared/onboarding";
import * as db from "./db";

export function registerOnboardingHandlers(snap: () => unknown): void {
  ipcMain.handle(IPC.onboardingApply, (_e, plan: StarterPlan) => {
    const result = db.applyStarterPlan(plan);
    db.flush();
    return { result, snapshot: snap() };
  });
  ipcMain.handle(IPC.onboardingSet, (_e, show: boolean) => {
    db.setOnboarding(show === true);
    db.flush();
    return snap();
  });
  ipcMain.handle(IPC.userNameSet, (_e, name: string) => {
    db.setUserName(String(name ?? ""));
    db.flush();
    return snap();
  });
}
