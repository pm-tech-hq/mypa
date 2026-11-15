/**
 * Changing events in connected calendars (Google, Zoho, CalDAV): add, change,
 * delete and answer invitations. Each change is made on the provider first,
 * then the account is synced so what myPA shows is what the provider has.
 */
import type {
  CalendarAccountPatch,
  CalendarRemoteEventRow,
  CalendarRsvp,
  NewRemoteEvent,
  RemoteEventPatch,
} from "../../shared/types";
import * as db from "../db";
import type { CalendarAccountSecrets } from "../db";
import {
  createDavEvent,
  deleteDavEvent,
  respondDavEvent,
  updateDavEvent,
  type DavRef,
} from "./caldav";
import {
  createGoogleEvent,
  deleteGoogleEvent,
  respondGoogleEvent,
  updateGoogleEvent,
  type GoogleRef,
} from "./google";
import { davLogin, ensureFreshGoogleToken, selfAddresses, syncAccount } from "./sync";

function writableAccount(accountId: string): CalendarAccountSecrets {
  const account = db.getCalendarAccountSecrets(accountId);
  if (!account) throw new Error("That calendar account isn't connected any more.");
  if (!account.canWrite)
    throw new Error(
      account.provider === "google"
        ? `Reconnect ${account.label} in the Calendar settings to let myPA change its events.`
        : `${account.label} is read-only in myPA.`,
    );
  return account;
}

function remote(id: string): {
  event: CalendarRemoteEventRow;
  ref: unknown;
  account: CalendarAccountSecrets;
} {
  const found = db.getRemoteEvent(id);
  if (!found) throw new Error("That event isn't in your calendar any more. It may have just changed.");
  return { ...found, account: writableAccount(found.event.accountId) };
}

const cleanGuests = (guests: string[] | undefined) =>
  guests?.map((g) => g.trim().toLowerCase()).filter((g) => /^[^\s@]+@[^\s@]+$/.test(g));

/** Adds an event to a connected calendar; returns its id in myPA once synced (or null). */
export async function createRemoteEvent(input: NewRemoteEvent): Promise<string | null> {
  const account = writableAccount(input.accountId);
  const cal = account.calendars.find((c) => c.id === input.calendarId);
  if (!cal) throw new Error("That calendar isn't in the account any more.");
  if (!cal.writable) throw new Error(`You can't add events to “${cal.name}”.`);
  const clean = { ...input, guests: cleanGuests(input.guests) ?? [] };
  let key: string;
  if (account.provider === "google") {
    const ref = await createGoogleEvent(await ensureFreshGoogleToken(account), clean);
    key = ref.eventId;
  } else {
    const ref = await createDavEvent(cal.id, davLogin(account), clean);
    key = ref.uid;
  }
  if (cal.hidden) db.updateCalendarAccount(account.id, { calendars: account.calendars.map((c) => (c.id === cal.id ? { ...c, hidden: false } : c)) });
  await syncAccount(account.id);
  const id = db.remoteEventId(account.id, cal.id, key);
  return db.getRemoteEvent(id) ? id : null;
}

export async function updateRemoteEvent(id: string, patch: RemoteEventPatch): Promise<void> {
  const { event, ref, account } = remote(id);
  if (!event.canEdit) throw new Error("Only the organiser can change this event. You can answer it instead.");
  const clean = { ...patch, guests: cleanGuests(patch.guests) };
  if (clean.guests === undefined) delete clean.guests;
  if (account.provider === "google")
    await updateGoogleEvent(await ensureFreshGoogleToken(account), ref as GoogleRef, clean);
  else await updateDavEvent(ref as DavRef, davLogin(account), event, clean);
  await syncAccount(account.id);
}

export async function deleteRemoteEvent(id: string): Promise<void> {
  const { event, ref, account } = remote(id);
  if (!event.canEdit) throw new Error("Only the organiser can delete this event. You can decline it instead.");
  if (account.provider === "google")
    await deleteGoogleEvent(await ensureFreshGoogleToken(account), ref as GoogleRef);
  else await deleteDavEvent(ref as DavRef, davLogin(account));
  await syncAccount(account.id);
}

export async function respondToEvent(id: string, answer: CalendarRsvp): Promise<void> {
  const { event, ref, account } = remote(id);
  if (!event.attendees.some((a) => a.self)) throw new Error("You're not on this event's guest list.");
  if (account.provider === "google")
    await respondGoogleEvent(await ensureFreshGoogleToken(account), ref as GoogleRef, answer);
  else await respondDavEvent(ref as DavRef, davLogin(account), event, answer, selfAddresses(account));
  await syncAccount(account.id);
}

/** Renames an account, turns its reminders on or off, or shows/hides its calendars. */
export async function updateAccount(id: string, patch: CalendarAccountPatch): Promise<void> {
  const account = db.getCalendarAccountSecrets(id);
  if (!account) return;
  const label = patch.label?.trim();
  let calendars;
  let shown: string[] = [];
  if (patch.hiddenCalendars) {
    const hide = new Set(patch.hiddenCalendars);
    calendars = account.calendars.map((c) => ({ ...c, hidden: hide.has(c.id) }));
    shown = calendars.filter((c) => !c.hidden && account.calendars.find((o) => o.id === c.id)?.hidden).map((c) => c.id);
    db.deleteRemoteEventsIn(id, [...hide]);
  }
  db.updateCalendarAccount(id, {
    ...(label ? { label: label.slice(0, 60) } : {}),
    ...(patch.notify !== undefined ? { notify: patch.notify } : {}),
    ...(calendars ? { calendars } : {}),
  });
  // A calendar that was just shown has no events cached yet.
  if (shown.length) await syncAccount(id);
}
