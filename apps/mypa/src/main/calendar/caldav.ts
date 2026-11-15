/**
 * CalDAV, for Zoho Calendar (and iCloud, Fastmail, Nextcloud…): an address,
 * a username and an (app) password. Finds the account's calendars, reads
 * events in a window, and adds, changes, deletes and answers events.
 */
import { randomUUID } from "node:crypto";

import { XMLParser } from "fast-xml-parser";
import ical, { type ParameterValue, type VEvent } from "node-ical";

import type {
  CalendarAttendee,
  CalendarInfo,
  CalendarRsvp,
  NewRemoteEvent,
  RemoteEventPatch,
} from "../../shared/types";
import {
  buildProp,
  escapeText,
  getProps,
  mailto,
  parseIcs,
  parseProp,
  propTime,
  serializeIcs,
  setProps,
  timeLine,
  utcStamp,
  type IcsComponent,
} from "./icsText";
import { findMeetingUrl, type NormalizedEvent } from "./types";

export interface DavLogin {
  username: string;
  password: string;
}

/** Where an event lives on the server, and which occurrence of a repeat it is. */
export interface DavRef {
  href: string;
  uid: string;
  /** The occurrence's original start, for one occurrence of a repeating event. */
  occurrence: number | null;
  allDay: boolean;
}

export class DavError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  isArray: (name) => ["response", "propstat", "href", "comp", "privilege"].includes(name),
});

type Props = Record<string, unknown>;

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object" && "#text" in (v as Props)) return String((v as Props)["#text"]);
  return "";
}

function hrefOf(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const h = text((v as Props).href);
  return h || null;
}

async function dav(
  method: string,
  url: string,
  login: DavLogin,
  init: { depth?: "0" | "1"; body?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${login.username}:${login.password}`).toString("base64")}`,
        ...(init.depth ? { Depth: init.depth } : {}),
        ...(init.body && !init.headers?.["Content-Type"]
          ? { "Content-Type": "application/xml; charset=utf-8" }
          : {}),
        ...init.headers,
      },
      body: init.body,
    });
  } catch (err) {
    throw new DavError(`Couldn't reach ${new URL(url).host}: ${(err as Error).message}`, 0);
  }
  if (res.status === 401 || res.status === 403)
    throw new DavError(
      res.status === 401
        ? "The calendar server refused the username or password. Use an app password if the account has one."
        : "The calendar server says you don't have permission for that.",
      res.status,
    );
  return res;
}

async function multistatus(
  method: string,
  url: string,
  login: DavLogin,
  depth: "0" | "1",
  body: string,
): Promise<{ href: string; props: Props }[] | null> {
  const res = await dav(method, url, login, { depth, body });
  if (res.status !== 207) return null;
  const doc = parser.parse(await res.text()) as { multistatus?: { response?: Props[] } };
  return (doc.multistatus?.response ?? []).map((r) => {
    const props: Props = {};
    for (const ps of (r.propstat as Props[] | undefined) ?? []) {
      if (!/\s2\d\d\s/.test(` ${text(ps.status)} `)) continue;
      Object.assign(props, (ps.prop as Props | undefined) ?? {});
    }
    return { href: new URL(text(r.href), url).toString(), props };
  });
}

const NS = `xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"`;
const CALENDAR_PROPS = `<d:resourcetype/><d:displayname/><a:calendar-color/>
  <c:supported-calendar-component-set/><d:current-user-privilege-set/>`;

function isCalendar(props: Props): boolean {
  const rt = props.resourcetype;
  return Boolean(rt && typeof rt === "object" && "calendar" in (rt as Props));
}

function holdsEvents(props: Props): boolean {
  const set = props["supported-calendar-component-set"];
  if (!set || typeof set !== "object") return true;
  const comps = ((set as Props).comp as Props[] | undefined) ?? [];
  return comps.length === 0 || comps.some((c) => String(c["@_name"]).toUpperCase() === "VEVENT");
}

