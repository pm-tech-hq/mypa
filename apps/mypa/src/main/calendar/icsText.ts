/**
 * Just enough iCalendar text handling to change an event on a CalDAV server
 * without losing anything else in it: parse into components and raw
 * property lines, edit a few properties, and write it back.
 */

export interface IcsComponent {
  name: string;
  /** Unfolded property lines, in order. */
  props: string[];
  children: IcsComponent[];
}

export interface IcsProp {
  name: string;
  /** Parameter name (upper case) → raw value (quotes kept). */
  params: [string, string][];
  value: string;
}

function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((l) => l.trim() !== "");
}

export function parseIcs(text: string): IcsComponent {
  const root: IcsComponent = { name: "", props: [], children: [] };
  const stack = [root];
  for (const line of unfold(text)) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:")) {
      const comp = { name: upper.slice(6).trim(), props: [], children: [] };
      stack[stack.length - 1]!.children.push(comp);
      stack.push(comp);
    } else if (upper.startsWith("END:")) {
      if (stack.length > 1) stack.pop();
    } else stack[stack.length - 1]!.props.push(line);
  }
  const cal = root.children.find((c) => c.name === "VCALENDAR");
  if (!cal) throw new Error("That isn't calendar data.");
  return cal;
}

/** Lines are folded at 75 octets, as the format asks. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split a multi-byte character.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74;
  }
  return parts.join("\r\n ");
}

export function serializeIcs(comp: IcsComponent): string {
  const lines: string[] = [];
  const walk = (c: IcsComponent) => {
    lines.push(`BEGIN:${c.name}`);
    for (const p of c.props) lines.push(fold(p));
    for (const ch of c.children) walk(ch);
    lines.push(`END:${c.name}`);
  };
  walk(comp);
  return lines.join("\r\n") + "\r\n";
}

export function parseProp(line: string): IcsProp {
  let i = 0;
  let quoted = false;
  // The value starts at the first ':' outside quotes.
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) break;
  }
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts: string[] = [];
  let cur = "";
  quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    if (ch === ";" && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const [name, ...rest] = parts;
  return {
    name: name!.toUpperCase(),
    params: rest.map((p) => {
      const eq = p.indexOf("=");
      return [p.slice(0, eq).toUpperCase(), p.slice(eq + 1)] as [string, string];
    }),
    value,
  };
}

export function buildProp(p: IcsProp): string {
  return `${p.name}${p.params.map(([k, v]) => `;${k}=${v}`).join("")}:${p.value}`;
}

export function propName(line: string): string {
  const m = /^[^;:]+/.exec(line);
  return (m?.[0] ?? "").toUpperCase();
}

export function getProps(comp: IcsComponent, name: string): IcsProp[] {
  return comp.props.filter((l) => propName(l) === name).map(parseProp);
}

/** Removes every `name` line and, when given, adds the new ones in their place. */
export function setProps(comp: IcsComponent, name: string, lines: string[] = []): void {
  const at = comp.props.findIndex((l) => propName(l) === name);
  comp.props = comp.props.filter((l) => propName(l) !== name);
  comp.props.splice(at < 0 ? comp.props.length : at, 0, ...lines);
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function utcStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** An all-day date, in local time (all-day events have no zone). */
export function dateStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** DTSTART / DTEND / RECURRENCE-ID / EXDATE lines for a time. */
export function timeLine(name: string, ms: number, allDay: boolean): string {
  return allDay ? `${name};VALUE=DATE:${dateStamp(ms)}` : `${name}:${utcStamp(ms)}`;
}

/** Offset of `zone` from UTC at `ms`, in ms; null for a zone this computer doesn't know. */
function zoneOffset(ms: number, zone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(ms));
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - ms;
  } catch {
    return null;
  }
}

/** The moment a DATE / DATE-TIME property value means (with its TZID, if any). */
export function propTime(p: IcsProp): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(p.value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return new Date(Number(y), Number(mo) - 1, Number(d)).getTime();
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (z) return wall;
  const tzid = p.params.find(([k]) => k === "TZID")?.[1]?.replace(/^"|"$/g, "");
  if (!tzid) return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
  const first = zoneOffset(wall, tzid);
  if (first === null)
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
  const guess = wall - first;
  return wall - (zoneOffset(guess, tzid) ?? first);
}

export function mailto(value: string): string {
  return value.replace(/^mailto:/i, "").trim().toLowerCase();
}