function canWrite(props: Props): boolean {
  const set = props["current-user-privilege-set"];
  if (!set || typeof set !== "object") return true;
  const privs = ((set as Props).privilege as Props[] | undefined) ?? [];
  return privs.some((p) =>
    Object.keys(p).some((k) => ["write", "write-content", "all", "bind"].includes(k)),
  );
}

function toInfo(href: string, props: Props, primary: boolean): CalendarInfo {
  const color = text(props["calendar-color"]).trim();
  const fallback = decodeURIComponent(href.replace(/\/$/, "").split("/").pop() ?? "Calendar");
  return {
    id: href.endsWith("/") ? href : `${href}/`,
    name: text(props.displayname).trim() || fallback,
    color: /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7) : null,
    writable: canWrite(props),
    hidden: false,
    primary,
  };
}

/**
 * Finds the calendars behind `url`: a calendar's own address, or a server
 * address where the account's calendars are looked up (RFC 6764 / 4791).
 */
export async function discoverCalendars(url: string, login: DavLogin): Promise<CalendarInfo[]> {
  const body = `<d:propfind ${NS}><d:prop>${CALENDAR_PROPS}
    <d:current-user-principal/><c:calendar-home-set/></d:prop></d:propfind>`;
  const tries = [url];
  const wellKnown = new URL("/.well-known/caldav", url).toString();
  if (wellKnown !== url) tries.push(wellKnown);

  let home: string | null = null;
  for (const at of tries) {
    const here = await multistatus("PROPFIND", at, login, "0", body);
    const self = here?.[0];
    if (!self) continue;
    if (isCalendar(self.props)) return [toInfo(self.href, self.props, true)];
    home = hrefOf(self.props["calendar-home-set"]);
    const principal = hrefOf(self.props["current-user-principal"]);
    if (!home && principal) {
      const p = await multistatus("PROPFIND", new URL(principal, at).toString(), login, "0", body);
      home = hrefOf(p?.[0]?.props["calendar-home-set"]);
      if (home) home = new URL(home, at).toString();
    } else if (home) home = new URL(home, at).toString();
    if (home) break;
  }
  if (!home) return [];

  const list = await multistatus(
    "PROPFIND",
    home,
    login,
    "1",
    `<d:propfind ${NS}><d:prop>${CALENDAR_PROPS}</d:prop></d:propfind>`,
  );
  return (list ?? [])
    .filter((r) => isCalendar(r.props) && holdsEvents(r.props))
    .map((r, i) => toInfo(r.href, r.props, i === 0));
}

/* ---------------------------------------------------------------- reading --- */

const PARTSTAT: Record<string, CalendarRsvp> = {
  ACCEPTED: "accepted",
  TENTATIVE: "tentative",
  DECLINED: "declined",
  "NEEDS-ACTION": "needsAction",
};

function valueOf(v: ParameterValue | undefined): string {
  if (v == null) return "";
  return typeof v === "string" ? v : (v.val ?? "");
}

function person(v: unknown): { email: string; name: string; status: string } {
  if (typeof v === "string") return { email: mailto(v), name: "", status: "" };
  const p = v as { val?: string; params?: Record<string, unknown> };
  return {
    email: mailto(p.val ?? ""),
    name: String(p.params?.CN ?? "").replace(/^"|"$/g, ""),
    status: String(p.params?.PARTSTAT ?? "").toUpperCase(),
  };
}

function toEvent(
  ev: VEvent,
  cal: CalendarInfo,
  href: string,
  start: Date,
  end: Date,
  allDay: boolean,
  occurrence: number | null,
  self: string[],
): NormalizedEvent {
  const raw = ev.attendee == null ? [] : Array.isArray(ev.attendee) ? ev.attendee : [ev.attendee];
  const org = ev.organizer ? person(ev.organizer) : null;
  const attendees: CalendarAttendee[] = raw
    .map(person)
    .filter((p) => p.email.includes("@"))
    .map((p) => ({
      name: p.name,
      email: p.email,
      status: PARTSTAT[p.status] ?? "needsAction",
      organizer: p.email === org?.email,
      self: self.includes(p.email),
    }));
  const mine = !org || !org.email || self.includes(org.email);
  const me = attendees.find((a) => a.self);
  const location = valueOf(ev.location);
  const notes = valueOf(ev.description);
  const uid = ev.uid ?? href;
  const ref: DavRef = { href, uid, occurrence, allDay };
  return {
    key: occurrence === null ? uid : `${uid}|${occurrence}`,
    calendarId: cal.id,
    title: valueOf(ev.summary) || "(untitled)",
    location,
    notes,
    start: start.getTime(),
    end: end.getTime(),
    allDay,
    htmlLink: null,
    meetingUrl: findMeetingUrl(location, notes, ev.url),
    attendees,
    myStatus: !mine && me ? me.status : null,
    organizer: mine ? null : org?.name || org?.email || null,
    canEdit: cal.writable && mine,
    recurring: occurrence !== null,
    ref,
  };
}

export async function fetchDavEvents(
  cal: CalendarInfo,
  login: DavLogin,
  from: Date,
  to: Date,
  self: string[],
): Promise<NormalizedEvent[]> {
  const list = await multistatus(
    "REPORT",
    cal.id,
    login,
    "1",
    `<c:calendar-query ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>
      <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
        <c:time-range start="${utcStamp(from.getTime())}" end="${utcStamp(to.getTime())}"/>
      </c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
  );
  if (!list) throw new DavError(`Couldn't read the calendar “${cal.name}”.`, 0);
  const out: NormalizedEvent[] = [];
  for (const r of list) {
    const data = text(r.props["calendar-data"]);
    if (!data) continue;
    let parsed: ReturnType<typeof ical.sync.parseICS>;
    try {
      parsed = ical.sync.parseICS(data);
    } catch {
      continue;
    }
    for (const item of Object.values(parsed)) {
      if (!item || item.type !== "VEVENT") continue;
      const ev = item as VEvent;
      if (!ev.start) continue;
      if (ev.rrule) {
        for (const inst of ical.expandRecurringEvent(ev, { from, to })) {
          const occurrence = inst.isOverride
            ? (inst.event.recurrenceid?.getTime() ?? inst.start.getTime())
            : inst.start.getTime();
          out.push(
            toEvent(inst.event, cal, r.href, inst.start, inst.end, inst.isFullDay, occurrence, self),
          );
        }
        continue;
      }
      const allDay = Boolean(ev.start.dateOnly);
      const end = ev.end ?? new Date(ev.start.getTime() + (allDay ? 86_400_000 : 0));
      if (ev.start.getTime() > to.getTime() || end.getTime() < from.getTime()) continue;
      out.push(toEvent(ev, cal, r.href, ev.start, end, allDay, null, self));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- writing --- */

const ANSWER: Record<CalendarRsvp, string> = {
  accepted: "ACCEPTED",
  tentative: "TENTATIVE",
  declined: "DECLINED",
  needsAction: "NEEDS-ACTION",
};

function guestLines(guests: string[], self: string, keep: string[] = []): string[] {
  const kept = new Map(keep.map((l) => [mailto(parseProp(l).value), l]));
  const lines = [`ATTENDEE;PARTSTAT=ACCEPTED;ROLE=CHAIR:mailto:${self}`];
  for (const g of guests) {
    const email = g.trim().toLowerCase();
    if (!email || email === self) continue;
    lines.push(kept.get(email) ?? `ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`);
  }
  return lines;
}

function touch(ev: IcsComponent): void {
  const seq = Number(getProps(ev, "SEQUENCE")[0]?.value ?? 0);
  setProps(ev, "DTSTAMP", [`DTSTAMP:${utcStamp(Date.now())}`]);
  setProps(ev, "LAST-MODIFIED", [`LAST-MODIFIED:${utcStamp(Date.now())}`]);
  setProps(ev, "SEQUENCE", [`SEQUENCE:${Number.isFinite(seq) ? seq + 1 : 1}`]);
}

function setTimes(ev: IcsComponent, start: number, end: number, allDay: boolean): void {
  setProps(ev, "DTSTART", [timeLine("DTSTART", start, allDay)]);
  setProps(ev, "DURATION");
  setProps(ev, "DTEND", [timeLine("DTEND", end, allDay)]);
}

export async function createDavEvent(
  calendarUrl: string,
  login: DavLogin,
  input: NewRemoteEvent,
): Promise<DavRef> {
  const uid = `${randomUUID()}@mypa`;
  const self = login.username.toLowerCase();
  const ev: IcsComponent = {
    name: "VEVENT",
    props: [`UID:${uid}`, `SUMMARY:${escapeText(input.title)}`],
    children: [],
  };
  setTimes(ev, input.start, input.end, input.allDay);
  if (input.location) ev.props.push(`LOCATION:${escapeText(input.location)}`);
  if (input.notes) ev.props.push(`DESCRIPTION:${escapeText(input.notes)}`);
  if (input.guests.length && self.includes("@")) {
    ev.props.push(`ORGANIZER:mailto:${self}`, ...guestLines(input.guests, self));
  }
  touch(ev);
  const cal: IcsComponent = {
    name: "VCALENDAR",
    props: ["VERSION:2.0", "PRODID:-//myPA//Calendar//EN", "CALSCALE:GREGORIAN"],
    children: [ev],
  };
  const base = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
  const href = new URL(`${encodeURIComponent(uid)}.ics`, base).toString();
  const res = await dav("PUT", href, login, {
    body: serializeIcs(cal),
    headers: { "Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*" },
  });
  if (!res.ok) throw new DavError(`The calendar server didn't save it (${res.status}).`, res.status);
  return { href, uid, occurrence: null, allDay: input.allDay };
}

async function load(ref: DavRef, login: DavLogin): Promise<{ cal: IcsComponent; etag: string | null }> {
  const res = await dav("GET", ref.href, login);
  if (res.status === 404) throw new DavError("That event isn't on the server any more.", 404);
  if (!res.ok) throw new DavError(`Couldn't load the event (${res.status}).`, res.status);
  return { cal: parseIcs(await res.text()), etag: res.headers.get("etag") };
}

async function save(ref: DavRef, login: DavLogin, cal: IcsComponent, etag: string | null) {
  const res = await dav("PUT", ref.href, login, {
    body: serializeIcs(cal),
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      ...(etag ? { "If-Match": etag } : {}),
    },
  });
  if (res.status === 412)
    throw new DavError("Someone changed this event at the same time. Refresh and try again.", 412);
  if (!res.ok) throw new DavError(`The calendar server didn't save it (${res.status}).`, res.status);
}

/** The VEVENT to change: the event, or this occurrence's own copy (made when missing). */
function target(
  cal: IcsComponent,
  ref: DavRef,
  instance: { start: number; end: number },
): IcsComponent {
  const events = cal.children.filter(
    (c) => c.name === "VEVENT" && (getProps(c, "UID")[0]?.value ?? ref.uid) === ref.uid,
  );
  const master = events.find((c) => getProps(c, "RECURRENCE-ID").length === 0) ?? events[0];
  if (!master) throw new DavError("That event isn't on the server any more.", 404);
  if (ref.occurrence === null) return master;
  const own = events.find((c) => {
    const rid = getProps(c, "RECURRENCE-ID")[0];
    return rid && propTime(rid) === ref.occurrence;
  });
  if (own) return own;
  const skip = new Set(["RRULE", "RDATE", "EXDATE", "DTSTART", "DTEND", "DURATION", "RECURRENCE-ID"]);
  const copy: IcsComponent = {
    name: "VEVENT",
    props: master.props.filter((l) => !skip.has(/^[^;:]+/.exec(l)?.[0]?.toUpperCase() ?? "")),
    children: master.children.map((c) => ({ ...c, props: [...c.props] })),
  };
  copy.props.push(timeLine("RECURRENCE-ID", ref.occurrence, ref.allDay));
  setTimes(copy, instance.start, instance.end, ref.allDay);
  cal.children.push(copy);
  return copy;
}

export async function updateDavEvent(
  ref: DavRef,
  login: DavLogin,
  instance: { start: number; end: number },
  patch: RemoteEventPatch,
): Promise<void> {
  const { cal, etag } = await load(ref, login);
  const ev = target(cal, ref, instance);
  if (patch.title !== undefined) setProps(ev, "SUMMARY", [`SUMMARY:${escapeText(patch.title)}`]);
  if (patch.location !== undefined)
    setProps(ev, "LOCATION", patch.location ? [`LOCATION:${escapeText(patch.location)}`] : []);
  if (patch.notes !== undefined)
    setProps(ev, "DESCRIPTION", patch.notes ? [`DESCRIPTION:${escapeText(patch.notes)}`] : []);
  if (patch.start !== undefined || patch.end !== undefined || patch.allDay !== undefined)
    setTimes(ev, patch.start ?? instance.start, patch.end ?? instance.end, patch.allDay ?? ref.allDay);
  if (patch.guests !== undefined) {
    const self = login.username.toLowerCase();
    const current = ev.props.filter((l) => /^ATTENDEE[;:]/i.test(l));
    if (patch.guests.length === 0) {
      setProps(ev, "ATTENDEE");
      setProps(ev, "ORGANIZER");
    } else {
      setProps(ev, "ATTENDEE", guestLines(patch.guests, self, current));
      if (!getProps(ev, "ORGANIZER").length) ev.props.push(`ORGANIZER:mailto:${self}`);
    }
  }
  touch(ev);
  await save(ref, login, cal, etag);
}

export async function deleteDavEvent(ref: DavRef, login: DavLogin): Promise<void> {
  if (ref.occurrence === null) {
    const res = await dav("DELETE", ref.href, login);
    if (!res.ok && res.status !== 404)
      throw new DavError(`The calendar server didn't delete it (${res.status}).`, res.status);
    return;
  }
  // One occurrence of a repeat: skip that date, and drop its own copy if it has one.
  const { cal, etag } = await load(ref, login);
  const events = cal.children.filter((c) => c.name === "VEVENT");
  const master = events.find((c) => getProps(c, "RECURRENCE-ID").length === 0);
  if (!master) throw new DavError("That event isn't on the server any more.", 404);
  cal.children = cal.children.filter((c) => {
    const rid = c.name === "VEVENT" ? getProps(c, "RECURRENCE-ID")[0] : undefined;
    return !(rid && propTime(rid) === ref.occurrence);
  });
  master.props.push(timeLine("EXDATE", ref.occurrence, ref.allDay));
  touch(master);
  await save(ref, login, cal, etag);
}

export async function respondDavEvent(
  ref: DavRef,
  login: DavLogin,
  instance: { start: number; end: number },
  answer: CalendarRsvp,
  self: string[],
): Promise<void> {
  const { cal, etag } = await load(ref, login);
  const ev = target(cal, ref, instance);
  let found = false;
  ev.props = ev.props.map((line) => {
    if (!/^ATTENDEE[;:]/i.test(line)) return line;
    const p = parseProp(line);
    if (!self.includes(mailto(p.value))) return line;
    found = true;
    p.params = p.params.filter(([k]) => k !== "PARTSTAT" && k !== "RSVP");
    p.params.push(["PARTSTAT", ANSWER[answer]]);
    return buildProp(p);
  });
  if (!found) throw new DavError("You're not on this event's guest list.", 0);
  // A guest's answer isn't a new version of the event, so SEQUENCE stays.
  setProps(ev, "DTSTAMP", [`DTSTAMP:${utcStamp(Date.now())}`]);
  await save(ref, login, cal, etag);
}
